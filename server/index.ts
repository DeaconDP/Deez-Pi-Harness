/**
 * Pi PWA bridge server — localhost-only HTTP + WebSocket.
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { WebSocketServer, type WebSocket } from "ws";
import { AgentHost } from "./agent.js";
import { BacklogStore } from "./backlog.js";
import { deleteSessionFile } from "./session-actions.js";
import { SessionArchiveStore } from "./session-archive.js";
import { broadcastAuthStatus } from "./auth.js";
import { cancelOAuthLogin, resolveOAuthLoginResponse, runOAuthLogin } from "./auth-login.js";
import { getPromptAuthError } from "./prompt-auth.js";
import { validateProviderApiKey } from "./validate-auth.js";
import { resolveBindHost, loadHubConfig, saveHubConfig } from "./config.js";
import { broadcast, resolveExtensionUIResponse } from "./extension-ui.js";
import { NodeRegistry, buildNodeStatusJson } from "./nodes.js";
import { PeerHub } from "./peers.js";
import type { ClientCommand, ImageContent as WireImage } from "../shared/protocol.js";
import { DEFAULT_PORT } from "../shared/protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolvePublicDir(): string {
	const candidates = [
		path.resolve(__dirname, "../client/dist"),
		path.resolve(__dirname, "../../client/dist"),
	];
	for (const dir of candidates) {
		if (fs.existsSync(path.join(dir, "index.html"))) return dir;
	}
	return candidates[0];
}

const PUBLIC_DIR = resolvePublicDir();

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".webmanifest": "application/manifest+json",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
	let urlPath = req.url ?? "/";
	const qIdx = urlPath.indexOf("?");
	if (qIdx !== -1) urlPath = urlPath.slice(0, qIdx);

	try {
		urlPath = decodeURIComponent(urlPath);
	} catch {
		/* ignore */
	}

	const safePath = path.normalize(urlPath).replace(/\\/g, "/");
	const target = safePath === "/" ? "index.html" : safePath.replace(/^\//, "");
	const absPath = path.join(PUBLIC_DIR, target);

	if (!absPath.startsWith(PUBLIC_DIR + path.sep) && absPath !== PUBLIC_DIR) {
		res.writeHead(403);
		res.end("Forbidden");
		return;
	}

	const ext = path.extname(absPath).toLowerCase();
	const mime = MIME[ext] ?? "application/octet-stream";

	fs.readFile(absPath, (err, data) => {
		if (err) {
			fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, d2) => {
				if (e2) {
					res.writeHead(404);
					res.end("Not found");
					return;
				}
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(d2);
			});
			return;
		}
		res.writeHead(200, { "Content-Type": mime });
		res.end(data);
	});
}

function toPiImages(images?: WireImage[]) {
	if (!images?.length) return undefined;
	return images.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
}

async function broadcastSessionList(host: AgentHost, archive: SessionArchiveStore) {
	const sessions = await SessionManager.list(host.cwd);
	broadcast(host.wss, {
		type: "session_list",
		sessions: sessions.map((s) => ({
			path: s.path,
			id: s.id,
			cwd: s.cwd,
			name: s.name,
			modified: s.modified.toISOString(),
			messageCount: s.messageCount,
			firstMessage: s.firstMessage,
			archived: archive.isArchived(s.path),
		})),
	});
}

