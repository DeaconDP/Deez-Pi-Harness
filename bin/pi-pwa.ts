#!/usr/bin/env node
/**
 * pi-pwa CLI — start/stop/status/open the local Pi PWA bridge.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_HOST, DEFAULT_PORT } from "../shared/protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STATE_DIR = path.join(os.homedir(), ".pi-pwa");
const PID_FILE = path.join(STATE_DIR, "bridge.pid");
const META_FILE = path.join(STATE_DIR, "bridge.json");

interface BridgeMeta {
	pid: number;
	port: number;
	host: string;
	cwd: string;
	startedAt: string;
}

function ensureStateDir() {
	fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readMeta(): BridgeMeta | null {
	try {
		return JSON.parse(fs.readFileSync(META_FILE, "utf-8")) as BridgeMeta;
	} catch {
		return null;
	}
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function parseArgs(argv: string[]) {
	const args = argv.slice(2);
	const command = args[0] ?? "help";
	const opts: { cwd?: string; port?: number; open?: boolean; host?: string } = {};

	for (let i = 1; i < args.length; i++) {
		if (args[i] === "--cwd" && args[i + 1]) {
			opts.cwd = path.resolve(args[++i]);
		} else if (args[i] === "--port" && args[i + 1]) {
			opts.port = Number(args[++i]);
		} else if (args[i] === "--host" && args[i + 1]) {
			opts.host = args[++i];
		} else if (args[i] === "--open") {
			opts.open = true;
		}
	}

	return { command, opts };
}

function openBrowser(url: string) {
	const platform = process.platform;
	const cmd =
		platform === "darwin"
			? "open"
			: platform === "win32"
				? "start"
				: "xdg-open";
	try {
		spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
	} catch {
		console.log(`Open ${url} in your browser.`);
	}
}

async function waitForHealth(host: string, port: number, timeoutMs = 20_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://${host}:${port}/health`, {
				signal: AbortSignal.timeout(2_000),
			});
			if (res.ok) return true;
		} catch {
			/* retry */
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	return false;
}

function bridgeUrl(host: string, port: number): string {
	return `http://${host}:${port}`;
}

async function cmdStart(opts: { cwd?: string; port?: number; open?: boolean; host?: string }) {
	ensureStateDir();
	const existing = readMeta();
	if (existing && isRunning(existing.pid)) {
		console.log(`Bridge already running (pid ${existing.pid}) at http://${existing.host}:${existing.port}`);
		if (opts.open) openBrowser(`http://${existing.host}:${existing.port}`);
		return;
	}

	const cwd = opts.cwd ?? process.cwd();
	const port = opts.port ?? DEFAULT_PORT;
	const host = opts.host ?? DEFAULT_HOST;
	const serverEntry = fs.existsSync(path.join(ROOT, "dist-server/server/index.js"))
		? path.join(ROOT, "dist-server/server/index.js")
		: path.join(ROOT, "server/index.ts");

	const useTsx = serverEntry.endsWith(".ts");
	const runner = useTsx ? "npx" : process.execPath;
	const runnerArgs = useTsx
		? ["tsx", serverEntry, "--cwd", cwd, "--port", String(port)]
		: [serverEntry, "--cwd", cwd, "--port", String(port)];

	const child = spawn(runner, runnerArgs, {
		cwd: ROOT,
		detached: true,
		stdio: "ignore",
		env: { ...process.env, PI_PWA_PORT: String(port), PI_PWA_HOST: host },
	});
	child.unref();

	const meta: BridgeMeta = {
		pid: child.pid!,
		port,
		host,
		cwd,
		startedAt: new Date().toISOString(),
	};
	fs.writeFileSync(PID_FILE, String(child.pid));
	fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));

	const url = bridgeUrl(host, port);
	const healthy = await waitForHealth(host, port, 90_000);
	if (!healthy) {
		console.error(`Bridge process started (pid ${child.pid}) but did not respond at ${url}/health`);
		process.exit(1);
	}

	console.log(`Pi PWA bridge started (pid ${child.pid})`);
	console.log(`  URL:  ${url}`);
	console.log(`  cwd:  ${cwd}`);
	if (opts.open) openBrowser(url);
}

async function cmdEnsure(opts: { cwd?: string; port?: number; open?: boolean; host?: string }) {
	ensureStateDir();
	const port = opts.port ?? DEFAULT_PORT;
	const host = opts.host ?? DEFAULT_HOST;
	const existing = readMeta();

	if (existing && isRunning(existing.pid)) {
		const healthy = await waitForHealth(existing.host, existing.port);
		if (healthy) {
			const url = bridgeUrl(existing.host, existing.port);
			console.log(`Bridge already running (pid ${existing.pid}) at ${url}`);
			if (opts.open) openBrowser(url);
			return;
		}
		console.log(`Bridge pid ${existing.pid} is stale; starting a new bridge…`);
		try {
			process.kill(existing.pid, "SIGTERM");
		} catch {
			/* ignore */
		}
		try {
			fs.unlinkSync(PID_FILE);
			fs.unlinkSync(META_FILE);
		} catch {
			/* ignore */
		}
	}

	await cmdStart(opts);
}

function cmdStop() {
	const meta = readMeta();
	if (!meta) {
		console.log("No bridge metadata found.");
		return;
	}
	if (!isRunning(meta.pid)) {
		console.log(`Bridge not running (stale pid ${meta.pid}).`);
		fs.unlinkSync(PID_FILE);
		fs.unlinkSync(META_FILE);
		return;
	}
	try {
		process.kill(meta.pid, "SIGTERM");
		console.log(`Stopped bridge (pid ${meta.pid}).`);
	} catch (err) {
		console.error("Failed to stop bridge:", err);
	}
	fs.unlinkSync(PID_FILE);
	fs.unlinkSync(META_FILE);
}

function cmdStatus() {
	const meta = readMeta();
	if (!meta) {
		console.log("Bridge: not running");
		return;
	}
	const running = isRunning(meta.pid);
	console.log(`Bridge: ${running ? "running" : "not running (stale pid)"}`);
	if (running) {
		console.log(`  pid:  ${meta.pid}`);
		console.log(`  url:  http://${meta.host}:${meta.port}`);
		console.log(`  cwd:  ${meta.cwd}`);
		console.log(`  since: ${meta.startedAt}`);
	}
}

function cmdOpen() {
	const meta = readMeta();
	if (!meta || !isRunning(meta.pid)) {
		console.error("Bridge is not running. Start with: pi-pwa start --open");
		process.exit(1);
	}
	openBrowser(`http://${meta.host}:${meta.port}`);
}

function cmdHelp() {
	console.log(`pi-pwa — Pi Desktop PWA bridge launcher

Usage:
  pi-pwa start [--cwd <path>] [--port 3141] [--open]
  pi-pwa ensure [--cwd <path>] [--port 3141] [--open]
  pi-pwa stop
  pi-pwa status
  pi-pwa open

ensure — start the bridge only if it is not already healthy (used by Pi PWA launcher).

The bridge binds to 127.0.0.1 only. Configure auth via the Pi CLI (~/.pi).
`);
}

const { command, opts } = parseArgs(process.argv);

switch (command) {
	case "start":
		await cmdStart(opts);
		break;
	case "ensure":
		await cmdEnsure(opts);
		break;
	case "stop":
		cmdStop();
		break;
	case "status":
		cmdStatus();
		break;
	case "open":
		cmdOpen();
		break;
	default:
		cmdHelp();
}
