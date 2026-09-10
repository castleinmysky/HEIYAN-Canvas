# 画布 1.2

[简体中文](../README.md) · [English](../README.en.md)

## 本次更新

| 部分 | 变化 |
| --- | --- |
| 会话 | 左右气泡、紧凑文字、SVG 控件；发出的图片显示缩略图，生成的图片、视频和音频可在会话查看。 |
| 导航 | 会话、项目记忆、执行进度和连接设置集中到顶部；Skill 仅预留入口。 |
| 权限 | 审批模式按当前画布保存。默认请求批准；「帮我批准」仅自动处理创建和连线；主动开启「完全访问权限」后可自动编辑、读取素材和付费生成。 |
| 记忆 | 默认阅读，按项编辑、展开长文，刷新记录保留未保存草稿。 |
| 上下文 | 同一会话继续时不重复附加近期对话；轮询成功不再当作新进展。已连入节点的 `@` 标记进入 Agent 上下文。 |
| 画布 | 多图手牌支持节点拖拽；修复连线层级；`gpt-image-2.5` 沿用精确比例映射，包含 21:9。实际支持范围由所接服务决定。 |

升级现有部署：保存工作，更新源码，运行 `npm ci`、`npm run build` 后重新启动。浏览器本地项目与自有模型连接不会被迁入仓库。

本次更新源码与前端，不替换已发布的 Windows 二进制附件。现有 1.6.0 连接器仍可配合使用；从源码启动会使用仓库中的连接器代码。独立部署继续使用浏览器本地项目记忆与本机配对，不包含主平台的账号、局域网任务映射或手机远程连接。

## English

Canvas 1.2 adds compact chat bubbles, sent-image thumbnails, inline image/video/audio results, a consolidated toolbar, model and reasoning controls, and per-canvas approval preferences. Full access is opt-in and can include destructive edits, media reads and paid generation; the default still asks for approval. The Skill entry is reserved, not an implemented loader or execution system.

Project memory is reading-first, with per-section editing and expandable text. Continued conversations avoid repeating recent history, polling alone no longer counts as progress, and connected-node `@` references reach the Agent. Multi-image node dragging, edge layering and `gpt-image-2.5` aspect-ratio mapping are updated. Provider support must still match the configured model.

Save your work, update the source, run `npm ci` and `npm run build`, then restart your deployment. This source update does not replace existing Windows release attachments; the existing 1.6.0 connector remains compatible. Browser-local storage and loopback pairing remain separate from the main platform's accounts and LAN task routing. No private tasks, assets or credentials are included.
