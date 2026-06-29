import type { ClientCommand, ImageContent, ModelSummary, ProviderAuthSummary } from "../../../shared/protocol.js";
import type { ConversationItem } from "../state/session.js";
import { hasApiKey, getApiKey, removeApiKey, setApiKey } from "../mobile/credentials.js";
import {
	agentEndEvent,
	agentStartEvent,
	assistantMessageEnd,
	assistantMessageEvent,
	assistantMessageStart,
} from "../mobile/event-adapter.js";
import {
	OPENROUTER_PROVIDER,
	streamOpenRouterChat,
	validateOpenRouterKey,
	fetchOpenRouterModels,
} from "../mobile/providers/openrouter.js";
import {
	createSession,
	deleteSession,
	archiveSession,
	getActiveSessionPath,
	getHubConfig,
	getModelSelection,
	listSessionMetas,
	loadSession,
	renameSession,
	saveSessionItems,
	setActiveSessionPath,
	setHubConfig,
	setModelSelection,
} from "../mobile/session-store.js";
import type { ChatTransport, ConnectionState, MessageHandler } from "./transport.js";

const OPENROUTER_DISPLAY = "OpenRouter";

export function createMobileTransport(): ChatTransport {
	let state: ConnectionState = "connecting";
	let handlers = new Set<MessageHandler>();
	let abortController: AbortController | null = null;
	let activeItems: ConversationItem[] = [];
	let activePath: string | null = null;

	const emit = (event: Record<string, unknown>) => {
		for (const handler of handlers) handler(event);
	};

	const setState = (next: ConnectionState) => {
		state = next;
		transport.onStateChange?.(next);
	};

	async function emitStateSync() {
		const model = await getModelSelection();
		const hasKey = await hasApiKey(OPENROUTER_PROVIDER);
		const hub = await getHubConfig();
		activePath = await getActiveSessionPath();
		if (activePath) {
			const session = await loadSession(activePath);
			activeItems = session?.items ?? [];
		} else {
			activeItems = [];
		}

		const messages = activeItems.flatMap((item) => {
			if (item.kind === "user") {
				return [{ role: "user", content: item.text }];
			}
			const text = item.blocks
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("");
			return text ? [{ role: "assistant", content: [{ type: "text", text }] }] : [];
		});

		emit({
			type: "state_sync",
			messages,
			streaming: false,
			model: model?.modelName ?? model?.modelId,
			modelProvider: model?.provider,
			modelAuthConfigured: hasKey && Boolean(model?.modelId),
			sessionId: activePath ?? undefined,
			sessionName: activePath ? (await loadSession(activePath))?.meta.name : undefined,
			cwd: "mobile://local",
			thinkingLevel: undefined,
			supportsThinking: false,
			availableThinkingLevels: [],
		});

		emit({
			type: "hub_config",
			config: {
				agentName: hub.agentName,
				agentRole: hub.agentRole,
				nodeLabel: "mobile",
			},
		});
	}

	async function emitAuthStatus() {
		const configured = await hasApiKey(OPENROUTER_PROVIDER);
		const providers: ProviderAuthSummary[] = [
			{
				provider: OPENROUTER_PROVIDER,
				displayName: OPENROUTER_DISPLAY,
				configured,
				authType: "api_key",
				stored: configured,
				source: "stored",
			},
		];
		emit({ type: "auth_status", providers });
	}

	async function emitSessionList() {
		const metas = await listSessionMetas(false);
		emit({
			type: "session_list",
			sessions: metas.map((m) => ({
				path: m.path,
				id: m.id,
				cwd: "mobile://local",
				name: m.name,
				modified: m.modified,
				messageCount: m.messageCount,
				firstMessage: m.firstMessage,
				archived: m.archived,
			})),
		});
	}

	async function runPrompt(text: string, images?: ImageContent[]) {
		const apiKey = await getApiKey(OPENROUTER_PROVIDER);
		const model = await getModelSelection();
		if (!apiKey) {
			emit({ type: "error", message: "Configure your OpenRouter API key in Agent → Configure." });
			return;
		}
		if (!model?.modelId) {
			emit({ type: "error", message: "Select a model in Agent → Configure." });
			return;
		}

		if (!activePath) {
			const session = await createSession();
			activePath = session.meta.path;
		}

		activeItems.push({ kind: "user", text });
		await saveSessionItems(activePath, activeItems);

		abortController = new AbortController();
		let accumulated = "";

		emit(agentStartEvent());
		emit(assistantMessageStart());

		try {
			await streamOpenRouterChat({
				apiKey,
				modelId: model.modelId,
				history: activeItems.slice(0, -1),
				userText: text,
				images,
				signal: abortController.signal,
				callbacks: {
					onDelta(delta) {
						accumulated += delta;
						emit(assistantMessageEvent(accumulated, true));
					},
					onDone() {
						emit(assistantMessageEnd(accumulated));
						emit(agentEndEvent());
						activeItems.push({
							kind: "assistant",
							blocks: accumulated ? [{ type: "text", text: accumulated }] : [],
							streaming: false,
						});
						if (activePath) saveSessionItems(activePath, activeItems);
						emitSessionList();
					},
					onError(message) {
						if (message.toLowerCase().includes("aborted")) {
							emit(assistantMessageEnd(accumulated || "Operation aborted"));
							emit(agentEndEvent());
							return;
						}
						emit({ type: "error", message });
						emit(agentEndEvent());
					},
				},
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (!message.toLowerCase().includes("aborted")) {
				emit({ type: "error", message });
			}
			emit(agentEndEvent());
		} finally {
			abortController = null;
		}
	}

	const transport: ChatTransport = {
		get state() {
			return state;
		},
		onStateChange: undefined,
		connect() {
			setState("connecting");
			void (async () => {
				const path = await getActiveSessionPath();
				if (!path) {
					await createSession();
				}
				await emitStateSync();
				await emitAuthStatus();
				await emitSessionList();
				setState("connected");
			})();
		},
		disconnect() {
			abortController?.abort();
			abortController = null;
			setState("disconnected");
		},
		send(cmd: ClientCommand) {
			void handleCommand(cmd);
		},
		subscribe(handler: MessageHandler) {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
	};

	async function handleCommand(cmd: ClientCommand) {
		switch (cmd.type) {
			case "prompt":
			case "steer":
			case "follow_up":
				await runPrompt(cmd.message, cmd.images);
				break;
			case "abort":
				abortController?.abort();
				abortController = null;
				break;
			case "get_auth_status":
				await emitAuthStatus();
				break;
			case "set_auth": {
				if (cmd.provider !== OPENROUTER_PROVIDER) {
					emit({
						type: "auth_failed",
						provider: cmd.provider,
						message: "Only OpenRouter API keys are supported on mobile.",
					});
					return;
				}
				try {
					await validateOpenRouterKey(cmd.apiKey);
					await setApiKey(cmd.provider, cmd.apiKey);
					emit({
						type: "auth_saved",
						provider: cmd.provider,
						displayName: OPENROUTER_DISPLAY,
					});
				} catch (err) {
					emit({
						type: "auth_failed",
						provider: cmd.provider,
						message: err instanceof Error ? err.message : String(err),
					});
				}
				break;
			}
			case "remove_auth":
				await removeApiKey(cmd.provider);
				await emitAuthStatus();
				await emitStateSync();
				break;
			case "list_models": {
				if (cmd.provider && cmd.provider !== OPENROUTER_PROVIDER) {
					emit({ type: "model_list", models: [], error: "Mobile supports OpenRouter only." });
					return;
				}
				const apiKey = await getApiKey(OPENROUTER_PROVIDER);
				if (!apiKey) {
					emit({ type: "model_list", models: [], error: "Configure OpenRouter API key first." });
					return;
				}
				try {
					const models = await fetchOpenRouterModels(apiKey);
					const current = await getModelSelection();
					const summaries: ModelSummary[] = models.map((m) => ({
						provider: OPENROUTER_PROVIDER,
						id: m.id,
						name: m.name,
						available: true,
					}));
					emit({
						type: "model_list",
						models: summaries,
						current: current ? { provider: current.provider, id: current.modelId } : undefined,
					});
				} catch (err) {
					emit({
						type: "model_list",
						models: [],
						error: err instanceof Error ? err.message : String(err),
					});
				}
				break;
			}
			case "set_model":
				await setModelSelection({
					provider: cmd.provider,
					modelId: cmd.modelId,
					modelName: cmd.modelId,
				});
				await emitStateSync();
				break;
			case "new_session": {
				const session = await createSession();
				activePath = session.meta.path;
				activeItems = [];
				await emitStateSync();
				await emitSessionList();
				break;
			}
			case "list_sessions":
				await emitSessionList();
				break;
			case "resume_session": {
				await setActiveSessionPath(cmd.path);
				activePath = cmd.path;
				const session = await loadSession(cmd.path);
				activeItems = session?.items ?? [];
				await emitStateSync();
				break;
			}
			case "rename_session":
				await renameSession(cmd.path, cmd.name);
				await emitSessionList();
				if (activePath === cmd.path) await emitStateSync();
				break;
			case "archive_session":
				await archiveSession(cmd.path, true);
				await emitSessionList();
				break;
			case "unarchive_session":
				await archiveSession(cmd.path, false);
				await emitSessionList();
				break;
			case "delete_session":
				await deleteSession(cmd.path);
				activePath = await getActiveSessionPath();
				if (activePath) {
					const session = await loadSession(activePath);
					activeItems = session?.items ?? [];
				} else {
					activeItems = [];
				}
				await emitStateSync();
				await emitSessionList();
				break;
			case "get_hub_config": {
				const hub = await getHubConfig();
				emit({
					type: "hub_config",
					config: {
						agentName: hub.agentName,
						agentRole: hub.agentRole,
						nodeLabel: "mobile",
					},
				});
				break;
			}
			case "set_hub_config":
				await setHubConfig({
					agentName: cmd.config.agentName,
					agentRole: cmd.config.agentRole,
				});
				await emitStateSync();
				break;
			case "get_nodes":
				emit({ type: "node_list", nodes: [] });
				break;
			case "oauth_login":
			case "oauth_login_cancel":
			case "oauth_login_response":
				emit({
					type: "error",
					message: "OAuth login is not available on mobile. Use an API key.",
				});
				break;
			case "get_tree":
			case "navigate_tree":
			case "compact":
			case "get_backlog":
			case "update_backlog":
			case "reorder_backlog":
			case "add_backlog_project":
			case "delete_backlog_project":
			case "run_backlog_project":
			case "push_backlog_to_peer":
			case "set_thinking_level":
			case "cycle_thinking_level":
			case "cycle_model":
			case "extension_ui_response":
				emit({ type: "error", message: "Not available on mobile." });
				break;
			default:
				break;
		}
	}

	return transport;
}
