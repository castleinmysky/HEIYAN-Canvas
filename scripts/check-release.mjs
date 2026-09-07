import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set([
  "node_modules",
  "dist",
  ".git",
  ".runtime",
  ".tmp",
  "data",
  "private",
  "outputs",
  "logs",
  "tmp",
]);
async function walk(directory, prefix = "") {
  const files = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + item.name;
    if (
      ignored.has(item.name) ||
      item.name.startsWith(".runtime-") ||
      relative === "public/downloads"
    )
      continue;
    if (item.isDirectory())
      files.push(
        ...(await walk(path.join(directory, item.name), relative + "/")),
      );
    else if (!relative.endsWith(".tsbuildinfo")) files.push(relative);
  }
  return files;
}
let files;
try {
  await fs.access(path.join(root, ".git"));
  files = [
    ...new Set(
      execFileSync(
        "git",
        ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      )
        .split("\0")
        .filter(Boolean),
    ),
  ];
} catch {
  files = await walk(root);
}
const errors = [];
const report = (file, issue) => errors.push(`${file}: ${issue}`);
const forbiddenPath =
  /(^|\/)(?:\.openai|\.codex|\.codex-runtime|\.runtime[^/]*|node_modules|dist|private|data|outputs|logs|auth\.json|config\.toml|instance\.json)(\/|$)|(?:^|\/)\.env(?:\.|$)(?!example$)|\.(?:exe|zip|7z|ckpt|safetensors|pth|pt|onnx|gguf|pem|key)$/i;
const textExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".html",
  ".css",
  ".svg",
  ".yml",
  ".yaml",
  ".ps1",
  ".cmd",
  ".txt",
  ".example",
]);
for (const file of files) {
  if (forbiddenPath.test(file))
    report(file, "private state or binary distribution must not be committed");
  const absolute = path.join(root, file);
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) {
    report(file, "release contains a symbolic link");
    continue;
  }
  if (stat.size > 50 * 1024 * 1024)
    report(file, "file exceeds 50 MiB; use a release attachment");
  if (!textExtensions.has(path.extname(file))) continue;
  const source = await fs.readFile(absolute, "utf8");
  if (
    /(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(
      source,
    )
  )
    report(file, "potential credential; review locally without printing it");
  if (
    /[CD]:[/\\]+Users[/\\]+EVAN|[CD]:[/\\]+(?:HEIYANTEST|WorkBuddy)|appgprj_[a-f0-9]+/.test(
      source,
    )
  )
    report(file, "author-specific path or hosting project identifier");
  if (file.endsWith(".md")) {
    for (const match of source.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const resolved = path.resolve(
        path.dirname(absolute),
        decodeURIComponent(target),
      );
      if (!resolved.startsWith(root + path.sep)) {
        report(file, "documentation link escapes release");
        continue;
      }
      try {
        await fs.access(resolved);
      } catch {
        report(file, `missing documentation target: ${target}`);
      }
    }
  }
}
const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
if (/<\/?(?:table|tr|td|details|summary|sub|div|h[1-6]|img)\b/i.test(readme))
  report("README.md", "use Markdown, not raw HTML");
if (/首次公开发布的整理|正在整理|计划公开|README\.draft/.test(readme))
  report("README.md", "provisional publication wording");
const previews = [
  ...readme.matchAll(/!\[[^\]]*\]\((docs\/media\/[^)]+)\)/g),
].map((match) => match[1]);
if (
  new Set(previews).size !== 12 ||
  previews.filter((file) => file.endsWith(".gif")).length !== 4
)
  report("README.md", "keep the brand, overview and all ten compact previews");
for (const required of [
  ".env.example",
  "LICENSE",
  "README.md",
  "package-lock.json",
  "server/index.js",
  "local-bridge/start.mjs",
  "docs/QUICKSTART.md",
  "docs/DEPLOYMENT.md",
  "docs/codex-connector.md",
  "docs/codex-connector-windows.md",
  "THIRD_PARTY_NOTICES.md",
]) {
  if (!files.includes(required))
    report(required, "required release file is missing");
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Release check passed: ${files.length} files, local document links, 12 README visuals (4 GIFs), no detected secrets or private runtime files.`,
  );
