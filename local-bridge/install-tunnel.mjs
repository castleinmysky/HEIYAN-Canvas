import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
if (process.platform !== "win32" || process.arch !== "x64")
  throw Error(
    "此自动下载脚本适用于 Windows x64；其他环境请使用受保护的 HTTPS 反向代理。",
  );
const root = path.dirname(fileURLToPath(import.meta.url));
const release = JSON.parse(
  await fs.readFile(path.join(root, "cloudflared-release.json"), "utf8"),
);
const response = await fetch(release.url, {
  signal: AbortSignal.timeout(120000),
});
if (!response.ok) throw Error("Cloudflare 下载失败。");
const data = Buffer.from(await response.arrayBuffer());
if (
  data.length !== release.size ||
  createHash("sha256").update(data).digest("hex") !== release.sha256
)
  throw Error("Cloudflare 校验失败，不会保存或运行此文件。");
const license = await fetch(release.license, {
  signal: AbortSignal.timeout(20000),
});
if (!license.ok) throw Error("无法获取 Cloudflare 许可证。");
await fs.writeFile(
  path.join(root, "CLOUDFLARED-LICENSE.txt"),
  await license.text(),
);
await fs.writeFile(path.join(root, "cloudflared.exe"), data, { flag: "wx" });
console.log("Cloudflare 已校验并保存。脚本没有启动通道。");
