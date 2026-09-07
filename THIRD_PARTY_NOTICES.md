# 第三方声明

黑岩画布源码采用 Apache License 2.0。该许可不替代第三方软件、字体、标志或演示素材的原有条款。

| 内容 | 说明 |
| --- | --- |
| npm 依赖 | 版本固定于 package-lock.json；安装后的各依赖 LICENSE/NOTICE 保留各自许可。包括 React、React Flow、Three.js、Express、Multer、Vite 等。 |
| Kalo Sans 字体 | 以包内 [OFL 文本](public/fonts/OFL-KaloSans.txt) 为准。 |
| 服务商标志 | 仅用于标识对应服务，不表示背书或合作。[来源记录](public/provider-icons/SOURCES.md)。 |
| Codex CLI | Windows 连接器使用官方运行时，包内附 CODEX-LICENSE、CODEX-NOTICE；版本和来源写入 runtime-manifest.json。 |
| Node.js | Windows 包附运行时及其 LICENSE，源码仓库不存二进制。 |
| cloudflared | 可选下载，不随源码提供二进制；来源和哈希见 [版本记录](local-bridge/cloudflared-release.json)，下载时保存上游许可证。 |
| 演示媒体 | docs/media/ 和 public/agent-preview/ 用于演示界面。人物、服饰、品牌与其他素材的权利不因源码许可自动授予，不将其作为生产素材库分发。 |
| ComfyUI 与模型 | 本仓库仅提供适配代码，不附 ComfyUI 程序、模型或 LoRA 权重。自行安装时遵循各项目和模型许可。 |

再分发运行时或依赖时，应保留随附的许可、声明和来源；不要把第三方模型的使用权等同于画布源码的使用权。
