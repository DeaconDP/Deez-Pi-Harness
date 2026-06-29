import WebSocket, { WebSocketServer, type WebSocket as WsSocket } from "ws";
import type { Server } from "node:http";
import type { BacklogProject } from "../shared/backlog.js";
import type { PeerMessage } from "../shared/peers.js";
import type { BacklogStore } from "./backlog.js";
import { getPeerToken, loadHubConfig } from "./config.js";
import { broadcast } from "./extension-ui.js";
import type { AgentHost } from "./agent.js";
import type { NodeRegistry } from "./nodes.js";
import { fetchTailscaleDevices, pickTailscaleIp } from "./tailscale.js";
import { DEFAULT_PORT } from "../shared/protocol.js";
import type { PeerNotification } from "../shared/peers.js";

export class PeerHub {
	private outbound = new Map<string, WsSocket>();
	private authenticated = new WeakSet<WsSocket>();
	private runningProjectId: string | null = null;
	private peerTimer: ReturnType<typeof setInterval> | null = null;
	private peerWss: WebSocketServer | null = null;

	constructor(
		private host: AgentHost,
		private wss: WebSocketServer,
		private backlog: BacklogStore,
		private nodes: NodeRegistry,
		private port: number,
	) {}

	attachHttp(server: Server): void {
		this.peerWss = new WebSocketServer({ noServer: true });
		server.on("upgrade", (req, socket, head) => {
			const url = req.url ?? "";
			if (!url.startsWith("/ws/peers")) return;
			this.peerWss!.handleUpgrade(req, socket, head, (ws) => {
				this.peerWss!.emit("connection", ws, req);
			});
		});

		this.peerWss.on("connection", (ws) => {
			ws.on("message", (data) => this.handleInbound(ws, data.toString()));
			ws.on("close", () => {
				for (const [k, v] of this.outbound) {
					if (v === ws) this.outbound.delete(k);
				}
			});
		});

		this.peerTimer = setInterval(() => {
			this.connectToPeers().catch((err) => console.warn("[peers]", err));
		}, 30_000);
		this.connectToPeers().catch((err) => console.warn("[peers]", err));
	}

	stop(): void {
		if (this.peerTimer) clearInterval(this.peerTimer);
		this.peerTimer = null;
		for (const ws of this.outbound.values()) ws.close();
		this.outbound.clear();
		this.peerWss?.close();
		this.peerWss = null;
	}

	private notify(notification: Omit<PeerNotification, "id" | "timestamp">): void {
		const full: PeerNotification = {
			...notification,
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
		};
		broadcast(this.wss, { type: "peer_notification", notification: full });
	}

	private handleInbound(ws: WsSocket, raw: string): void {
		let msg: PeerMessage;
		try {
			msg = JSON.parse(raw) as PeerMessage;
		} catch {
			return;
		}

		const token = getPeerToken();
		if (msg.type === "auth") {
			if (token && msg.token === token) {
				this.authenticated.add(ws);
				ws.send(JSON.stringify({ type: "auth_ok" } satisfies PeerMessage));
			} else {
				ws.send(JSON.stringify({ type: "auth_fail", reason: "invalid token" } satisfies PeerMessage));
				ws.close();
			}
			return;
		}

		if (token && !this.authenticated.has(ws)) {
			ws.close();
			return;
		}

		const nodeLabel = loadHubConfig().nodeLabel;

		switch (msg.type) {
			case "update_backlog": {
				this.backlog.mergeRemote(msg.project);
				broadcast(this.wss, { type: "backlog_updated", projects: this.backlog.getAll() });
				this.notify({
					kind: "backlog_update",
					fromNode: msg.fromNode,
					message: `${msg.fromNode} updated project "${msg.project.name}"`,
					projectId: msg.project.id,
					projectName: msg.project.name,
				});
				break;
			}
			case "backlog_snapshot_request": {
				ws.send(
					JSON.stringify({
						type: "backlog_snapshot",
						projects: this.backlog.getAll(),
						fromNode: nodeLabel,
					} satisfies PeerMessage),
				);
				break;
			}
			case "run_project": {
				this.runProject(msg.projectId, msg.fromNode).catch((err) =>
					console.error("[peers run]", err),
				);
				break;
			}
			case "task_complete": {
				this.backlog.markIdle(msg.projectId);
				broadcast(this.wss, { type: "backlog_updated", projects: this.backlog.getAll() });
				this.notify({
					kind: "task_complete",
					fromNode: msg.fromNode,
					message: `${msg.fromNode} completed "${msg.projectName}"`,
					projectId: msg.projectId,
					projectName: msg.projectName,
				});
				break;
			}
		}
	}

	async connectToPeers(): Promise<void> {
		const token = getPeerToken();
		if (!token) return;

		const devices = await fetchTailscaleDevices();
		const localLabel = loadHubConfig().nodeLabel;

		for (const device of devices) {
			if (device.hostname === localLabel || device.name === localLabel) continue;
			const ip = pickTailscaleIp(device);
			if (!ip) continue;
			const key = `${ip}:${this.port}`;
			const existing = this.outbound.get(key);
			if (existing && existing.readyState === WebSocket.OPEN) continue;

			const ws = new WebSocket(`ws://${ip}:${this.port}/ws/peers`);
			ws.on("open", () => {
				ws.send(JSON.stringify({ type: "auth", token } satisfies PeerMessage));
				ws.send(JSON.stringify({ type: "backlog_snapshot_request" } satisfies PeerMessage));
			});
			ws.on("message", (data) => this.handleOutboundMessage(device.name, data.toString()));
			ws.on("close", () => this.outbound.delete(key));
			this.outbound.set(key, ws);
		}
	}

