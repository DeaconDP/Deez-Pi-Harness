# Mobile Mode Roadmap

> iOS Capacitor app: local OpenRouter chat on-device. See [README — iOS app](../README.md#ios-app-capacitor).

**Mobile mode** is triggered when the app runs inside a Capacitor native shell (`isNativeMobile()` in `client/src/platform/detect.ts`). The UI switches from `createBridgeTransport()` to `createMobileTransport()` in `client/src/main.ts`, routing chat through OpenRouter over HTTPS with sessions and API keys stored locally.

| Mode | Transport | Coding agent |
|------|-----------|--------------|
| Desktop PWA | WebSocket → Node bridge (`:3141`) | Full Pi agent (bash, files, extensions) |
| iOS app | `createMobileTransport()` → OpenRouter | Chat only — no bridge |

**Not available on mobile today** (stubbed in `client/src/platform/mobile-transport.ts`): OAuth, thinking levels, tree navigation, backlog, extensions, Tailscale nodes.

---

## Shipped

- [x] Capacitor iOS shell (`ios/`, `capacitor.config.ts`, `npm run build:ios`, `npm run open:ios`)
- [x] Mobile transport with streaming chat, abort, and session CRUD (`client/src/platform/mobile-transport.ts`)
- [x] OpenRouter provider: model list, key validation, streaming completions (`client/src/mobile/providers/openrouter.ts`)
- [x] API key storage in iOS Keychain (`client/src/mobile/credentials.ts`)
- [x] Session persistence via Capacitor Preferences (`client/src/mobile/session-store.ts`)
- [x] Bridge-compatible event adapter (`client/src/mobile/event-adapter.ts`)
- [x] Native shell init: status bar, keyboard inset, `platform-native` class (`client/src/platform/native-init.ts`)
- [x] Safe-area padding, touch targets, responsive panel overlays (`client/src/ui/layout.css`)
- [x] Mobile notice banner and desktop-only UI hidden on native (nodes, debug bar, tree button)
- [x] Image attachments in chat (paste/drag; photo library on iOS)
- [x] Hub config (agent name/role) stored locally on device

---

## Epics

### Epic 1 — Mobile UX polish `P0`

Tighten the existing iOS experience before wider release.

- [ ] Audit and hide/disable all desktop-only controls on native (thinking picker, hub panels, backlog UI remnants) — `client/src/main.ts`, `client/index.html`, `client/src/ui/layout.css`
- [ ] First-launch onboarding: prompt API key + model selection before first send — `client/src/main.ts`, `#mobile-notice` in `client/index.html`
- [ ] Improve empty/error states (no API key, no model selected, OpenRouter network errors) — `client/src/platform/mobile-transport.ts`
- [ ] Session list UX on phone (swipe actions, archive flow, rename) — reuse existing transport commands
- [ ] Photo library / paste image flow QA on physical device — Capacitor permissions in `ios/App/App/Info.plist`
- [ ] iPad layout pass (wider panels, split view) — `client/src/ui/layout.css`

### Epic 2 — Quality & App Store readiness `P0`

- [ ] Unit tests: `session-store`, `credentials`, `event-adapter` — new `test/mobile/`
- [ ] Unit tests: `mobile-transport` command routing and error stubs — mock OpenRouter
- [ ] Document TestFlight + signing workflow — README or this doc
- [ ] App Store privacy labels (API key sent to OpenRouter only; no intermediary server)
- [ ] Version/build bump script for iOS releases — `package.json`

### Epic 3 — Remote bridge over Tailscale `P1`

Optional connection from mobile to a desktop Node bridge over the tailnet. See README: *"A future version may add optional remote-bridge connection over Tailscale."*

- [ ] Design transport mode: `local` vs `remote` with persisted preference — new `client/src/platform/transport-mode.ts`
- [ ] Extend `WsClient` to accept a configurable host (not `location.host`) — `client/src/ws/client.ts`
- [ ] Node picker UI: manual hostname/IP entry + optional Tailscale discovery — new mobile settings panel; reference `server/tailscale.ts`
- [ ] Connection UX: connecting / offline / retry; fall back to local chat when bridge unreachable — `client/src/main.ts`, bridge transport
- [ ] Security doc: `/ws` has no auth today — require tailnet ACLs or add token auth before enabling mobile remote — README security section
- [ ] Wire `get_nodes` and full bridge commands when in remote mode — delegate or swap to `createBridgeTransport()` in `client/src/platform/mobile-transport.ts`

### Epic 4 — Android support `P1`

- [ ] `npx cap add android` and Gradle signing config — new `android/`
- [ ] `npm run build:android` script and README section — `package.json`
- [ ] Verify secure storage plugin on Android — `client/src/mobile/credentials.ts`
- [ ] Status bar + keyboard plugins on Android — `client/src/platform/native-init.ts`
- [ ] Play Store listing + privacy policy — doc

### Epic 5 — Providers & auth `P2`

- [ ] Provider abstraction layer (beyond OpenRouter-only) — `client/src/mobile/providers/`
- [ ] Direct API key providers (Anthropic, OpenAI) on mobile — new provider modules
- [ ] Model favorites / recents stored in Preferences — `client/src/mobile/session-store.ts`
- [ ] Evaluate OAuth feasibility in Capacitor in-app browser — likely deferred

### Epic 6 — Session portability & sync `P2`

- [ ] Export/import session JSON via iOS share sheet — `client/src/mobile/session-store.ts` + Capacitor Share plugin
- [ ] Optional desktop session import (read `~/.pi` format) — `shared/protocol.ts`
- [ ] Document iCloud backup behavior for Capacitor Preferences — doc only unless requested

### Epic 7 — Hub features on mobile `P2`

Read-only or lightweight hub without embedding the full coding agent locally.

- [ ] Read-only node list when connected via remote bridge — depends Epic 3
- [ ] Read-only backlog view — unhide/wire `client/src/ui/backlog.ts` for remote mode only
- [ ] Push notifications for peer backlog updates — Capacitor Push + server peer events

### Epic 8 — Mobile web / PWA path `P2`

Phone browser and installed PWA today still use bridge transport and expect a localhost bridge.

- [ ] Document limitation: mobile Safari needs VPN/tunnel to reach desktop bridge — README
- [ ] Optional: detect small viewport + no bridge → offer local chat mode without Capacitor — `client/src/platform/detect.ts`, `client/src/main.ts`
- [ ] Evaluate service worker behavior for mobile PWA — `client/src/main.ts` (SW registration skipped on native only today)

---

## Key files

| Area | Path |
|------|------|
| Platform detection | `client/src/platform/detect.ts` |
| Mobile transport | `client/src/platform/mobile-transport.ts` |
| Bridge transport | `client/src/platform/bridge-transport.ts` |
| Native shell init | `client/src/platform/native-init.ts` |
| Credentials | `client/src/mobile/credentials.ts` |
| Sessions | `client/src/mobile/session-store.ts` |
| OpenRouter provider | `client/src/mobile/providers/openrouter.ts` |
| App entry + gating | `client/src/main.ts` |
| Capacitor config | `capacitor.config.ts` |
| iOS project | `ios/` |
