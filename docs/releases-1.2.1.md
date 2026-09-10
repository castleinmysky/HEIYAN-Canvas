# 画布 1.2.1 · 开源连接器 1.6.1

[项目介绍](../README.md) · [GitHub 下载](https://github.com/castleinmysky/HEIYAN-Canvas/releases/tag/v1.2.1)

本次同时发布当前画布源码、Windows 免安装连接器和手动启动源码包，不再只更新 Git 中的前端。

## 下载与升级

- Windows x64：下载 `HEIYAN-Connector-Windows-x64.zip`，完整解压到新目录，停止旧连接器后再启动新包。不要覆盖正在运行的文件。
- 其他系统 / 手动启动：下载 `heiyan-codex-connector.zip`，使用自己的 Node.js 与 Codex CLI。
- 用 `SHA256SUMS.txt` 核对下载文件。Windows 引导页应显示开源连接器 **1.6.1**。
- 自部署画布：保存工作后更新源码，运行 `npm ci`、`npm run build`，再重启自己的部署。

GitHub 包默认连接 `http://127.0.0.1:8792`。要连接在线试用站，将 `connector.json` 的 `siteUrl` 改为 `https://heiyan.f2vfhjcckr.chatgpt.site/`；其他自部署地址请填写自己实际使用的 HTTPS 或本机 HTTP 画布地址。不会绑定作者的用户或任务。

## 本次变化与边界

- 使用当前开源仓库的节点编辑、端口引用、模型规格和生成结果工具契约，保持协议 6 兼容。
- 连接器新增状态游标与已领取操作回执恢复接口；支持这些接口的画布可使用，旧画布仍接收完整状态。恢复不会再次提交修改或生成。
- 版本从同一源码标识进入启动页和下载清单，打包时校验源码包版本一致。
- 完整新包只接受带 `heiyan-standalone` 标识的后续增量更新，防止主平台专用版本覆盖开源连接器。首次使用此保护需下载完整包；若所连站点暂未提供匹配更新，则继续使用已校验的内置版本。
- Node.js 22.23.2 与 Codex CLI 0.153.4 保持原固定版本，不包含任何账号、私有任务、密钥或模型。

此版本号属于开源连接器，不代表与主平台 8790 的连接器全量同功能。主平台专用的局域网任务授权、尚未接入开源前端的问题选择和全画布动作接口未导入。在线站点本身不在本次 GitHub 发布中重新部署。

验证使用模拟模型与隔离的 Windows 包启动检查，不进行真实付费生成，也不读取用户的 Codex 登录文件。

## English

Canvas **1.2.1** ships with standalone connector **1.6.1**, including refreshed Windows and source ZIPs plus `SHA256SUMS.txt`.

Extract the Windows ZIP into a new folder, stop the old connector, then start the new one. The setup page displays version 1.6.1. The default canvas is `http://127.0.0.1:8792`; change `siteUrl` in `connector.json` for your own HTTPS deployment or the hosted trial. No author's account or task is bound to the package.

This release packages the current open-source tool contract, adds backward-compatible state cursors and claimed-operation receipt recovery, and keeps source/download versions consistent. The new bootstrap only accepts `heiyan-standalone` incremental updates; incompatible updates are skipped while the verified bundled version remains usable. Download the full ZIP once to receive this bootstrap protection.

Pinned Node.js and Codex runtimes are unchanged. Platform-specific LAN authorization and unsupported canvas tools are not included. Existing GitHub releases remain available. This release does not redeploy the hosted website or restart your running canvas.
