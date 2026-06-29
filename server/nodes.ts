import type { WebSocketServer } from "ws";
import type { AgentHost } from "./agent.js";
import { loadHubConfig, getTailscaleIp } from "./config.js";
import { fetchTailscaleDevices, pickTailscaleIp } from "./tailscale.js";
import type { StackNodeSummary } from "../shared/protocol.js";
import { DEFAULT_PORT } from "../shared/protocol.js";
import { broadcast } from "./extension-ui.js";

const POLL_MS = 20_000;

export class NodeRegistry {
	private nodes: StackNodeSummary[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private port: number;

	constructor(
		private host: AgentHost,
		private wss: WebSocketServer,
		port: number,
	) {
		this.port = port;
	}

	async start(): Promise<void> {
		await this.refresh().catch((err) => console.warn("[nodes]", err));
		this.timer = setInterval(() => {
			this.refresh().catch((err) => console.warn("[nodes]", err));
		}, POLL_MS);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
	}

	getNodes(): StackNodeSummary[] {
		return this.nodes;
	}

	async refresh(): Promise<StackNodeSummary[]> {
		const config = loadHubConfig();
		const localIp = getTailscaleIp() ?? "127.0.0.1";
		const localStatus = await buildLocalStatus(this.host, config.nodeLabel, localIp, true);

		const devices = await fetchTailscaleDevices();
		const remote: StackNodeSummary[] = [];

		for (const device of devices) {
			const ip = pickTailscaleIp(device);
			if (!ip) continue;
			const isLocal = ip === localIp || device.hostname === config.nodeLabel;
			if (isLocal) continue;

			const status = await pollNodeStatus(ip, this.port, device.name, device.hostname, false);
			remote.push(status);
		}

		this.nodes = [localStatus, ...remote];
		broadcast(this.wss, { type: "node_list", nodes: this.nodes });
		return this.nodes;
	}
}

async function buildLocalStatus(
	host: AgentHost,
	name: string,
	ip: string,
	isLocal: boolean,
): Promise<StackNodeSummary> {
	const sync = await host.buildStateSync();
	return {
		id: `local-${name}`,
		name,
		hostname: name,
		tailscaleIp: ip,
		isLocal,
		piActive: true,
		providerConnected: Boolean(sync.modelAuthConfigured),
		llmModel: sync.model ?? "—",
		lastSeen: new Date().toISOString(),
	};
}

async function pollNodeStatus(
	ip: string,
	port: number,
	name: string,
	hostname: string,
	isLocal: boolean,
): Promise<StackNodeSummary> {
	const now = new Date().toISOString();
	try {
		const controller = new AbortController();
		const t = setTimeout(() => controller.abort(), 4000);
		const res = await fetch(`http://${ip}:${port}/api/node-status`, { signal: controller.signal });
		clearTimeout(t);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json()) as {
			piActive?: boolean;
			providerConnected?: boolean;
			llmModel?: string;
			nodeLabel?: string;
		};
		return {
			id: `${hostname}-${ip}`,
			name: data.nodeLabel ?? name,
			hostname,
			tailscaleIp: ip,
			isLocal,
			piActive: data.piActive ?? true,
			providerConnected: data.providerConnected ?? false,
			llmModel: data.llmModel ?? "—",
			lastSeen: now,
		};
	} catch {
		return {
			id: `${hostname}-${ip}`,
			name,
			hostname,
			tailscaleIp: ip,
			isLocal,
			piActive: false,
			providerConnected: false,
			llmModel: "—",
			lastSeen: now,
		};
	}
}

export async function buildNodeStatusJson(host: AgentHost) {
	const sync = await host.buildStateSync();
	const config = loadHubConfig();
	return {
		ok: true,
		nodeLabel: config.nodeLabel,
		piActive: true,
		providerConnected: Boolean(sync.modelAuthConfigured),
		llmModel: sync.model ?? "—",
		modelProvider: sync.modelProvider,
		streaming: sync.streaming,
	};
}
