# Codex 手动连接

本连接器让同一台电脑的画布连接你自己的 Codex。它不是 ComfyUI，也不是整套画布安装包。

1. 按 [官方 Codex CLI 文档](https://learn.chatgpt.com/docs/codex/cli) 安装 Codex CLI，确保终端可以运行 `codex`。
2. 运行 `codex login` 完成官方登录，再运行 `codex login status` 核对。[官方登录说明](https://learn.chatgpt.com/docs/auth)
3. 在仓库或源码连接器目录运行：

```bash
npm run agent:connector -- --origin http://127.0.0.1:8792
```

需要 Node.js >=22.13。若画布使用其他地址，`--origin` 填实际来源（协议、域名、端口），不含路径。端口冲突可追加 `--port 17373`。

在当前画布的 Agent 连接页填写终端显示的本机地址与配对码。配对码限时有效，不是 API 密钥。节点修改按画布中的审批模式执行；Agent 可一次请求最多 4 个已存在的生成节点，真实生成永远需要用户明确确认。仅打开 Codex 桌面软件不代表终端一定能找到 CLI。

浏览器可能询问本地网络访问权限。只信任自己启动的连接器。按 Ctrl+C 停止连接器；不会关闭用户的 Codex 应用。

连接器不会上传或复制登录文件。会话文本和节点上下文会送到用户配置的 Codex 服务；费用与权限遵循用户自己的登录方式。不要上传登录文件、配对码或会话中的私人内容。
