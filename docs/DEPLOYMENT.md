# 部署与维护

[返回首页](../README.md) · [快速开始](QUICKSTART.md)

## 环境和启动

需要 Node.js >=22.13、npm 和现代桌面浏览器。前端无需 GPU；ComfyUI 的硬件、Python、驱动和模型由部署者另行准备。

```bash
npm ci
npm run build
npm start
```

默认只监听 `127.0.0.1:8792`。网页和云请求转发由同一个服务提供，不依赖作者的其他平台、磁盘目录或账号。服务不会自动启动 Codex、ComfyUI 或真实生成。

开发使用 `npm run dev`，仅限本机，不要把开发服务器作为对外服务。

## 配置

复制根目录 `.env.example` 为 `.env`，按需要修改。不要提交 `.env`。

| 变量 | 默认值 / 用途 |
| --- | --- |
| HEIYAN_HOST | `127.0.0.1`；建议保留，通过反向代理访问。 |
| HEIYAN_PORT | `8792`；端口占用时改为未使用的端口。 |
| HEIYAN_ORIGIN | 对外访问的准确来源，如 `https://canvas.example.com`，不含尾部斜杠、路径或参数。 |
| HEIYAN_ACCESS_PASSWORD | 独立部署密码，至少 16 字符。它不是模型 API 密钥。 |
| HEIYAN_MODEL_HOSTS | 可选的模型及结果下载域名白名单，逗号分隔，不支持通配符。 |

## 服务器访问

1. 先在服务器本机完成构建与启动。
2. 配置 HTTPS 反向代理到本机画布端口，保留原始 `Host` 和 `Origin`。
3. 设置 `HEIYAN_ORIGIN` 和随机的 `HEIYAN_ACCESS_PASSWORD`。
4. 浏览器认证用户名为 `heiyan`，密码为部署密码。
5. 防火墙只允许 HTTPS 入口，不要直接开放内部端口。不要向不信任的人共享部署密码。

非本机监听强制要求 HTTPS 来源和部署密码。HTTPS 证书由反向代理负责；画布 Node 服务本身不提供 TLS。反向代理需要允许大文件上传与长请求，建议上传限制不小于 64 MiB、读取超时 20 分钟。

这不是多用户账号系统。部署密码只保护入口，不提供用户隔离、账单或云同步；画布数据仍属于各自浏览器。网页服务转发云请求时会短暂处理必要的模型凭据、提示词与素材，请只使用可信服务。

转发只接受公网 HTTPS 目标，阻止私网地址、DNS 重绑定和重定向；同一部署最多 8 个并行传输、每来源 IP 每分钟 120 次 API 请求。生成提交不会自动重试。代理后多位使用者可能共用 IP 限流。

## 数据与升级

| 数据 | 位置 |
| --- | --- |
| 画布、生成历史、API 设置 | 当前浏览器的网站存储。 |
| 自托管配置 | 根目录 `.env`。 |
| ComfyUI 连接器状态及结果副本 | 默认 `.runtime/comfy/`，可以用 `--state-dir` 指定。 |
| ComfyUI 原始结果 | 你自己的 ComfyUI 输出目录。 |
| Windows Codex 连接器状态 | 当前用户本地应用数据中的 HEIYAN/AgentConnector。 |
| Codex 登录信息 | 由 Codex 管理，不存入源码仓库。 |

升级前从画布导出重要内容，并备份自己的配置和连接器状态。停止自己启动的服务，再运行：

```bash
git pull --ff-only
npm ci
npm run build
npm start
```

不要用强制覆盖命令丢弃自己的改动。保持访问地址不变；换端口或域名会改变浏览器存储来源。恢复历史不等同于恢复上游尚未完成的任务。

## 连接器分发

源码仓库不存二进制运行时。Windows 免安装包作为 GitHub Release 附件分发，不是自定义 EXE 安装程序。

可在可信机器准备官方 Node/Codex 归档后运行 `scripts/package-agent-windows.ps1`；版本、来源与 SHA-256 固定在脚本中。生成包还保留运行时许可证和校验清单。

`scripts/package-agent-connector.ps1` 可生成不含运行时的源码连接器包。构建脚本输出下载分片到 `public/downloads/`，再次 `npm run build` 后网页会优先使用本地包；不放本地包时使用 Releases 入口。

## 验证范围

提交前执行 `npm run check`、`npm test`、`npm run build`、`npm run check:release` 和 `npm audit`。

自动化测试采用隔离数据和模拟上游，不自动消耗模型或 Codex 额度。Windows 免安装包另有 `scripts/check-portable-package.mjs` 验收脚本。真实生成效果、第三方权限、服务器 TLS 和其他操作系统应在各自部署环境验收。
