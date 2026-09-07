import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { timingSafeEqual, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { handleCloudRelay } from "./cloud-relay.js";
import { createPublicFetch } from "./public-fetch.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".zip": "application/zip",
  ".bin": "application/octet-stream",
};
const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
const digest = (value) => createHash("sha256").update(value).digest();
export function deploymentOptions(env = process.env) {
  const host = env.HEIYAN_HOST || "127.0.0.1",
    port = Number(env.HEIYAN_PORT || 8792);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("HEIYAN_PORT must be between 1024 and 65535.");
  const password = env.HEIYAN_ACCESS_PASSWORD || "",
    origin = env.HEIYAN_ORIGIN || "";
  if (password && password.length < 16)
    throw Error("Use a deployment password of at least 16 characters.");
  if (origin) {
    const url = new URL(origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol))
      throw Error(
        "HEIYAN_ORIGIN must be an exact HTTP(S) origin without a path.",
      );
  }
  if (!loopback.has(host) && (!origin || password.length < 16))
    throw Error(
      "External listening requires HEIYAN_ORIGIN and a strong HEIYAN_ACCESS_PASSWORD.",
    );
  if (!loopback.has(host) && !origin.startsWith("https://"))
    throw Error("External access requires an HTTPS reverse proxy.");
  return {
    host,
    port,
    password,
    origin,
    hosts: (env.HEIYAN_MODEL_HOSTS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function createCanvasServer({
  host = "127.0.0.1",
  origin = "",
  password = "",
  hosts = [],
  staticRoot = path.join(root, "dist/client"),
  fetchImpl = createPublicFetch({ hosts }),
  maxConcurrent = 8,
  maxPerMinute = 120,
} = {}) {
  let middleware,
    active = 0;
  const windows = new Map();
  const server = http.createServer(async (req, res) => {
    const json = (status, value, headers = {}) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...headers,
      });
      res.end(JSON.stringify(value));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    try {
      const address = server.address();
      const localOrigin = `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
      const expected = origin || localOrigin;
      const allowedHosts = new Set([new URL(expected).host]);
      if (!origin && loopback.has(host))
        for (const item of ["127.0.0.1", "localhost", "[::1]"])
          allowedHosts.add(`${item}:${address.port}`);
      if (!allowedHosts.has(req.headers.host))
        return json(403, { error: "Open the configured canvas address." });
      const now = Date.now();
      if (windows.size > 2048)
        for (const [key, value] of windows)
          if (now - value.start >= 60000) windows.delete(key);
      const peer = req.socket.remoteAddress || "unknown";
      const rate = windows.get(peer);
      if (!rate || now - rate.start >= 60000)
        windows.set(peer, { start: now, count: 0 });
      const window = windows.get(peer);
      const authValue = Buffer.from(`heiyan:${password}`).toString("base64");
      if (
        password &&
        !timingSafeEqual(
          digest(req.headers.authorization || ""),
          digest(`Basic ${authValue}`),
        )
      ) {
        if (++window.count > maxPerMinute)
          return json(
            429,
            { error: "Too many requests." },
            { "Retry-After": "60" },
          );
        return json(
          401,
          { error: "Enter the deployment credentials." },
          { "WWW-Authenticate": 'Basic realm="HEIYAN", charset="UTF-8"' },
        );
      }
      const url = new URL(req.url, expected);
      if (req.url.startsWith("//") || url.origin !== new URL(expected).origin)
        return json(400, { error: "Invalid request target." });
      if (url.pathname.startsWith("/api/")) {
        if (++window.count > maxPerMinute)
          return json(
            429,
            { error: "Too many requests." },
            { "Retry-After": "60" },
          );
        if (url.pathname === "/api/cloud/status" && req.method === "GET")
          return json(200, {
            cloudApi: true,
            storage: "browser-local",
            localCapabilities: false,
          });
        if (url.pathname !== "/api/cloud/request")
          return json(404, {
            error: "This operation is handled by the canvas page.",
          });
        if (active >= maxConcurrent)
          return json(
            429,
            {
              error:
                "Too many active transfers. Try later; no task was resubmitted.",
            },
            { "Retry-After": "10" },
          );
        active++;
        const abort = new AbortController();
        const cancel = () => abort.abort();
        req.once("aborted", cancel);
        res.once("close", cancel);
        try {
          const requestOrigin = origin || `http://${req.headers.host}`;
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers))
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          const request = new Request(requestOrigin + url.pathname, {
            method: req.method,
            headers,
            signal: abort.signal,
            ...(!["GET", "HEAD"].includes(req.method)
              ? { body: Readable.toWeb(req), duplex: "half" }
              : {}),
          });
          const response = await handleCloudRelay(request, { fetchImpl });
          res.writeHead(response.status, Object.fromEntries(response.headers));
          if (response.body)
            await pipeline(Readable.fromWeb(response.body), res, {
              signal: abort.signal,
            });
          else res.end();
        } finally {
          active--;
          req.off("aborted", cancel);
          res.off("close", cancel);
        }
        return;
      }
      if (!["GET", "HEAD"].includes(req.method))
        return json(405, { error: "Method not allowed." });
      if (middleware)
        return middleware(req, res, () => json(404, { error: "Not found." }));
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return json(400, { error: "Invalid path." });
      }
      if (
        pathname.includes("\\") ||
        pathname.includes("\0") ||
        pathname.split("/").some((part) => part.startsWith("."))
      )
        return json(404, { error: "Not found." });
      let file = path.resolve(staticRoot, `.${pathname}`);
      if (file !== staticRoot && !file.startsWith(staticRoot + path.sep))
        return json(404, { error: "Not found." });
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        /* SPA fallback below */
      }
      if (!stat?.isFile()) {
        if (path.extname(pathname)) return json(404, { error: "Not found." });
        file = path.join(staticRoot, "index.html");
        try {
          stat = await fs.stat(file);
        } catch {
          return json(503, { error: "Run npm run build before npm start." });
        }
      }
      const real = await fs.realpath(file),
        base = await fs.realpath(staticRoot);
      if (!real.startsWith(base + path.sep))
        return json(404, { error: "Not found." });
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Content-Length": stat.size,
        "Cache-Control": file.endsWith("index.html")
          ? "no-cache"
          : "public, max-age=3600",
      });
      if (req.method === "HEAD") res.end();
      else await pipeline(createReadStream(file), res);
    } catch {
      if (res.headersSent) res.destroy();
      else
        json(500, {
          error:
            "The request could not be completed. No automatic generation retry was made.",
        });
    }
  });
  server.requestTimeout = 20 * 60_000;
  server.headersTimeout = 15_000;
  return {
    server,
    setMiddleware: (value) => {
      middleware = value;
    },
  };
}
