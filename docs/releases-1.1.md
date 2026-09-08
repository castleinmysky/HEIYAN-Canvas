# HEIYAN Canvas 1.1

## Agent

| 能力 | 更新 |
| --- | --- |
| 连接 | 个人 Codex，或自己的 Responses / Chat Completions API。 |
| 输入 | 选择模型与推理强度，附加图片，引用当前画布节点。 |
| 会话 | 流式回复、补充要求、项目记忆、历史检索与用量记录。 |
| 操作 | 预览节点修改、连线与排版；定位相关节点并跟随执行。 |
| 生成 | 生成前单独确认；按实际任务回执查看结果，不自动重放旧任务。 |

自部署仍然免账号。会话与执行回执按画布保存在当前浏览器；API 密钥不写入项目记录。关闭页面或连接器不代表任务会在后台继续运行。

Windows 免安装连接器已更新至 **1.6.0**，包含固定版本 Node.js 与 Codex。完整解压后双击启动，登录自己的 Codex。默认画布地址为 `http://127.0.0.1:8792`；其他地址请修改包内 `connector.json`。

本次验证使用模拟服务，未消耗真实模型额度。

## English

- Connect your own Codex or a Responses / Chat Completions API.
- Model and reasoning controls, image input and canvas references.
- Streaming chat, steering, project memory, search and usage records.
- Preview node edits and layout changes; inspect generation results tied to actual jobs.
- Paid generation always requires separate approval. Old operations are never replayed automatically.

Self-hosting remains accountless. Project records stay in this browser, isolated by canvas; API keys are not saved in project memory. Closing the page or connector does not guarantee background execution.

The **1.6.0 Windows connector** bundles pinned Node.js and Codex runtimes. Extract it fully and launch the included startup script. It defaults to `http://127.0.0.1:8792`; change `connector.json` for another deployment. Automated verification used mocks, not paid model calls.
