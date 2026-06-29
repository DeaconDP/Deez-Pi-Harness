import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_HUB_CONFIG, type HubConfig } from "../shared/config.js";
import type { AgentRole } from "../shared/backlog.js";

function normalizeAgentRole(role: unknown): AgentRole {
	if (typeof role === "string") {
		const trimmed = role.trim();
		if (trimmed) return trimmed;
	}
	return DEFAULT_HUB_CONFIG.agentRole;
}

function normalizeAgentName(name: unknown): string {
	if (typeof name === "string") {
		const trimmed = name.trim();
		if (trimmed) return trimmed;
	}
	return DEFAULT_HUB_CONFIG.agentName;
}

const CONFIG_DIR = path.join(os.homedir(), ".pi-pwa");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function getConfigDir(): string {
	return CONFIG_DIR;
}

export function loadHubConfig(): HubConfig {
	try {
		if (fs.existsSync(CONFIG_PATH)) {
			const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<HubConfig>;
			return { ...DEFAULT_HUB_CONFIG, ...raw };
		}
	} catch {
		/* use defaults */
	}
	return { ...DEFAULT_HUB_CONFIG };
}

export function saveHubConfig(patch: Partial<HubConfig>): HubConfig {
	fs.mkdirSync(CONFIG_DIR, { recursive: true });
	const normalized: Partial<HubConfig> = { ...patch };
	if ("agentRole" in patch) normalized.agentRole = normalizeAgentRole(patch.agentRole);
	if ("agentName" in patch) normalized.agentName = normalizeAgentName(patch.agentName);
	const next = { ...loadHubConfig(), ...normalized };
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
	return next;
}

export function getPeerToken(): string | undefined {
	return process.env.PI_PWA_PEER_TOKEN ?? loadHubConfig().peerToken;
}

export function resolveBindHost(): string {
	const bind = process.env.PI_PWA_BIND ?? "127.0.0.1";
	if (bind === "tailscale") {
		const ip = getTailscaleIp();
		if (ip) return ip;
		console.warn("[config] PI_PWA_BIND=tailscale but no Tailscale IP found; falling back to 127.0.0.1");
	}
	return process.env.PI_PWA_HOST ?? bind;
}

export function getTailscaleIp(): string | undefined {
	const ifaces = os.networkInterfaces();
	for (const entries of Object.values(ifaces)) {
		if (!entries) continue;
		for (const entry of entries) {
			if (entry.family === "IPv4" && !entry.internal && entry.address.startsWith("100.")) {
				return entry.address;
			}
		}
	}
	return undefined;
}
