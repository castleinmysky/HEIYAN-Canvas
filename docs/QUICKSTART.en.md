[简体中文](QUICKSTART.md) | **English**

# Quick start

[Project overview](../README.en.md) · [Releases](https://github.com/castleinmysky/HEIYAN-Canvas/releases/latest)

The canvas app, Codex connector and ComfyUI are separate components. Install only what you need.

## Self-host the canvas

Install Git and Node.js 22.13 or later. In a terminal, run:

```bash
git clone https://github.com/castleinmysky/HEIYAN-Canvas.git
cd HEIYAN-Canvas
npm ci
npm run build
npm start
```

Open [http://127.0.0.1:8792](http://127.0.0.1:8792). Stop the server with Ctrl+C in its terminal; this does not stop other programs.

For development, use `npm run dev` at the same address. Do not expose the development server to the internet. If the port is occupied, configure another port rather than terminating an unfamiliar process.

### Configuration

Copy the root `.env.example` file to `.env` and adjust only what you need. Never commit `.env`.

| Variable | Purpose |
| --- | --- |
| `HEIYAN_HOST` | Defaults to `127.0.0.1`. Prefer keeping it local behind an HTTPS reverse proxy. |
| `HEIYAN_PORT` | Defaults to `8792`. Use an available port if needed. |
| `HEIYAN_ORIGIN` | The exact external origin, such as `https://canvas.example.com`, without a path or trailing slash. |
| `HEIYAN_ACCESS_PASSWORD` | A separate deployment password of at least 16 characters, not your model API key. |
| `HEIYAN_MODEL_HOSTS` | Optional comma-separated allowlist of model and output-download hostnames. No wildcards. |

For remote access, configure an HTTPS reverse proxy, the exact origin and a strong deployment password. The browser authentication username is `heiyan`. Keep internal ports behind a firewall; Node itself does not provide TLS. External listening requires an HTTPS origin and password.

The deployment password protects access; it is not a multi-user account system. Browser storage is still local to each browser. Your self-hosted server may process model credentials and assets while forwarding cloud requests, so use only a trusted deployment.

More deployment and upgrade details are in [DEPLOYMENT.md (Chinese)](DEPLOYMENT.md).

## Use the online demo

The demo is hosted on ChatGPT Sites, not on an independent server operated by the author. Some regions or networks may require a proxy or VPN that you provide. Ensure you can access the hosting service before using it.

The demo does not supply model accounts or generation credits. You connect your own services. Self-hosting avoids dependence on the demo site but does not remove the network requirements of your model providers or Codex.

1. Open the [online demo](https://heiyan.f2vfhjcckr.chatgpt.site/).
2. Create nodes or import assets.
3. Connect a service, choose a model and settings, and submit generation when ready.

Both the demo and self-hosted app use the current browser as the data boundary. A different device, browser, domain or port does not automatically inherit your canvas. Export important work before clearing website data.

## Connect your own model APIs

Open Settings → API & Models (`设置 → API 与模型`), find a model under its generation type, and enter your own key. Open Advanced (`高级`) for other model variants, third-party endpoints or compatible services.

| Setting | What to enter |
| --- | --- |
| API key | A key issued to you by the provider, not a Codex pairing code. |
| Model ID | The actual ID supported by your provider, not an arbitrary display name. |
| Protocol, base URL and path | Follow the provider's documentation. Official and third-party endpoints may differ. |
| Generation settings | Choose them in the node, within the selected model's supported capabilities. |

Seedance and other video services also use your own API access, not the author's account or credits. Some providers require model activation, approval or a deployment endpoint ID from their console.

Cloud requests may pass through your canvas server before reaching the provider. Only enter keys on deployments you trust. A successful connection does not mean every model, permission or size is available.

## Connect your own Codex

### Windows portable connector

1. Download `HEIYAN-Connector-Windows-x64.zip` from [Releases](https://github.com/castleinmysky/HEIYAN-Canvas/releases/latest).
2. Extract the entire ZIP. Do not run it from inside the archive.
3. The default canvas address is `http://127.0.0.1:8792`. For another deployment or the online demo, edit `siteUrl` in the extracted `connector.json`. You can use the full current task URL, including its query parameters. Do not include credentials in the URL.
4. Run `启动黑岩连接器.cmd` (Start HEIYAN Connector). Follow the local setup page to sign in to your own Codex.
5. Click `打开画布并配对` (Open canvas and pair). Verify that the connector is the one you just started, then click `配对并连接` (Pair and connect) in the canvas.

The Windows x64 package includes Node.js and Codex CLI. It does not require a separate Node installation. Its launcher and setup page currently use Chinese labels, reproduced above so you can identify them.

Closing the setup page does not stop the connector. Use `停止连接器` (Stop connector) on that page or run `停止黑岩连接器.cmd` (Stop HEIYAN Connector). After changing `connector.json`, stop and restart the connector.

The canvas download button first uses a package hosted by the deployment. If none is provided, use the GitHub Releases link below it. Private forks require repository access for downloads.

### Manual startup

Install and sign in to Codex CLI first. Opening the desktop app alone does not guarantee that the `codex` command is available in your terminal. See the [official CLI documentation](https://learn.chatgpt.com/docs/codex/cli) and [authentication guide](https://learn.chatgpt.com/docs/auth).

From the repository root, run:

```bash
npm run agent:connector -- --origin http://127.0.0.1:8792
```

For another canvas address, set `--origin` to its exact origin without a path. If needed, add `--port 17373` to use a different connector port. Paste the address and pairing code shown in the terminal into the Agent connection panel of your current canvas. Keep the code private.

### Scope

- Uses your own Codex login and quota. Do not send login files or pairing codes to the author or other users.
- Supports model and reasoning controls, image input, project memory, history search, node editing, approved generation and result inspection. Update the Codex connector to 1.6.0.
- Paid generation asks for approval by default. Explicitly enabling full access authorizes automatic operations, including paid generation, on the current canvas. You can switch back at any time. It does not autonomously complete an entire film. See the [1.2 notes](releases-1.2.md).
- Self-hosted project requirements, conversations and execution receipts are isolated by canvas in this browser's IndexedDB. Reconnecting can load them without replaying old operations. Clearing site data removes these records. Agent API keys remain in page memory, not project records; no account or cloud storage is required.
- Supports a desktop browser and connector on the same computer. Cross-device mobile Codex connections are not available.
- Keep the connector running. Conversation recovery after shutdown is not guaranteed.

## Connect your own ComfyUI

Prepare and start your own ComfyUI installation, including its models and custom nodes. After `npm ci`, open another terminal at the repository root and run:

```bash
npm run comfy:connector -- --origin http://127.0.0.1:8792 --comfy-port 8188
```

Open the [local pairing page](http://127.0.0.1:8289/). Copy its pairing code into Settings → Remote ComfyUI Generation → This computer (`设置 → 远程 ComfyUI 生成 → 当前电脑`). Use the service address, not a model folder path.

Models and LoRAs are selected inside canvas nodes. The connector exposes capabilities it can discover and that existing adapters support; it does not automatically support every custom workflow. No model weights or private model package are included.

Optional arguments:

| Argument | Purpose |
| --- | --- |
| `--origin` | Your actual canvas origin; local HTTP or HTTPS, without a path. |
| `--comfy-port` | Your running local ComfyUI port; defaults to `8188`. |
| `--port` | Connector port; defaults to `8289`. |
| `--comfy-dir` | Optional ComfyUI directory for additional model discovery. Quote paths containing spaces. |
| `--state-dir` | Connector state and output-copy directory; defaults to `.runtime/comfy`. |

### Optional cross-network access

On Windows x64, an optional Cloudflare temporary tunnel can forward the restricted gateway. Prompts, input assets and results pass through Cloudflare. The address may change after restarting, and the generation machine must remain running.

Only if you want this mode, run:

```bash
node local-bridge/install-tunnel.mjs
npm run comfy:connector -- --origin https://canvas.example.com --comfy-port 8188 --remote
```

Replace the example origin with your actual HTTPS canvas origin. The first command downloads and verifies the pinned cloudflared binary without starting a tunnel. The second command starts the tunnel.

Read the HTTPS address and separate remote access code from the local pairing page. On the other device, select the remote-machine connection option in the canvas. Do not share the local pairing page, its local code or private connector state. Do not expose the full ComfyUI server or internal engine directly.

See [ComfyUI connector details (Chinese)](../local-bridge/README.md) for compatibility with existing deployment bundles. Other operating systems and reverse-proxy setups require validation in your own environment.

## Saving and recovery

- Canvas data, settings and generation history are primarily stored in the current browser. There is no account-based cloud sync.
- ComfyUI keeps original outputs on the generation machine. Connector copies default to `.runtime/comfy/data/outputs`; clearing browser history does not delete those files.
- Synchronous cloud requests are not guaranteed to recover after a refresh. An uncertain submission is not automatically repeated and charged again.
- Submitted local tasks require both ComfyUI and the connector to keep running. Recovery after shutdown is not guaranteed.