	private handleOutboundMessage(peerName: string, raw: string): void {
		let msg: PeerMessage;
		try {
			msg = JSON.parse(raw) as PeerMessage;
		} catch {
			return;
		}

		if (msg.type === "backlog_snapshot") {
			for (const p of msg.projects) this.backlog.mergeRemote(p);
			broadcast(this.wss, { type: "backlog_updated", projects: this.backlog.getAll() });
			return;
		}

		if (msg.type === "update_backlog") {
			this.backlog.mergeRemote(msg.project);
			broadcast(this.wss, { type: "backlog_updated", projects: this.backlog.getAll() });
			this.notify({
				kind: "backlog_update",
				fromNode: peerName,
				message: `${peerName} updated "${msg.project.name}"`,
				projectId: msg.project.id,
				projectName: msg.project.name,
			});
			return;
		}

		if (msg.type === "task_complete") {
			this.backlog.markIdle(msg.projectId);
			broadcast(this.wss, { type: "backlog_updated", projects: this.backlog.getAll() });
			this.notify({
				kind: "task_complete",
				fromNode: peerName,
				message: `${peerName} completed "${msg.projectName}"`,
				projectId: msg.projectId,
				projectName: msg.projectName,
			});
		}
	}

	async pushToPeer(nodeId: string, project: BacklogProject): Promise<void> {
		const node = this.nodes.getNodes().find((n) => n.id === nodeId);
		if (!node || node.isLocal) return;

		const token = getPeerToken();
		if (!token) throw new Error("Peer token not configured");

		await this.sendToNode(node.tailscaleIp, {
			type: "update_backlog",
			project,
			fromNode: loadHubConfig().nodeLabel,
		});

		this.notify({
			kind: "backlog_update",
			fromNode: loadHubConfig().nodeLabel,
			message: `Pushed "${project.name}" to ${node.name}`,
			projectId: project.id,
			projectName: project.name,
		});
	}

	async runOnPeer(nodeId: string, projectId: string): Promise<void> {
		const node = this.nodes.getNodes().find((n) => n.id === nodeId);
		if (!node || node.isLocal) throw new Error("Node not found or is local");

		const token = getPeerToken();
		if (!token) throw new Error("Peer token not configured");

		await this.sendToNode(node.tailscaleIp, {
			type: "run_project",
			projectId,
			fromNode: loadHubConfig().nodeLabel,
		});

		this.notify({
			kind: "run_started",
			fromNode: loadHubConfig().nodeLabel,
			message: `Started run on ${node.name}`,
			projectId,
		});
	}

	private sendToNode(ip: string, msg: PeerMessage): Promise<void> {
		return new Promise((resolve, reject) => {
			const token = getPeerToken()!;
			const ws = new WebSocket(`ws://${ip}:${this.port}/ws/peers`);
			const t = setTimeout(() => {
				ws.close();
				reject(new Error("Peer connection timeout"));
			}, 8000);

			ws.on("open", () => {
				ws.send(JSON.stringify({ type: "auth", token } satisfies PeerMessage));
				ws.send(JSON.stringify(msg));
				clearTimeout(t);
				ws.close();
				resolve();
			});
			ws.on("error", (err) => {
				clearTimeout(t);
				reject(err);
			});
		});
	}

	async runProjectLocal(projectId: string): Promise<void> {
		await this.runProject(projectId, loadHubConfig().nodeLabel);
	}

	private async runProject(projectId: string, fromNode: string): Promise<void> {
		const project = this.backlog.getById(projectId);
		if (!project) throw new Error("Project not found");

		this.runningProjectId = projectId;
		this.backlog.markBusy(projectId);
		broadcast(this.wss, { type: "backlog_updated", projects: this.backlog.getAll() });

		const instruction = project.stageInstructions[project.stage];
		const promptText = project.workspaceFolder
			? `Workspace folder: ${project.workspaceFolder}\n\n${instruction}`
			: instruction;
		const session = this.host.session_;

		try {
			await session.prompt(promptText);

			// Wait for streaming to finish
			while (session.isStreaming) {
				await new Promise((r) => setTimeout(r, 500));
			}

			this.backlog.markIdle(projectId);
			broadcast(this.wss, { type: "backlog_updated", projects: this.backlog.getAll() });

			const updated = this.backlog.getById(projectId);
			await this.broadcastTaskComplete(projectId, updated?.name ?? project.name, fromNode);
		} finally {
			this.runningProjectId = null;
		}
	}

	async broadcastTaskComplete(projectId: string, projectName: string, fromNode: string): Promise<void> {
		const msg: PeerMessage = {
			type: "task_complete",
			projectId,
			projectName,
			fromNode,
		};

		this.notify({
			kind: "task_complete",
			fromNode,
			message: `Completed "${projectName}"`,
			projectId,
			projectName,
		});

		const token = getPeerToken();
		if (!token) return;

		for (const [, ws] of this.outbound) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify(msg));
			}
		}
	}

	getRunningProjectId(): string | null {
		return this.runningProjectId;
	}
}
