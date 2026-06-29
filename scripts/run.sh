#!/usr/bin/env bash
# Pi Desktop PWA — install if needed, build if needed, start bridge, open UI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/scripts/ensure-path.sh"

CWD="${PI_PWA_CWD:-$HOME}"
PORT="${PI_PWA_PORT:-3141}"

pause_on_exit() {
	if [[ -t 0 && -t 1 ]]; then
		echo ""
		read -r -p "Press Enter to close…" _
	fi
}

trap 'status=$?; if [[ $status -ne 0 ]]; then echo ""; echo "Run failed (exit $status)."; pause_on_exit; fi' EXIT

echo "=== Pi Desktop PWA ==="
echo ""
echo "Project: $ROOT"
echo "Agent cwd: $CWD"
echo ""

if ! command -v node >/dev/null 2>&1; then
	echo "Error: Node.js is not installed."
	echo "Install Node.js >= 22.19.0 from https://nodejs.org/"
	exit 1
fi

NODE_VER="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
NODE_MINOR="${NODE_VER#*.}"
NODE_MINOR="${NODE_MINOR%%.*}"

if [[ "$NODE_MAJOR" -lt 22 || ( "$NODE_MAJOR" -eq 22 && "$NODE_MINOR" -lt 19 ) ]]; then
	echo "Error: Node.js >= 22.19.0 is required (found v$NODE_VER)."
	echo "Upgrade from https://nodejs.org/"
	exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
	echo "Error: npm is not available (expected with Node.js)."
	exit 1
fi

if [[ ! -d node_modules ]]; then
	echo "→ Installing dependencies…"
	npm install
fi

mkdir -p "$HOME/.pi-pwa"
node -e "
const fs = require('fs');
const path = require('path');
const dir = path.join(require('os').homedir(), '.pi-pwa');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, 'config.json'),
  JSON.stringify({ projectRoot: process.argv[1] }, null, 2),
);
" "$ROOT"

NEEDS_BUILD=0
if [[ ! -f dist-server/server/index.js ]] || [[ ! -f client/dist/index.html ]]; then
	NEEDS_BUILD=1
elif find client/src -newer client/dist/index.html -print -quit 2>/dev/null | grep -q .; then
	NEEDS_BUILD=1
fi

if [[ "$NEEDS_BUILD" -eq 1 ]]; then
	echo "→ Building…"
	npm run build
	echo "→ Stopping existing bridge (reload server)…"
	npm run pi-pwa -- stop 2>/dev/null || true
fi

echo "→ Starting bridge (may take up to 30s on first launch)…"
npm run pi-pwa -- ensure --cwd "$CWD" --port "$PORT" --open
