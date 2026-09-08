import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Readable, Writable } from "node:stream";
import { createCanvasServer, deploymentOptions } from "../server/http-app.js";
import {
  isPublicAddress,
  resolvePublicTarget,
  createPublicFetch,
} from "../server/public-fetch.js";

async function fixture(t, options = {}) {
  const staticRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "heiyan-server-test-"),
  );
  await fs.writeFile(
    path.join(staticRoot, "index.html"),
    "<title>HEIYAN</title>",
  );
  await fs.writeFile(path.join(staticRoot, "hello.js"), "export default 1;");
  const app = createCanvasServer({ ...options, staticRoot });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(staticRoot, { recursive: true, force: true });
  });
  return { app, base: `http://127.0.0.1:${app.server.address().port}` };
}
test("default deployment is loopback; external binding requires explicit origin and a strong password", () => {
  assert.equal(deploymentOptions({}).host, "127.0.0.1");
  assert.equal(deploymentOptions({}).port, 8792);
  assert.throws(() => deploymentOptions({ HEIYAN_HOST: "0.0.0.0" }));
  assert.throws(() =>
    deploymentOptions({
      HEIYAN_HOST: "0.0.0.0",
      HEIYAN_ORIGIN: "https://canvas.example",
      HEIYAN_ACCESS_PASSWORD: "short",
    }),
  );
  assert.throws(() =>
    deploymentOptions({ HEIYAN_ORIGIN: "https://canvas.example/path" }),
  );
  assert.throws(() =>
    deploymentOptions({
      HEIYAN_HOST: "0.0.0.0",
      HEIYAN_ORIGIN: "http://canvas.example",
      HEIYAN_ACCESS_PASSWORD: "test-password-123456",
    }),
  );
  assert.equal(
    deploymentOptions({
      HEIYAN_HOST: "0.0.0.0",
      HEIYAN_ORIGIN: "https://canvas.example",
      HEIYAN_ACCESS_PASSWORD: "test-password-123456",
    }).host,
    "0.0.0.0",
  );
});
test("serves the build, preserves SPA routes, rejects files outside static root and hostile Host headers", async (t) => {
  const { app, base } = await fixture(t);
  for (const route of ["/", "/studio?task_id=one", "/agent-preview"])
    assert.match(await (await fetch(base + route)).text(), /HEIYAN/);
  assert.match(
    (await fetch(base + "/hello.js")).headers.get("content-type"),
    /javascript/,
  );
  for (const route of [
    "/missing.js",
    "/.env",
    "/.git/config",
    "/%2eenv",
    "/%5c..%5cpackage.json",
  ])
    assert.equal((await fetch(base + route)).status, 404);
  assert.equal((await fetch(base + "/api/cloud/status")).status, 200);
  assert.equal((await fetch(base + "/api/unknown")).status, 404);
  assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
  // Exercise the real server's Host gate directly: some host firewalls reset
  // loopback HTTP with an unrelated Host before it reaches Node. Normal HTTP
  // routes above still use sockets; this request must not leave the process.
  const status = await new Promise((resolve, reject) => {
    let code;
    app.server.emit('request', { headers: { host: 'attacker.invalid' } }, {
      setHeader() {}, writeHead(value) { code = value; },
      end(body) { if (!body.includes('configured canvas')) reject(Error('Unexpected host rejection')); else resolve(code); },
    });
  });
  assert.equal(status, 403);
});
test("deployment authorization cannot be bypassed by Origin and is never forwarded to a provider", async (t) => {
  let calls = 0,
    forwarded;
  const { base } = await fixture(t, {
    password: "test-password-123456",
    fetchImpl: async (_url, options) => {
      calls++;
      forwarded = options.headers;
      return Response.json({ ok: true });
    },
  });
  assert.equal((await fetch(base)).status, 401);
  const auth =
    "Basic " + Buffer.from("heiyan:test-password-123456").toString("base64");
  const headers = {
    Authorization: auth,
    Origin: base,
    "x-heiyan-cloud": "1",
    "x-heiyan-method": "POST",
    "x-heiyan-upstream": "https://api.openai.com/v1/images/generations",
    "x-heiyan-api-authorization": "Bearer test-provider-key",
    "Content-Type": "application/json",
  };
  const response = await fetch(base + "/api/cloud/request", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(forwarded.get("authorization"), "Bearer test-provider-key");
  assert.equal(forwarded.get("cookie"), null);
  assert.equal(
    (
      await fetch(base + "/api/cloud/request", {
        method: "POST",
        headers: { ...headers, Origin: "https://attacker.com" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(calls, 1);
});
test("rejects redirects, private destinations, response leaks and excess request rate without resubmission", async (t) => {
  let calls = 0;
  const { base } = await fixture(t, {
    maxPerMinute: 3,
    fetchImpl: async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/private" },
      });
    },
  });
  const headers = {
    Origin: base,
    "x-heiyan-cloud": "1",
    "x-heiyan-method": "POST",
    "x-heiyan-upstream": "https://api.openai.com/request",
  };
  assert.equal(
    (
      await fetch(base + "/api/cloud/request", {
        method: "POST",
        headers,
        body: "{}",
      })
    ).status,
    502,
  );
  assert.equal(
    (
      await fetch(base + "/api/cloud/request", {
        method: "POST",
        headers: {
          ...headers,
          "x-heiyan-upstream": "https://127.0.0.1/private",
        },
        body: "{}",
      })
    ).status,
    400,
  );
  assert.equal((await fetch(base + "/api/cloud/status")).status, 200);
  assert.equal((await fetch(base + "/api/cloud/status")).status, 429);
  assert.equal(calls, 1);
});
test("DNS validation blocks private, reserved, translated IPv4 and mixed public/private responses", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "2002:a00:1::1",
    "2001:db8::1",
    "3fff::1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])
    assert.equal(isPublicAddress(ip), true, ip);
  const lookup = async () => [{ address: "1.1.1.1", family: 4 }];
  assert.equal(
    (await resolvePublicTarget("https://api.openai.com/v1", { lookup }))
      .records[0].address,
    "1.1.1.1",
  );
  await assert.rejects(
    resolvePublicTarget("https://api.openai.com/v1", {
      lookup,
      hosts: ["other.com"],
    }),
  );
  await assert.rejects(
    resolvePublicTarget("https://api.openai.com/v1", {
      lookup: async () => [
        { address: "1.1.1.1", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    }),
  );
});

test("public transport pins validated DNS results into TLS and streams the body without a second lookup", async () => {
  let lookups = 0,
    requests = 0;
  const chunks = [];
  const transport = createPublicFetch({
    lookup: async () => {
      lookups++;
      return [{ address: "1.1.1.1", family: 4 }];
    },
    requestImpl: (url, options, callback) => {
      requests++;
      assert.equal(url.hostname, "api.openai.com");
      assert.equal(options.agent, false);
      assert.equal(options.method, "POST");
      options.lookup(url.hostname, { all: true }, (error, records) => {
        assert.equal(error, null);
        assert.deepEqual(records, [{ address: "1.1.1.1", family: 4 }]);
      });
      options.lookup(url.hostname, {}, (error, address, family) => {
        assert.equal(error, null);
        assert.equal(address, "1.1.1.1");
        assert.equal(family, 4);
      });
      return new Writable({
        write(chunk, _encoding, done) {
          chunks.push(chunk);
          done();
        },
        final(done) {
          const response = Readable.from([Buffer.from('{"ok":true}')]);
          response.statusCode = 200;
          response.headers = { "content-type": "application/json" };
          callback(response);
          done();
        },
      });
    },
  });
  const response = await transport(
    "https://api.openai.com/v1/images/generations",
    { method: "POST", body: new Blob(['{"test":true}']).stream() },
  );
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(Buffer.concat(chunks).toString(), '{"test":true}');
  assert.equal(lookups, 1);
  assert.equal(requests, 1);
});
