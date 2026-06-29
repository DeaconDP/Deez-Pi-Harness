import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
	AuthStorage,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	type AgentSessionRuntime,
} from "@earendil-works/pi-coding-agent";
import type { WebSocketServer } from "ws";
import { broadcast, createExtensionUIContext } from "./extension-ui.js";
import { hasRequestAuth } from "./prompt-auth.js";

export interface AgentHostOptions {
	cwd: string;
	port: number;
	wss: WebSocketServer;
}

export class AgentHost {
	readonly cwd: string;
	readonly wss: WebSocketServer;
	private runtime!: AgentSessionRuntime;
	private session!: AgentSession;
	private unsubscribe: (() => void) | undefined;
	readonly authStorage: ReturnType<typeof AuthStorage.create>;
	readonly modelRegistry: ModelRegistry;

	constructor(options: AgentHostOptions) {
		this.cwd = options.cwd;
		this.wss = options.wss;
		this.authStorage = AuthStorage.create();
		this.modelRegistry = ModelRegistry.create(this.authStorage);
	}

	async init() {
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({ cwd });
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		this.runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: this.cwd,
			agentDir: getAgentDir(),
			sessionManager: SessionManager.create(this.cwd),
		});

		this.runtime.setRebindSession(async (session) => {
			await this.attachSession(session);
		});

		await this.attachSession(this.runtime.session);
	}

	private async attachSession(session: AgentSession) {
		if (this.unsubscribe) {
			this.unsubscribe();
		}
		this.session = session;
		this.unsubscribe = this.session.subscribe((event) => {
			broadcast(this.wss, event);
		});
		await this.session.bindExtensions({
			uiContext: createExtensionUIContext(this.wss) as never,
			onError: (err) => {
				broadcast(this.wss, {
					type: "extension_error",
					extensionPath: err.extensionPath,
					event: err.event,
					error: err.error,
				});
			},
		});
	}

	get session_(): AgentSession {
		return this.session;
	}

	get runtime_(): AgentSessionRuntime {
		return this.runtime;
	}

	async buildStateSync() {
		const model = this.session.model;
		let modelAuthConfigured = false;
		if (model) {
			const auth = await this.modelRegistry.getApiKeyAndHeaders(model);
			modelAuthConfigured = hasRequestAuth(auth);
		}
		return {
			type: "state_sync" as const,
			messages: this.session.messages,
			streaming: this.session.isStreaming,
			model: model?.id,
			modelProvider: model?.provider,
			modelAuthConfigured,
			sessionId: this.session.sessionId,
			cwd: this.cwd,
			sessionName: this.session.sessionManager.getSessionName(),
			thinkingLevel: this.session.thinkingLevel,
			supportsThinking: this.session.supportsThinking(),
			availableThinkingLevels: this.session.getAvailableThinkingLevels(),
		};
	}

	async afterSessionReplacement() {
		await this.attachSession(this.runtime.session);
		broadcast(this.wss, await this.buildStateSync());
	}

	async dispose() {
		if (this.unsubscribe) this.unsubscribe();
		await this.runtime.dispose();
	}
}
