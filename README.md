![黑岩画布品牌标志](docs/media/heiyan-mark.svg)

# HEIYAN · 黑岩画布

不只是做图片。把提示词、素材和生成结果放在一起，接着往下做。

一个面向图片、视频、音频和 3D 的节点创作画布。不用注册画布账号，可以接自己的 API、Codex 和 ComfyUI。

**[进入画布 →](https://heiyan.f2vfhjcckr.chatgpt.site/)** · [快速开始](docs/QUICKSTART.md) · [功能](#功能一览) · [开源说明](docs/OPEN-SOURCE.md)

## 选一种开始方式

| 你想做什么 | 怎么开始 |
| --- | --- |
| 先用起来 | [打开在线画布](https://heiyan.f2vfhjcckr.chatgpt.site/)，不用安装。接入自己的 API 后再生成。 |
| 接自己的 Codex | Agent → 下载 Windows 免安装包 → 解压双击启动。[连接步骤](docs/QUICKSTART.md#连接自己的-codex) |
| 部署整套画布 | 克隆仓库，安装依赖并启动。[部署步骤](docs/QUICKSTART.md#部署整套画布) |

连接器只负责连接你自己的 Codex，不是整套画布的安装包。在线画布现在就可以试用。

## 画布预览

![连接角色参考、服饰参考和提示词，在同一个画布里继续创作](docs/media/canvas-reference-workflow.png)

文字描述 + 图片参考 → 生成结果 → 继续引用

| 素材与结果 | 模型接入 | Codex Agent |
| --- | --- | --- |
| [![画布内的参考与多图结果，使用示例素材](docs/media/reference-hand-detail.jpg)](docs/media/reference-hand-detail.jpg) | [![API 与模型设置，所有密钥均为空](docs/media/model-settings.jpg)](docs/media/model-settings.jpg) | [![连接个人 Codex 的界面，尚未配对](docs/media/agent-connect.jpg)](docs/media/agent-connect.jpg) |
| **提示词助手** | **图片切分** | **API 高级连接** |
| [![组合提示词标签](docs/media/prompt-assistant.gif)](docs/media/prompt-assistant.gif) | [![拖动分割线切分图片](docs/media/multi-view-splitter.gif)](docs/media/multi-view-splitter.gif) | [![配置协议、模型 ID 和接口地址](docs/media/api-advanced.jpg)](docs/media/api-advanced.jpg) |
| **白昼画布** | **夜间画布** | **节点对齐** |
| [![白昼模式](docs/media/canvas-workflow-day.jpg)](docs/media/canvas-workflow-day.jpg) | [![同一画布的夜间模式](docs/media/canvas-workflow-night.jpg)](docs/media/canvas-workflow-night.jpg) | [![多节点对齐操作](docs/media/node-collision-alignment.gif)](docs/media/node-collision-alignment.gif) |
| **窗口拖动** | | |
| [![拖动提示词输入窗口](docs/media/prompt-window-drag.gif)](docs/media/prompt-window-drag.gif) | | |

点击缩略图查看原尺寸。演示素材仅用于展示操作；接入页面不包含任何账号凭据。

接自己的模型和 Codex，把素材与结果留在同一条创作流程里。官方 API 和兼容中转可分别配置；Agent 的节点操作需要确认，真实生成仍由你提交。

## 功能一览

| 分类 | 目前可以做什么 |
| --- | --- |
| 画布 | 拖动、缩放、框选、复制、成组、批量连线、撤销和重做。 |
| 输入 | 文字和不同类型的素材一起引用；具体能接什么，看目标模型支持什么。 |
| 生成 | 图片、视频、音频、3D；结果可以继续作为下一步素材。 |
| 图片处理 | 多视图切分、遮罩编辑、多图手牌浏览。 |
| 生成历史 | 按画布查看，支持删除和清空；预览可滚轮缩放、中键拖动。 |
| Codex Agent | 连接个人 Codex，在会话里讨论并确认节点操作。 |
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

1. 打开 [在线画布](https://heiyan.f2vfhjcckr.chatgpt.site/)，新建节点或放入素材。不接模型，也能先整理画布。
2. 连接自己要用的服务。
3. 选模型和规格，写提示词、引用素材，点击生成。

| 服务 | 需要准备 | 连接入口 |
| --- | --- | --- |
| 云模型 | 自己的 API 地址、模型 ID 和密钥 | 设置 → API 与模型 |
| Codex | 登录自己的 Codex，启动本机连接器 | Agent → 连接 Codex |
| ComfyUI | 部署好模型、节点、工作流和对应连接器 | 设置 → 远程 ComfyUI 生成 |

完整操作见 [快速开始](docs/QUICKSTART.md)，包括 API 接入、Windows 连接器和 ComfyUI 的区别。

> 用的是你自己的 API 和 Codex 额度。当前在线版的数据主要保存在当前浏览器，换设备不会自动同步，重要内容记得先导出。

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
| 隐私 | 使用云模型时，提示词、素材和必要凭据会发给对应服务；使用中转或隧道时，也会经过它们。 |
| 模型 | 连接成功不代表所有功能都能用，还要看模型权限、额度和部署环境。 |
| 本地服务 | 使用时保持连接器和 ComfyUI 运行。清画布的生成历史，不会一起删掉部署机器上的原图。 |
| Agent | 目前主要读取节点信息，还不能直接理解各种图片、音视频内容，也不能自动做完一部短片。 |
| 跨设备 Codex | 手机连接另一台电脑的 Codex，以及关闭连接器后的会话恢复，还没开放。 |
| 刷新恢复 | 要看模型接口支持。没有后台接管的同步请求不能保证恢复，也不会自动再提交一次扣费。 |

## 开源与参与

项目仓库：[castleinmysky/HEIYAN-Canvas](https://github.com/castleinmysky/HEIYAN-Canvas)。

画布可以独立部署，也可以继续调整界面、扩展模型和节点。使用自己的服务，不依赖作者的账号或私人模型包。

| 内容 | 说明 |
| --- | --- |
| 仓库包含 | 画布界面与交互、模型适配、个人 Codex 连接器、必要的服务代码和部署文档。 |
| 不随源码提供 | 私人任务与生成结果、账号凭据、ComfyUI 大模型和 LoRA 权重。 |
| 欢迎参与 | 提问题、补文档、改交互、扩展模型与节点；新功能请同时说明使用方式和测试情况。 |

源码范围与反馈方式见 [开源说明](docs/OPEN-SOURCE.md)。反馈截图与日志记得遮掉密钥、配对码和私人内容。

## 许可证

源码采用 Apache License 2.0。第三方组件、字体、标志、模型和素材遵循各自的许可与条款。
