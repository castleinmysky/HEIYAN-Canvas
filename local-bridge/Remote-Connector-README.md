# HEIYAN 跨网络连接 / Remote Connector

这是最终完整 ComfyUI 部署包的补充包，包含网站连接器与官方 Cloudflare 通道程序，不重复包含模型权重，不修改原模型、工作流和生成作品。
This add-on extends the complete deployment with a connector and the official Cloudflare program. It includes no model weights or personal data.

## 安装与使用 / Setup

1. 将补充包中的 HEIYAN 文件夹合并到完整包的同名目录。先关闭旧连接器窗口，保留已有 SiteBridge/state。
   Merge the HEIYAN folder into the full deployment. Close the old connector before updating; preserve SiteBridge/state.
2. 在有显卡和模型的部署机器上运行 Start-ComfyUI.cmd，等待 127.0.0.1:8288 就绪。
   On the GPU machine, start ComfyUI and wait for port 8288.
3. 运行 Start-Remote-Connector.cmd，等待 HTTPS 通道就绪。程序会核对 Cloudflare 程序的 SHA-256。
   Run Start-Remote-Connector.cmd and wait for HTTPS readiness. The program verifies cloudflared before launching it.
4. 在部署机器上打开 <http://127.0.0.1:8289/>，复制“跨网络连接”下的 HTTPS 地址和独立访问码。
   On that machine, open the local pairing page. Copy the remote HTTPS address and private remote code.
5. 其他网络的设备打开 <https://heiyan.f2vfhjcckr.chatgpt.site/>，进入「设置 → 远程ComfyUI生成 → 其他网络的机器」，填写两项信息并连接。
   On the other device: Settings → Remote ComfyUI Generation → Another network. Enter both values and connect.
6. 模型、LoRA 和工作流能力仍在画布内选择，只有手动点击生成才提交 GPU 任务。
   Choose models, LoRAs and capabilities on the canvas. Only an explicit Generate action starts GPU work.

## 重连、停止与访问码 / Lifecycle

- 连接器只接受同一 HEIYAN 解压目录中的 ComfyUI 和 models。默认端口 8288；如果被其他软件占用，运行 `Start-ComfyUI.cmd --port 8290`，启动器会把端口保存到 SiteBridge/connection.json，连接器和下次启动都会读取同一份配置。先等待任务完成再重启连接器、重新连接以更新模型目录。绝不自动退回旧环境；换盘符或机器无需填写原机器路径。
  Only ComfyUI and models from this extracted HEIYAN folder are accepted. The default port is 8288. If occupied, run `Start-ComfyUI.cmd --port 8290`; the launcher persists the shared port in SiteBridge/connection.json for both programs and future starts. Wait for jobs to finish before restarting and reconnecting. No fallback to another installation or original machine path is used.

- 部署机器、ComfyUI 和连接器必须保持运行。刷新浏览器不会取消已被连接器接受的任务，不要重新点击生成来找回旧任务。
  Keep all three running. Refreshing does not cancel accepted jobs. Do not start a new generation to recover an existing job.
- 临时通道无需账号，仅适合试用，没有固定地址或持续可用保证。重启通道后填入新地址及访问码，同一台机器的旧任务仍按原 ID 查询，不重复提交。
  This account-free tunnel is for testing, without a permanent address or uptime guarantee. Re-enter the new address and code after a restart. Existing jobs are queried, not regenerated.
- 仍有任务未完成时不能切换到另一台机器；连接失败不会把任务自动发送给别的机器。
  Active jobs cannot be reassigned to another machine. Failed connections wait for the original engine.
- 关闭远程连接器（Ctrl+C）即可停止对外访问，不停止独立运行的 ComfyUI，也不保证取消其在途任务。网站“停用”仅隐藏节点，不关闭远程服务。
  Ctrl+C in the connector stops external access, not the separate ComfyUI process or necessarily its GPU work. Disabling models in the browser is not a server shutdown.
- 更换访问码：先关闭旧连接器，再运行 Reset-Remote-Access.cmd。旧远程码失效，新码只显示在部署机器的配对页；本机配对码不变。
  Close the old connector, then run Reset-Remote-Access.cmd to replace the remote code. The local code stays unchanged.

## 数据与安全 / Data and security

- 提示词、上传的参考素材和生成结果经 Cloudflare 的 HTTPS 通道转发到部署机器，不经过画布的云 API 转发接口。模型权重不上传。
  Cloudflare forwards prompts, references and results over HTTPS, without using the Site cloud-API proxy. Model weights stay on the GPU machine.
- 访问码使用 Authorization 请求头，不放入链接或公开包。只给可信使用者：持有码的人可以使用这台机器的算力。
  Codes travel in Authorization headers, not URLs or public packages. Give the code only to trusted users who may use your GPU capacity.
- 只转发 127.0.0.1:8291 上的受限生成路由，不开放配对页、完整编辑器、后台管理、任意文件或安装操作。8288/8289 不通过通道暴露，不改 Windows 防火墙。
  Only restricted authenticated routes on loopback port 8291 are tunneled. The pairing page, editor, admin, filesystem and installer are not exposed. No firewall rule is changed.
- 仅允许指定画布站点的浏览器来源；非浏览器调用也需要访问码。输入素材限制 63 MB，单个浏览器结果限制 256 MB。临时通道的并发请求有平台限制。
  Browser origins are restricted to the named Site; non-browser callers also need the code. References are limited to 63 MB; browser results to 256 MB. Tunnel concurrency has provider limits.
- 原始输出留在 ComfyUI 的配置输出目录，返图副本在 SiteBridge/state/data/outputs，浏览器另存一份。网站清理结果只删浏览器副本。
  Originals remain in the configured ComfyUI output directory, connector copies in SiteBridge/state/data/outputs, and a copy in the browser. Website cleanup affects browser copies only.
- 不要分享 SiteBridge/state，其中包含访问码和任务状态。补充包不包含个人密钥、生成历史或激活信息。
  Never distribute SiteBridge/state: it contains private codes and job state. The add-on has no personal keys, generation history or activation data.

官方说明 / Official reference: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/>