async function handleCommand(
	host: AgentHost,
	cmd: ClientCommand,
	backlog: BacklogStore,
	peerHub: PeerHub,
	nodes: NodeRegistry,
	archive: SessionArchiveStore,
) {
	const session = host.session_;

	switch (cmd.type) {
		case "prompt": {
			const authError = await getPromptAuthError(host, session);
			if (authError) {
				broadcast(host.wss, { type: "error", message: authError });
				break;
			}
			const images = toPiImages(cmd.images);
			if (session.isStreaming) {
				await session.prompt(cmd.message, {
					streamingBehavior: cmd.streamingBehavior ?? "followUp",
					images,
				});
			} else {
				session.prompt(cmd.message, { images }).catch((err) => {
					console.error("[prompt error]", err);
					broadcast(host.wss, {
						type: "error",
						message: err instanceof Error ? err.message : String(err),
					});
				});
			}
			break;
		}

		case "steer":
			await session.steer(cmd.message, toPiImages(cmd.images));
			break;

		case "follow_up":
			await session.followUp(cmd.message, toPiImages(cmd.images));
			break;

		case "abort":
			await session.abort();
			break;

		case "new_session": {
			const result = await host.runtime_.newSession();
			if (!result.cancelled) await host.afterSessionReplacement();
			break;
		}

		case "list_sessions":
			await broadcastSessionList(host, archive);
			break;

		case "resume_session": {
			const result = await host.runtime_.switchSession(cmd.path);
			if (!result.cancelled) await host.afterSessionReplacement();
			break;
		}

		case "rename_session": {
			const name = cmd.name.trim();
			if (!name) {
				broadcast(host.wss, { type: "error", message: "Session name cannot be empty." });
				break;
			}
			const activePath = session.sessionManager.getSessionFile();
			if (cmd.path === activePath) {
				session.setSessionName(name);
				broadcast(host.wss, await host.buildStateSync());
			} else {
				const mgr = SessionManager.open(cmd.path);
				mgr.appendSessionInfo(name);
			}
			await broadcastSessionList(host, archive);
			break;
		}

		case "delete_session": {
			const activePath = session.sessionManager.getSessionFile();
			if (cmd.path === activePath) {
				broadcast(host.wss, {
					type: "error",
					message: "Cannot delete the active session. Switch to another session first.",
				});
				break;
			}
			const result = await deleteSessionFile(cmd.path);
			if (!result.ok) {
				broadcast(host.wss, {
					type: "error",
					message: result.error ?? "Failed to delete session.",
				});
				break;
			}
			archive.remove(cmd.path);
			await broadcastSessionList(host, archive);
			break;
		}

		case "archive_session":
			archive.archive(cmd.path);
			await broadcastSessionList(host, archive);
			break;

		case "unarchive_session":
			archive.unarchive(cmd.path);
			await broadcastSessionList(host, archive);
			break;

		case "set_model": {
			const model = host.modelRegistry.find(cmd.provider, cmd.modelId);
			if (!model) {
				broadcast(host.wss, {
					type: "error",
					message: `Model not found: ${cmd.provider}/${cmd.modelId}`,
				});
				break;
			}
			const auth = await host.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				broadcast(host.wss, {
					type: "error",
					message: auth.error,
				});
				break;
			}
			await session.setModel(model);
			broadcast(host.wss, await host.buildStateSync());
			break;
		}

		case "cycle_model": {
			await session.cycleModel(cmd.direction);
			broadcast(host.wss, await host.buildStateSync());
			break;
		}

		case "set_thinking_level":
			session.setThinkingLevel(cmd.level as never);
			broadcast(host.wss, await host.buildStateSync());
			break;

		case "cycle_thinking_level":
			session.cycleThinkingLevel();
			broadcast(host.wss, await host.buildStateSync());
			break;

		case "navigate_tree": {
			const result = await session.navigateTree(cmd.targetId);
			if (!result.cancelled) {
				broadcast(host.wss, await host.buildStateSync());
			}
			break;
		}

		case "get_tree":
			broadcast(host.wss, {
				type: "session_tree",
				tree: session.sessionManager.getTree(),
				leafId: session.sessionManager.getLeafId(),
			});
			break;

		case "compact":
			await session.compact(cmd.customInstructions);
			break;

		case "list_models": {
			const registryError = host.modelRegistry.getError();
			const allModels = host.modelRegistry.getAll();
			const models = cmd.provider
				? allModels.filter((m) => m.provider === cmd.provider)
				: allModels;
			const current = session.model;
			broadcast(host.wss, {
				type: "model_list",
				models: models.map((m) => ({
					provider: m.provider,
					id: m.id,
					name: m.name,
					available: host.modelRegistry.hasConfiguredAuth(m),
				})),
				current: current ? { provider: current.provider, id: current.id } : undefined,
				error: registryError,
			});
			break;
		}

		case "get_auth_status":
			broadcastAuthStatus(host);
			break;

		case "set_auth": {
			const apiKey = cmd.apiKey.trim();
			if (!apiKey) {
				broadcast(host.wss, { type: "error", message: "API key cannot be empty." });
				break;
			}
			host.authStorage.set(cmd.provider, { type: "api_key", key: apiKey });
			host.modelRegistry.refresh();
			const validation = await validateProviderApiKey(host, cmd.provider);
			if (!validation.ok) {
				host.authStorage.remove(cmd.provider);
				host.modelRegistry.refresh();
				broadcastAuthStatus(host);
				broadcast(host.wss, {
					type: "auth_failed",
					provider: cmd.provider,
					message: validation.message,
				});
				break;
			}
			broadcastAuthStatus(host);
			broadcast(host.wss, {
				type: "auth_saved",
				provider: cmd.provider,
				displayName: host.modelRegistry.getProviderDisplayName(cmd.provider),
			});
			broadcast(host.wss, await host.buildStateSync());
			break;
		}

		case "remove_auth":
			host.authStorage.remove(cmd.provider);
			host.modelRegistry.refresh();
			broadcastAuthStatus(host);
			broadcast(host.wss, await host.buildStateSync());
			break;

		case "oauth_login":
			runOAuthLogin(host, cmd.provider).catch((err) => {
				console.error("[oauth_login error]", err);
				broadcast(host.wss, {
					type: "error",
					message: err instanceof Error ? err.message : String(err),
				});
			});
			break;

		case "oauth_login_cancel":
			cancelOAuthLogin(cmd.provider);
			break;

		case "oauth_login_response":
			resolveOAuthLoginResponse(cmd.stepId, cmd);
			break;

		case "extension_ui_response":
			resolveExtensionUIResponse(cmd.id, cmd);
			break;

		case "get_backlog":
			broadcast(host.wss, { type: "backlog_snapshot", projects: backlog.getAll() });
			break;

		case "update_backlog": {
			backlog.upsert(cmd.project);
			broadcast(host.wss, { type: "backlog_updated", projects: backlog.getAll() });
			break;
		}

		case "add_backlog_project": {
			backlog.add();
			broadcast(host.wss, { type: "backlog_updated", projects: backlog.getAll() });
			break;
		}

		case "delete_backlog_project":
			backlog.remove(cmd.projectId);
			broadcast(host.wss, { type: "backlog_updated", projects: backlog.getAll() });
			break;

		case "reorder_backlog": {
			backlog.reorder(cmd.projectIds);
			broadcast(host.wss, { type: "backlog_updated", projects: backlog.getAll() });
			break;
		}

		case "run_backlog_project": {
			const node = cmd.nodeId ? nodes.getNodes().find((n) => n.id === cmd.nodeId) : undefined;
			if (node && !node.isLocal) {
				await peerHub.runOnPeer(cmd.nodeId!, cmd.projectId);
			} else {
				peerHub.runProjectLocal(cmd.projectId).catch((err) => {
					broadcast(host.wss, {
						type: "error",
						message: err instanceof Error ? err.message : String(err),
					});
				});
			}
			break;
		}

		case "push_backlog_to_peer": {
			const project = backlog.getById(cmd.projectId);
			if (!project) {
				broadcast(host.wss, { type: "error", message: "Project not found" });
				break;
			}
			await peerHub.pushToPeer(cmd.nodeId, project);
			break;
		}

		case "get_nodes":
			broadcast(host.wss, { type: "node_list", nodes: nodes.getNodes() });
			break;

		case "get_hub_config": {
			const config = loadHubConfig();
			broadcast(host.wss, {
				type: "hub_config",
				config: {
					agentRole: config.agentRole,
					agentName: config.agentName,
					nodeLabel: config.nodeLabel,
				},
			});
			break;
		}

		case "set_hub_config": {
			const next = saveHubConfig(cmd.config);
			broadcast(host.wss, {
				type: "hub_config",
				config: {
					agentRole: next.agentRole,
					agentName: next.agentName,
					nodeLabel: next.nodeLabel,
				},
			});
			break;
		}
	}
}

