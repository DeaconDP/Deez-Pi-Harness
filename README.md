# Pi Desktop PWA

Installable PC/Mac PWA frontend for the [Pi coding agent](https://github.com/earendil-works/pi).

The PWA shell runs in your browser. A localhost Node bridge runs the full Pi coding agent (bash, read/edit/write, extensions, AGENTS.md) via `@earendil-works/pi-coding-agent`.

## Architecture

```
Browser (installable PWA)
  │  HTTP + WebSocket
  └─► localhost bridge (127.0.0.1:3141)
        └─► AgentSession (Pi SDK)
```

## Requirements

- Node.js >= 22.19.0
- Pi auth configured (`pi` CLI / `~/.pi`)

## One-click setup (PC / Mac)

Double-click the launcher in the project root (installs deps if needed, builds if needed, starts the bridge, opens the UI):

| Platform | Launcher |
|----------|----------|
| macOS | [`Pi PWA.command`](Pi%20PWA.command) |
| Windows | [`Pi PWA.bat`](Pi%20PWA.bat) |

From a terminal instead:

```bash
./scripts/run.sh                    # macOS / Linux
powershell -File scripts/run.ps1    # Windows
```

The agent uses your home directory as the project folder by default. Point it elsewhere with `PI_PWA_CWD`:

```bash
PI_PWA_CWD=~/my-project ./scripts/run.sh
```

On macOS, if Finder says the `.command` file is not trusted, right-click → Open once, or run `chmod +x "Pi PWA.command" scripts/run.sh`.

## Quick start (manual)

```bash
npm install
npm run build
npm run pi-pwa -- start --cwd ~/my-project --open
```

Or combine setup + launch:

```bash
npm run setup:run -- --cwd ~/my-project
```

Development with hot reload:

```bash
npm run dev
# Client: http://localhost:5173 (proxies /ws to bridge)
# Start bridge separately: npm run pi-pwa -- start
```

## CLI

| Command | Description |
|---------|-------------|
| `pi-pwa start [--cwd path] [--port 3141] [--open]` | Start the bridge |
| `pi-pwa stop` | Stop the bridge |
| `pi-pwa status` | Show bridge status |
| `pi-pwa open` | Open the UI in your browser |

## Features

- Full Pi coding agent via SDK (not browser-only chat)
- Streaming responses, tool output, thinking blocks
- Session list/resume, model picker, tree navigation
- Image attachments (paste or drag onto input)
- Extension UI dialogs (select, confirm, input)
- PWA installable on macOS and Windows
- Three-panel hub: Tailscale nodes, reorderable backlog, messenger chat
- Direct WebSocket peer sync for backlog updates across nodes

## Hub layout

The PWA uses a three-panel hub:

| Panel | Contents |
|-------|----------|
| **Left** | Nodes (Tailscale PCs) — Pi, provider, and LLM status |
| **Centre top** | Reorderable project backlog (Update / Run per row) |
| **Centre bottom** | Messenger-style chat with the hub agent |
| **Right** | Agent details and peer activity feed |

## Hub configuration

Config file: `~/.pi-pwa/config.json`

```json
{
  "agentRole": "coding",
  "agentName": "Hub Agent",
  "nodeLabel": "pi-office",
  "peerToken": "your-shared-secret",
  "tailscaleTag": "tag:pi"
}
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `TAILSCALE_API_KEY` | Optional Tailscale API key for device discovery (falls back to local `tailscale status --json`) |
| `TAILSCALE_TAILNET` | Your tailnet name (e.g. `example.com`); required only when using the API |
| `PI_PWA_BIND` | `127.0.0.1` (default) or `tailscale` to bind the Tailscale IP |
| `PI_PWA_PEER_TOKEN` | Shared secret for peer WebSocket auth (overrides config file) |
| `PI_PWA_PORT` | Bridge port (default `3141`) |

### Tailscale setup

1. Install Tailscale on each Pi / PC node.
2. Tag devices (e.g. `tag:pi`) and set `tailscaleTag` in config to filter the node list.
3. Nodes are auto-discovered via the local Tailscale CLI. Optionally set `TAILSCALE_API_KEY` and `TAILSCALE_TAILNET` for API-based discovery instead.
4. Use the same `PI_PWA_PEER_TOKEN` on all nodes for backlog sync.

### Peer sync

Bridges connect directly via `ws://{tailscale-ip}:{port}/ws/peers`. Backlog updates and task-complete notifications propagate between nodes. Use **Update** on a backlog row to save locally and push to the selected node; **Run** executes the stage instruction on the local agent or the selected remote node.

## Security

### Connection endpoints

The bridge exposes two WebSocket paths with different trust models:

| Endpoint | Used by | Authentication | Typical bind |
|----------|---------|----------------|--------------|
| `/ws` | Browser PWA (agent UI) | **None** — relies on network isolation | `127.0.0.1` only |
| `/ws/peers` | Other Pi PWA bridges (hub sync) | `PI_PWA_PEER_TOKEN` shared secret | Tailscale IP when `PI_PWA_BIND=tailscale` |

The browser client connects to `/ws` for chat, sessions, backlog, and provider configuration. Any process that can reach this endpoint can send prompts and run tools as your OS user. **Keep the default localhost bind** unless you fully trust every device on the tailnet.

Peer bridges connect to `/ws/peers` for backlog sync and remote run/push. The first message must be `{ "type": "auth", "token": "<peerToken>" }` when a token is configured. Without a valid token, the connection is rejected.

### Localhost-only (default)

By default the bridge binds to `127.0.0.1` only (`PI_PWA_BIND` unset or `127.0.0.1`). Only processes on the same machine can reach `/ws` or the HTTP static UI. No peer token is required for local-only use because `/ws/peers` is not exposed beyond the bind address.

### Tailnet exposure

If you set `PI_PWA_BIND=tailscale`, the bridge listens on your Tailscale IP so other machines on your tailnet can reach it.

When exposing on a tailnet:

1. **Always set `PI_PWA_PEER_TOKEN`** (env var or `peerToken` in `~/.pi-pwa/config.json`) and use the same value on every node.
2. Treat `/ws` as sensitive — any tailnet peer could control the agent if it can reach your bridge port. Restrict tailnet ACLs so only trusted devices can connect to port `3141` (or your `PI_PWA_PORT`).
3. Do **not** expose the bridge to the public internet. The agent runs with your user OS permissions (bash, file access, etc.).

### Provider credentials

LLM provider API keys and OAuth tokens are stored via the Pi SDK in `~/.pi` (same as the `pi` CLI). They are never sent to peer nodes; only backlog and run commands cross the peer WebSocket.

### Summary

- **Local dev / single machine:** default `127.0.0.1` bind is sufficient; no peer token needed.
- **Multi-node hub:** `PI_PWA_BIND=tailscale` + shared `PI_PWA_PEER_TOKEN` + tight tailnet ACLs.
- **Never:** public internet exposure without additional reverse-proxy auth in front of `/ws`.

## iOS app (Capacitor)

The iOS build wraps the same UI in a native shell via [Capacitor](https://capacitorjs.com). On iPhone/iPad the app runs in **mobile chat mode**: streaming LLM chat on-device using your own API key. It does **not** embed the Node bridge or Pi coding-agent tools (bash, file edit, extensions). See [docs/MOBILE_TODO.md](docs/MOBILE_TODO.md) for the mobile roadmap and epics.

### Prerequisites

- macOS with [Xcode](https://developer.apple.com/xcode/) installed
- Apple Developer account (for running on a physical device or TestFlight)
- An [OpenRouter](https://openrouter.ai/) API key

### Build and run

```bash
npm install
npm run build:ios    # builds web client + syncs to ios/
npm run open:ios     # opens the Xcode workspace
```

In Xcode, select a simulator or your device, configure signing under **Signing & Capabilities**, then Run (⌘R).

After UI changes:

```bash
npm run build:ios
```

### Mobile setup

1. Open the app and expand **Agent → Configure**.
2. Select **OpenRouter** and paste your API key.
3. Pick a model from the list.
4. Chat — sessions are stored locally on the device (Keychain for the API key).

### Desktop vs mobile

| Capability | Desktop PWA + bridge | iOS app |
|------------|---------------------|---------|
| Full Pi coding agent (bash, tools) | Yes | No |
| Streaming LLM chat | Yes | Yes |
| Image attachments | Yes | Yes |
| OAuth provider login | Yes | No (API key only) |
| Tailscale nodes / backlog hub | Yes | No |
| Session storage | Bridge filesystem (`~/.pi`) | On-device Preferences |
| API key storage | `~/.pi` via SDK | iOS Keychain |

The full coding agent remains available on desktop via the Node bridge. A future version may add optional remote-bridge connection over Tailscale.

### App Store notes

- Users supply their own OpenRouter API key; requests go directly to OpenRouter over HTTPS.
- API keys are stored in the iOS Keychain on device.
- Bundle ID: `online.deac.piui`

## License

MIT
