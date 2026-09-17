# 画布 1.2.1 · 开源连接器 1.6.1

[项目介绍](../README.md) · [GitHub 下载](https://github.com/castleinmysky/HEIYAN-Canvas/releases/tag/v1.2.1)

本次同时发布当前画布源码、Windows 免安装连接器和手动启动源码包，不再只更新 Git 中的前端。

## 下载与升级

- Windows x64：下载 `HEIYAN-Connector-Windows-x64.zip`，完整解压到新目录，停止旧连接器后再启动新包。不要覆盖正在运行的文件。
- 其他系统 / 手动启动：下载 `heiyan-codex-connector.zip`，使用自己的 Node.js 与 Codex CLI。
- 用 `SHA256SUMS.txt` 核对下载文件。Windows 引导页应显示开源连接器 **1.6.1**。
- 自部署画布：保存工作后更新源码，运行 `npm ci`、`npm run build`，再重启自己的部署。

GitHub 包默认连接 `http://127.0.0.1:8792`。要连接其他画布地址，请在 `connector.json` 的 `siteUrl` 填写实际使用的 HTTPS 或本机 HTTP 地址。连接器不会内置账号或任务绑定。

## 本次变化与边界

- 使用当前开源仓库的节点编辑、端口引用、模型规格和生成结果工具契约，保持协议 6 兼容。
- 连接器新增状态游标与已领取操作回执恢复接口；支持这些接口的画布可使用，旧画布仍接收完整状态。恢复不会再次提交修改或生成。
- 版本从同一源码标识进入启动页和下载清单，打包时校验源码包版本一致。
- 完整新包只接受带 `heiyan-standalone` 标识的后续增量更新，避免安装不匹配的发行包。首次使用此保护需下载完整包；若所连站点暂未提供匹配更新，则继续使用已校验的内置版本。
- Node.js 22.23.2 与 Codex CLI 0.153.4 保持原固定版本，不包含任何账号、私有任务、密钥或模型。

连接器只开放当前画布声明并校验过的能力；未在能力清单中的操作不会执行。本次 GitHub 发布不改变已经运行的部署，更新后需要按部署方式重新构建并重启。

验证使用模拟模型与隔离的 Windows 包启动检查，不进行真实付费生成，也不读取 Codex 登录文件。

## English

Canvas **1.2.1** ships with standalone connector **1.6.1**, including refreshed Windows and source ZIPs plus `SHA256SUMS.txt`.

Extract the Windows ZIP into a new folder, stop the old connector, then start the new one. The setup page displays version 1.6.1. The default canvas is `http://127.0.0.1:8792`; change `siteUrl` in `connector.json` for another HTTPS deployment. No account or task binding is built into the package.

This release packages the current open-source tool contract, adds backward-compatible state cursors and claimed-operation receipt recovery, and keeps source/download versions consistent. The new bootstrap only accepts `heiyan-standalone` incremental updates; incompatible updates are skipped while the verified bundled version remains usable. Download the full ZIP once to receive this bootstrap protection.

Pinned Node.js and Codex runtimes are unchanged. Unsupported canvas tools are not exposed. Existing GitHub releases remain available. Updating source files does not restart a running canvas automatically.
