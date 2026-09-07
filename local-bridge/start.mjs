import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { createGateway } from "./gateway.mjs";
import { createRemoteGateway } from "./remote-gateway.mjs";
import { completePackageModels } from "./package-models.mjs";
import { startQuickTunnel } from "./quick-tunnel.mjs";
import { createApp } from "./engine/server/app.js";
import { resolveRuntimePaths } from "./engine/server/paths.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const option = (args, key, fallback) => {
  const index = args.indexOf(key);
  return index < 0 ? fallback : args[index + 1];
};
export function connectorOptions(args = [], env = process.env) {
  const origin = option(
    args,
    "--origin",
    env.HEIYAN_ORIGIN || "http://127.0.0.1:8792",
  );
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname))
    )
  )
    throw Error("请使用完整 HTTPS 来源或本机 HTTP 来源，不含路径。");
  const port = Number(option(args, "--port", 8289)),
    comfyPort = Number(option(args, "--comfy-port", 8188));
  if (
    [port, comfyPort].some(
      (value) => !Number.isInteger(value) || value < 1024 || value > 65535,
    ) ||
    port === comfyPort ||
    [8289, 8291].includes(comfyPort)
  )
    throw Error("请为 ComfyUI 和连接器设置不同且有效的端口。");
  const directory = option(args, "--comfy-dir", env.HEIYAN_COMFY_DIR || "");
  return {
    origin,
    port,
    comfyPort,
    comfyRoot: directory ? path.resolve(directory) : "",
    stateRoot: path.resolve(
      option(args, "--state-dir", path.join(root, "../.runtime/comfy")),
    ),
    remote: args.includes("--remote"),
  };
}
export async function startConnector(options, { fetchImpl = fetch } = {}) {
  const { origin, port, comfyPort, comfyRoot, stateRoot, remote } = options;
  const paths = resolveRuntimePaths({ ECHO_HOME: stateRoot });
  await fs.mkdir(paths.private, { recursive: true });
  const code = async (name) => {
    const file = path.join(paths.private, name);
    try {
      return (await fs.readFile(file, "utf8")).trim();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const token = randomBytes(32).toString("base64url");
      await fs.writeFile(file, token, { mode: 0o600, flag: "wx" });
      return token;
    }
  };
  const token = await code("pairing-code");
  const internal = createApp({
    dataDir: paths.data,
    privateDir: paths.private,
    runtimePaths: paths,
    env: { ECHO_HOME: stateRoot, ECHO_ALLOW_REMOTE_ADMIN: "0" },
    fetchImpl,
  }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    internal.once("listening", resolve);
    internal.once("error", reject);
  });
  let remoteToken,
    tunnel,
    remoteGateway,
    remoteUrl = "";
  const origins = [origin];
  // API access is paired; the engine is not tunneled or exposed on the LAN.
  const gateway = createGateway({
    token,
    stateDir: paths.private,
    port,
    comfyPort,
    origins,
    upstream: `http://127.0.0.1:${internal.address().port}`,
    verifyTarget: async () => {
      const response = await fetchImpl(
        `http://127.0.0.1:${comfyPort}/system_stats`,
        { redirect: "error", signal: AbortSignal.timeout(10000) },
      );
      if (!response.ok || !(await response.json()).system)
        throw Error("请先启动指定端口的 ComfyUI。");
    },
    completeCatalog: comfyRoot
      ? (models) =>
          completePackageModels(models, { comfyPort, comfyRoot, fetchImpl })
      : async (models) => models,
    remoteInfo: () => (remote ? { token: remoteToken, url: remoteUrl } : null),
  });
  const close = async () => {
    tunnel?.stop();
    for (const server of [remoteGateway?.server, gateway.server, internal])
      if (server) {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      }
  };
  try {
    await gateway.listen();
    if (remote) {
      remoteToken = await code("remote-access-code");
      remoteGateway = createRemoteGateway({
        token: remoteToken,
        localToken: token,
        upstream: `http://127.0.0.1:${port}`,
        origins,
      });
      const address = await remoteGateway.listen();
      tunnel = await startQuickTunnel({
        root,
        port: address.port,
        onUrl: (value) => {
          remoteUrl = value;
          console.log(value ? "远程地址：" + value : "远程通道已断开");
        },
        onMessage: (message) => console.log(message),
      });
    }
    return { gateway, internal, close };
  } catch (error) {
    await close();
    throw error;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.includes("--help"))
    console.log(
      "npm run comfy:connector -- --origin http://127.0.0.1:8792 --comfy-port 8188 [--comfy-dir 文件夹] [--port 8289] [--state-dir 文件夹] [--remote]\n只连接已有的 ComfyUI，不安装模型、不自动生成。",
    );
  else {
    const options = connectorOptions(process.argv.slice(2));
    const running = await startConnector(options);
    console.log(
      `ComfyUI 连接器：http://127.0.0.1:${options.port}\n打开此页取得配对码；生成期间保持 ComfyUI 和连接器运行。`,
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, async () => {
        await running.close();
        process.exit(0);
      });
  }
}
