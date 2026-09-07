import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { connectorOptions, startConnector } from "../local-bridge/start.mjs";

test("standalone Comfy connector validates portable paths, origin and ports", () => {
  const defaults = connectorOptions([], {});
  assert.equal(defaults.origin, "http://127.0.0.1:8792");
  assert.equal(defaults.comfyPort, 8188);
  assert.equal(defaults.remote, false);
  for (const args of [
    ["--origin", "https://canvas.example/path"],
    ["--origin", "http://remote.example"],
    ["--comfy-port", "8289"],
    ["--port", "8188"],
    ["--port", "bad"],
  ])
    assert.throws(() => connectorOptions(args, {}));
});

test(
  "standalone Comfy engine starts in an isolated directory without touching Comfy or submitting a generation",
  { timeout: 15000 },
  async (t) => {
    const stateRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "heiyan-comfy-test-"),
    );
    let upstreamCalls = 0;
    const running = await startConnector(
      { ...connectorOptions([], {}), port: 0, stateRoot },
      {
        fetchImpl: async () => {
          upstreamCalls++;
          throw Error("No external request is allowed in this test");
        },
      },
    );
    t.after(async () => {
      await running.close();
      await fs.rm(stateRoot, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${running.gateway.server.address().port}`;
    const token = (
      await fs.readFile(path.join(stateRoot, "private/pairing-code"), "utf8")
    ).trim();
    assert.equal((await fetch(base + "/status")).status, 401);
    const headers = {
      Authorization: "Bearer " + token,
      Origin: "http://127.0.0.1:8792",
    };
    const response = await fetch(base + "/status", { headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).connected, true);
    assert.equal(
      (
        await fetch(base + "/status", {
          headers: { ...headers, Origin: "https://unpaired.example" },
        })
      ).status,
      403,
    );
    assert.equal(upstreamCalls, 0);
  },
);
