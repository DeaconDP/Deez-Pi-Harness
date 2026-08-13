# Deez Pi Harness

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/DeaconDP/Deez-Pi-Harness@PLACEHOLDER/docs/screenshots/hero.png" alt="Deez Pi Harness" width="720" />
</p>

Installable PWA frontend for the Pi coding agent — talk to LLM providers from a browser.

![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Platform: PWA](https://img.shields.io/badge/platform-PWA-informational)

## Who it’s for

People running [Pi](https://github.com/earendil-works/pi) who want a clean desktop/browser UI instead of only the terminal agent.

## Quick start

```bash
cd client
npm install
npm run dev
```

Install as a PWA from the browser when ready. See in-repo docs for pairing with a Pi backend.

## Features

- PWA install for PC/Mac
- Provider / model access from the browser
- Local-first frontend for the Pi agent workflow

## Limitations

- Needs a configured Pi / provider backend for full chat
- Frontend alone does not replace the agent runtime

## Development

Client Vite lives under `client/` (default port 5173 in config; use sticky/local overrides as needed).

## Credit

Created by [deac.online](https://deac.online) @ [worldbuild.io](https://worldbuild.io)

## License

See repository for license terms.
