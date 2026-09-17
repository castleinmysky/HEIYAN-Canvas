# 画布 1.3.0 · 开源连接器 1.7.1

[项目介绍](../README.md)

## Agent 能力链

- Agent 可以先读取一份结构化能力清单，再调用当前画布已经实现的节点查看与设置、ComfyUI/H3 选择和面板、生成提交，以及任务取消、继续和重试。
- 能力清单只展示当前客户端已接线的操作；`models.inspect` 会按当前模型适配器和所选 ComfyUI 工作流列出可设置字段、枚举与数值范围，而不是按节点类型猜测。OpenAI 图片、传统 ComfyUI 图片、原生工作流、Seedance、MiniMax/H3、音频与 Tripo 各自使用真实边界。
- Tripo 可明确选择文字、单图、单图转多视图、单图转多视图再生成模型、已有多视图五种流程；`models.inspect` 会逐模式返回对应设置清单。负向提示词和图片 Seed 只用于文字流程，图片修复、颜色对齐和方向只用于图片流程，同一次切换流程和设置参数也会按切换后的流程校验。
- 任务取消、恢复与付费重试必须返回可核实的新状态；拒绝、失败、状态未变化或重试未取得新任务编号都不会记成成功回执。
- 能力调用只传递经过校验的操作与画布状态，不传递模型 API 密钥、Authorization、Cookie 或任意连接地址。
- 独立站继续使用浏览器本地模型配置；Codex 连接器继续只监听本机回环地址，并绑定一个明确配对的画布来源。

## 网页检索与会话

- Responses API 连接可由用户明确开启公开网页检索。默认关闭；关闭后以及 Chat Completions 模式都不会发送 `web_search` 工具。
- 引用只接受 HTTP/HTTPS 地址。网页内容视为不可信资料，不能改变系统权限或触发未经确认的画布操作。
- Responses 返回项在展示、保存和下一轮重放前都会重新整理：提供方返回正文、压缩历史或调用数据中若出现当前连接的准确密钥，会先移除再交给界面；流式密钥即使跨多个数据片段也不会提前显示。引用会拒绝带账号信息的地址；查询参数名或参数值只要包含当前连接的准确密钥就会整项移除，其他普通来源路由参数与页内锚点会保留；用户原始输入不会被改写。
- 读取、保存和执行回执默认静默；普通回复继续使用会话气泡。发送后输入立即清空，提交失败会恢复原草稿和附图。
- 待回答问题可回答、稍后处理或取消；旧问题不会在连接器同步后重新出现。时间戳只在跨日期或明显时间间隔时展示。

## 复制与兼容性

- 在画布或会话中选中文字后，可使用系统复制到外部应用。
- 未选中文字时，原有节点、图片、连线和跨画布复制逻辑保持不变。
- 连接器协议升级至 7；旧连接器仍可使用其原有能力，新问题卡和能力链需要 1.7.0 或更高版本。
- `canvas.save` 现在只执行一次持久化，不再在宿主保存后重复触发通用保存。

## 画布视觉与批量能力

- 白昼与黑夜画布统一为同密度细点阵；默认连线保持中性，颜色只用于节点类型、选择、执行和 Agent 操作反馈。
- 节点读取、批量编辑、生成提交和结果回读不再设置任意数量上限；实际吞吐继续服从队列、并发、额度、审批、停止信号与稳定性保护。
- Windows 下载文件名及压缩包内 `VERSION.txt` 均标明 1.7.1，并锁定 `heiyan-standalone` 发行标识。

本次自动验证覆盖网页检索开关与引用过滤、凭据隔离、问题生命周期、能力校验、草稿恢复、会话降噪、原生文本复制、连接器协议、TypeScript 和生产构建。真实 API、付费生成、Windows 免安装包和浏览器实机仍需在发布前使用实际配置验收。

---

## Canvas 1.3.0 / standalone connector 1.7.1

This release adds opt-in public web search for Responses API connections, safe HTTP/HTTPS citations, discoverable canvas/ComfyUI/H3/job actions, cancellable question cards, quieter conversations, immediate draft clearing with failure recovery, sparse timestamps, native text copy without replacing the existing canvas clipboard, unified day/night canvas visuals, and uncapped connector-level batch contracts governed by the real queue and approval safeguards.

Web content remains untrusted. Exact configured secrets are removed from provider-controlled non-streamed, streamed and compacted content before display, persistence or replay, including secrets split across SSE deltas. Citations reject userinfo and remove only credential-bearing query, fragment or title data while preserving benign routing. Tripo exposes all five real input modes with mode-specific fields. `models.inspect` reports exact adapter/workflow setting keys and legal values, and `canvas.save` performs one durable write. Browser-local model configuration and the loopback-only connector boundary remain unchanged.
