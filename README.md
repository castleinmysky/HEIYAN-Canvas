**简体中文** | [English](README.en.md)

![黑岩画布品牌标志](docs/media/heiyan-mark.svg)

# HEIYAN · 黑岩画布

一个面向图片、视频、音频和 3D 的节点创作画布。不用注册画布账号，可以接自己的 API、Codex 和 ComfyUI。

**[自行部署 →](docs/QUICKSTART.md#部署整套画布)** · [打开托管画布](https://heiyan.cmsi.win/) · [功能](#功能一览) · [开源说明](docs/OPEN-SOURCE.md)

## 选一种开始方式

| 你想做什么 | 怎么开始 |
| --- | --- |
| 自行部署 | 克隆仓库，安装依赖并启动。[部署步骤](docs/QUICKSTART.md#部署整套画布) |
| 直接使用 | [打开托管画布](https://heiyan.cmsi.win/)，生成时接入自己的 API 或 Codex。 |
| 接自己的 Codex | Agent → 下载 Windows 免安装包 → 解压双击启动。[连接步骤](docs/QUICKSTART.md#连接自己的-codex) |

托管画布不提供模型账号或生成额度；模型 API 和 Codex 仍需满足各自的网络访问条件。

连接器只负责连接你自己的 Codex，不是整套画布的安装包。

## 画布预览

![连接角色参考、服饰参考和提示词，在同一个画布里继续创作](docs/media/canvas-reference-workflow.png)

文字描述 + 图片参考 → 生成结果 → 继续引用

| 素材与结果 | 模型接入 | Codex Agent |
| --- | --- | --- |
| [![画布内的参考与多图结果，使用示例素材](docs/media/reference-hand-detail.jpg)](docs/media/reference-hand-detail.jpg) | [![API 与模型设置，所有密钥均为空](docs/media/model-settings.jpg)](docs/media/model-settings.jpg) | [![连接 Codex 的界面，尚未配对](docs/media/agent-connect.jpg)](docs/media/agent-connect.jpg) |
| **提示词助手** | **图片切分** | **API 高级连接** |
| [![组合提示词标签](docs/media/prompt-assistant.gif)](docs/media/prompt-assistant.gif) | [![拖动分割线切分图片](docs/media/multi-view-splitter.gif)](docs/media/multi-view-splitter.gif) | [![配置协议、模型 ID 和接口地址](docs/media/api-advanced.jpg)](docs/media/api-advanced.jpg) |
| **白昼画布** | **夜间画布** | **节点对齐** |
| [![白昼模式](docs/media/canvas-workflow-day.jpg)](docs/media/canvas-workflow-day.jpg) | [![同一画布的夜间模式](docs/media/canvas-workflow-night.jpg)](docs/media/canvas-workflow-night.jpg) | [![多节点对齐操作](docs/media/node-collision-alignment.gif)](docs/media/node-collision-alignment.gif) |
| **窗口拖动** | | |
| [![拖动提示词输入窗口](docs/media/prompt-window-drag.gif)](docs/media/prompt-window-drag.gif) | | |

点击缩略图查看原尺寸。演示素材仅用于展示操作；接入页面不包含任何账号凭据。

官方 API 和兼容中转可分别配置。Responses API 可按连接明确开启公开网页检索；默认关闭，Chat Completions 不启用。Agent 可发现并调用当前画布已有的节点、ComfyUI/H3 和任务能力。默认在生成前请求确认；主动开启「完全访问权限」后，可在当前画布自动执行，包括付费生成。权限按画布记忆，可随时切回。[1.4 更新说明](docs/releases-1.4.0.md)

## 功能一览

| 分类 | 目前可以做什么 |
| --- | --- |
| 画布 | 拖动、缩放、框选、复制、成组、批量连线、撤销和重做。 |
| 输入 | 文字和不同类型的素材一起引用；具体能接什么，看目标模型支持什么。 |
| 生成 | 图片、视频、音频、3D；结果可以继续作为下一步素材。 |
| 图片处理 | 多视图切分、遮罩编辑、多图手牌浏览。 |
| 生成历史 | 按画布查看，支持删除和清空；预览可滚轮缩放、中键拖动。 |
| Agent | 连接你的 Codex 或会话 API；气泡会话、附图缩略图、图片/视频结果浏览、审批与模型选择、项目记忆、历史检索、节点编排与 `@` 引用。 |
| ComfyUI | 通过连接器使用自己部署的模型和工作流，支持已有适配的本机与跨网络连接。 |

## 快速开始

本机部署需要 Node.js 22.13 或更高版本：

```bash
git clone https://github.com/castleinmysky/HEIYAN-Canvas.git
cd HEIYAN-Canvas
npm ci
npm run build
npm start
```

打开 [http://127.0.0.1:8792](http://127.0.0.1:8792)。不启动 ComfyUI 或 Codex，也能使用画布编辑；需要哪项生成能力，再连接自己的服务。

1. 打开自己部署的画布，或使用 [托管画布](https://heiyan.cmsi.win/)，新建节点或放入素材。不接模型，也能先整理画布。
2. 连接自己要用的服务。
3. 选模型和规格，写提示词、引用素材，点击生成。

| 服务 | 需要准备 | 连接入口 |
| --- | --- | --- |
| 云模型 | 自己的 API 地址、模型 ID 和密钥 | 设置 → API 与模型 |
| Codex | 登录自己的 Codex，启动本机连接器 | Agent → 连接 Codex |
| ComfyUI | 部署好模型、节点、工作流和对应连接器 | 设置 → 远程 ComfyUI 生成 |

完整操作见 [快速开始](docs/QUICKSTART.md)，包括 API 接入、Windows 连接器和 ComfyUI 的区别。

> 使用你自己的 API 和 Codex 额度。画布数据主要保存在当前浏览器，换设备不会自动同步，重要内容记得先导出。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `src/` | 画布界面、节点交互、Agent 会话、浏览器本地数据。 |
| `server/`、`shared/` | 独立网页服务、云 API 转发、Codex 连接器和公共协议。 |
| `local-bridge/` | ComfyUI 连接器、工作流与适配引擎；不包含模型权重。 |
| `public/` | 网页图标、字体与内置演示素材。 |
| `docs/` | 部署和连接说明；截图与 GIF 集中在 `docs/media/`。 |
| `scripts/`、`tests/` | 启动、打包、发布检查和回归测试。 |

`node_modules/`、`dist/` 和 `.runtime*/` 由安装、构建或运行产生，不提交到仓库。

## 使用边界

| 项目 | 说明 |
| --- | --- |
| 数据流向 | 使用云模型时，提示词、素材和必要凭据会发给你选择的服务；使用中转或隧道时，也会经过相应服务。 |
| 模型 | 连接成功不代表所有功能都能用，还要看模型权限、额度和部署环境。 |
| 本地服务 | 使用时保持连接器和 ComfyUI 运行。清画布的生成历史，不会一起删掉部署机器上的原图。 |
| Agent | 图片理解需要支持视觉的模型，并明确授权发送图片；不支持听音频或自动剪辑整部短片。 |
| 会话恢复 | 重连后可载入项目记忆，不等于恢复原来运行中的 Codex 线程，也不会重放旧操作。手机跨设备连接 Codex 尚未开放。 |
| 刷新恢复 | 要看模型接口支持。没有后台接管的同步请求不能保证恢复，也不会自动再提交一次扣费。 |

## 开源与参与

项目仓库：[castleinmysky/HEIYAN-Canvas](https://github.com/castleinmysky/HEIYAN-Canvas)。

画布可以自行部署，也可以继续调整界面、扩展模型和节点。运行时接入由使用者配置的服务。

| 内容 | 说明 |
| --- | --- |
| 仓库包含 | 画布界面与交互、模型适配、Codex 连接器、必要的服务代码和部署文档。 |
| 不随源码提供 | 账号凭据、运行数据、生成结果、ComfyUI 大模型和 LoRA 权重。 |
| 欢迎参与 | 提问题、补文档、改交互、扩展模型与节点；新功能请同时说明使用方式和测试情况。 |

源码范围与反馈方式见 [开源说明](docs/OPEN-SOURCE.md)。反馈截图与日志记得遮掉密钥、配对码和敏感内容。

## 许可证

源码采用 Apache License 2.0。第三方组件、字体、标志、模型和素材遵循各自的许可与条款。