export interface ServerOptions {
	cwd?: string;
	port?: number;
	host?: string;
}

function handleApiRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	host: AgentHost,
): boolean {
	const urlPath = (req.url ?? "/").split("?")[0];

	if (urlPath === "/health" && req.method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
		return true;
	}

	if (urlPath === "/api/node-status" && req.method === "GET") {
		void (async () => {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(await buildNodeStatusJson(host)));
		})();
		return true;
	}

	return false;
}

export async function startServer(options: ServerOptions = {}) {
	const cwd = options.cwd ?? process.cwd();
	const port = options.port ?? Number(process.env.PI_PWA_PORT ?? DEFAULT_PORT);
	const host = options.host ?? resolveBindHost();

	console.log(`Initialising Pi agent (cwd: ${cwd})…`);

	const backlog = new BacklogStore();
	const sessionArchive = new SessionArchiveStore();

	const server = http.createServer((req, res) => {
		// host_ assigned below; use lazy ref for API routes
		if (apiHost && handleApiRequest(req, res, apiHost)) return;
		serveStatic(req, res);
	});

	let apiHost: AgentHost;
	const wss = new WebSocketServer({ server, path: "/ws" });
	apiHost = new AgentHost({ cwd, port, wss });
	await apiHost.init();

	const nodes = new NodeRegistry(apiHost, wss, port);
	const peerHub = new PeerHub(apiHost, wss, backlog, nodes, port);
	peerHub.attachHttp(server);
	await nodes.start();

	console.log(
		`Agent ready (model: ${apiHost.session_.model?.id ?? "default"}, session: ${apiHost.session_.sessionId})`,
	);

	wss.on("connection", (ws: WebSocket) => {
		console.log(`[${new Date().toISOString()}] Client connected (${wss.clients.size} total)`);
		void (async () => {
			ws.send(JSON.stringify(await apiHost.buildStateSync()));
			ws.send(JSON.stringify({ type: "backlog_snapshot", projects: backlog.getAll() }));
			ws.send(JSON.stringify({ type: "node_list", nodes: nodes.getNodes() }));
			const config = loadHubConfig();
			ws.send(
				JSON.stringify({
					type: "hub_config",
					config: {
						agentRole: config.agentRole,
						agentName: config.agentName,
						nodeLabel: config.nodeLabel,
					},
				}),
			);
		})();

		ws.on("message", async (data) => {
			let cmd: ClientCommand;
			try {
				cmd = JSON.parse(data.toString()) as ClientCommand;
			} catch {
				return;
			}
			try {
				await handleCommand(apiHost, cmd, backlog, peerHub, nodes, sessionArchive);
			} catch (err) {
				console.error(`[cmd error] ${cmd.type}:`, err);
				ws.send(
					JSON.stringify({
						type: "error",
						message: err instanceof Error ? err.message : String(err),
					}),
				);
			}
		});

		ws.on("close", () => {
			console.log(
				`[${new Date().toISOString()}] Client disconnected (${wss.clients.size} total)`,
			);
		});

		ws.on("error", (err) => console.error("[ws error]", err));
	});

	await new Promise<void>((resolve) => {
		server.listen(port, host, () => {
			console.log(`Pi PWA bridge listening on http://${host}:${port}`);
			resolve();
		});
	});

	const shutdown = async () => {
		console.log("\nShutting down…");
		nodes.stop();
		peerHub.stop();
		await apiHost.dispose();
		await new Promise<void>((resolve, reject) => {
			wss.close((err) => (err ? reject(err) : resolve()));
		});
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	};

	for (const sig of ["SIGINT", "SIGTERM"] as const) {
		process.on(sig, () => {
			shutdown().then(() => process.exit(0));
		});
	}

	return { server, host: apiHost, shutdown };
}

// Run when executed directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
	const cwdIdx = process.argv.indexOf("--cwd");
	const cwd = cwdIdx !== -1 ? process.argv[cwdIdx + 1] : process.cwd();
	const portIdx = process.argv.indexOf("--port");
	const port = portIdx !== -1 ? Number(process.argv[portIdx + 1]) : undefined;
	startServer({ cwd, port }).catch((err) => {
		console.error("Fatal:", err);
		process.exit(1);
	});
}
