import "./style.css";
import "highlight.js/styles/atom-one-dark.css";
import { initMatrixBg } from "./ui/matrix-bg.js";
import { registerSW } from "virtual:pwa-register";
import { debugLog, initDebugLogUI } from "./debug/log.js";
import { isNativeMobile } from "./platform/detect.js";
import { createBridgeTransport } from "./platform/bridge-transport.js";
import { createMobileTransport } from "./platform/mobile-transport.js";
import { initNativeShell } from "./platform/native-init.js";
import type { ChatTransport } from "./platform/transport.js";
import {
	createInitialState,
	handleAgentEvent,
	handleStateSync,
	type AssistantItem,
	type ExtUIRequest,
} from "./state/session.js";
import { createHubState } from "./state/hub.js";
import {
	closePanel,
	renderExtensionDialog,
	renderMessages,
	renderOAuthStep,
	renderTree,
	showConfirmDialog,
	showInputDialog,
	showToast,
} from "./ui/render.js";
import { renderSessions } from "./ui/sessions.js";
import { renderAgentPanel, patchAgentAuthUi, getAgentStatus } from "./ui/agent-panel.js";
import { renderThinkingControl } from "./ui/thinking-control.js";
import { renderNodes } from "./ui/nodes.js";
import { initPanelCollapse } from "./ui/panel-collapse.js";
import { initMobileNav, switchToChatTab } from "./ui/mobile-nav.js";
import type { ClientCommand, ModelSummary, ProviderAuthSummary, SessionSummary } from "../../shared/protocol.js";

const nativeMobile = isNativeMobile();
if (!nativeMobile) {
	registerSW({ immediate: true });
}

const transport: ChatTransport = nativeMobile ? createMobileTransport() : createBridgeTransport();

const $messages = document.getElementById("messages")!;
const $status = document.getElementById("status-dot")!;
const $statusTxt = document.getElementById("status-text")!;
const $indicator = document.getElementById("streaming-indicator")!;
const $input = document.getElementById("prompt-input") as HTMLTextAreaElement;
const $btnSend = document.getElementById("btn-send")!;
const $btnAbort = document.getElementById("btn-abort")!;
const $bridgeOffline = document.getElementById("bridge-offline")!;
const $workspace = document.getElementById("workspace")!;
const $chatPanel = document.getElementById("chat-panel")!;
const $matrixBg = document.getElementById("matrix-bg") as HTMLCanvasElement;
const $inputBar = document.getElementById("input-bar")!;
const $debugLogBar = document.getElementById("debug-log-bar")!;
const $sessionName = document.getElementById("session-name")!;
const $dialogOverlay = document.getElementById("dialog-overlay")!;
const $sessionsList = document.getElementById("sessions-list")!;
const $nodesList = document.getElementById("nodes-list")!;
const $agentPanel = document.getElementById("agent-panel")!;
const $thinkingControlSlot = document.getElementById("thinking-control-slot")!;
const state = createInitialState();
const hubState = createHubState();
let currentAssistant: AssistantItem | null = null;
let sessions: SessionSummary[] = [];
let showArchived = false;
let configExpanded = false;
let selectedProvider: string | null = null;
let cachedProviders: ProviderAuthSummary[] = [];
let cachedModels: ModelSummary[] = [];
let activeOAuthLogin: { loginId: string; provider: string } | null = null;
let savingAuthFor: string | null = null;
let loadingModelsFor: string | null = null;
let authKeyError: { provider: string; message: string } | null = null;
let pendingApiKey = "";
let authSpinnerTimer: ReturnType<typeof setTimeout> | null = null;
let sessionExplicitlySelected = false;
let pendingPrompt: {
	text: string;
	images?: import("../../shared/protocol.js").ImageContent[];
	streamingBehavior?: "steer" | "followUp";
} | null = null;

const AUTH_SPINNER_TIMEOUT_MS = 30_000;

function clearAuthSpinnerTimer() {
	if (authSpinnerTimer) {
		clearTimeout(authSpinnerTimer);
		authSpinnerTimer = null;
	}
}

function armAuthSpinnerTimer() {
	clearAuthSpinnerTimer();
	authSpinnerTimer = setTimeout(() => {
		authSpinnerTimer = null;
		if (savingAuthFor || loadingModelsFor) {
			savingAuthFor = null;
			loadingModelsFor = null;
			showToast(nativeMobile ? "Timed out — try again" : "Timed out — check bridge connection", "error");
			rerender();
		}
	}, AUTH_SPINNER_TIMEOUT_MS);
}

function listModelsForProvider(provider: string | null | undefined) {
	if (!provider) return;
	send({ type: "list_models", provider });
}

function patchProviderConfigured(provider: string, displayName?: string) {
	const idx = cachedProviders.findIndex((p) => p.provider === provider);
	const patch: ProviderAuthSummary = {
		provider,
		displayName: displayName ?? (idx >= 0 ? cachedProviders[idx]!.displayName : provider),
		configured: true,
		authType: "api_key",
		stored: true,
		source: "stored",
	};
	if (idx >= 0) {
		cachedProviders[idx] = { ...cachedProviders[idx]!, ...patch };
	} else {
		cachedProviders.push(patch);
	}
}

function rerenderSessions() {
	renderSessions(
		$sessionsList,
		sessions,
		sessionExplicitlySelected ? state.sessionId : undefined,
		showArchived,
		{
		onSelect(path) {
			sessionExplicitlySelected = true;
			send({ type: "resume_session", path });
			switchToChatTab();
		},
		onRename(path, currentName) {
			showInputDialog("Rename session", currentName, "Session name", (name) => {
				send({ type: "rename_session", path, name });
			});
		},
		onArchive(path) {
			send({ type: "archive_session", path });
		},
		onUnarchive(path) {
			send({ type: "unarchive_session", path });
		},
		onDelete(path, displayName) {
			showConfirmDialog(
				"Delete session",
				`Permanently delete "${displayName}"? This cannot be undone.`,
				() => send({ type: "delete_session", path }),
			);
		},
	});
}

function rerenderNodes() {
	renderNodes($nodesList, hubState.nodes);
}

function agentPanelOptions() {
	return {
		expanded: configExpanded,
		providers: cachedProviders,
		models: cachedModels,
		appState: state,
		hubState,
		selectedProvider,
		wsState: transport.state,
		authUi: {
			savingFor: savingAuthFor,
			loadingModelsFor: loadingModelsFor,
			error: authKeyError,
			pendingApiKey,
		},
		callbacks: agentPanelCallbacks,
	};
}

function rerenderAgentPanel(partialAuthOnly = false) {
	if (partialAuthOnly && patchAgentAuthUi($agentPanel, agentPanelOptions())) {
		return;
	}
	renderAgentPanel($agentPanel, agentPanelOptions());
}

function rerender() {
	updateStatus();
	updateHeader();
	renderMessages($messages, state, rerender);
	rerenderNodes();
	rerenderSessions();
	rerenderAgentPanel();
	renderThinkingControl($thinkingControlSlot, state, thinkingControlCallbacks);
}

function updateHeader() {
	$sessionName.textContent = state.sessionName || state.model || "";
}

function updateStatus() {
	const { label, statusClass } = getAgentStatus(state, transport.state);
	$status.className = `status-dot ${statusClass}`;
	$statusTxt.textContent = label;

	$btnSend.classList.toggle("hidden", state.streaming);
	$btnAbort.classList.toggle("hidden", !state.streaming);
	$input.disabled = !state.connected;
	$indicator.classList.toggle("hidden", !state.streaming);

	if (nativeMobile) {
		$bridgeOffline.classList.add("hidden");
		$workspace.classList.remove("hidden");
		$debugLogBar.classList.add("hidden");
		return;
	}

	const offline = !state.connected;
	$bridgeOffline.classList.toggle("hidden", !offline);
	$workspace.classList.toggle("hidden", offline);
	$debugLogBar.classList.toggle("hidden", offline);
}

function send(cmd: ClientCommand) {
	debugLog("out", cmd);
	transport.send(cmd);
}

function refreshAgentConfig() {
	if (!state.connected) return;
	send({ type: "get_auth_status" });
}

function onProviderSelected(provider: string) {
	selectedProvider = provider;
	authKeyError = null;
	pendingApiKey = "";
	const auth = cachedProviders.find((p) => p.provider === provider);
	if (auth?.configured) {
		listModelsForProvider(provider);
	} else {
		cachedModels = [];
	}
	rerender();
}

const agentPanelCallbacks = {
	onSetAgentName(name: string) {
		send({ type: "set_hub_config", config: { agentName: name } });
	},
	onSetAgentRole(role: string) {
		send({ type: "set_hub_config", config: { agentRole: role } });
	},
	onToggleExpand() {
		configExpanded = !configExpanded;
		if (configExpanded && cachedProviders.length === 0) {
			refreshAgentConfig();
		}
		rerender();
	},
	onProviderSelect: onProviderSelected,
	onSaveApiKey(provider: string, apiKey: string) {
		savingAuthFor = provider;
		authKeyError = null;
		pendingApiKey = apiKey;
		armAuthSpinnerTimer();
		rerenderAgentPanel(true);
		send({ type: "set_auth", provider, apiKey });
	},
	onOAuthConnect(provider: string, _displayName: string) {
		activeOAuthLogin = { loginId: "", provider };
		send({ type: "oauth_login", provider });
	},
	onRemoveAuth(provider: string) {
		if (authKeyError?.provider === provider) authKeyError = null;
		if (selectedProvider === provider) pendingApiKey = "";
		send({ type: "remove_auth", provider });
	},
	onModelSelect(provider: string, modelId: string) {
		send({ type: "set_model", provider, modelId });
	},
};

const thinkingControlCallbacks = {
	onSetThinkingLevel(level: string) {
		send({ type: "set_thinking_level", level });
	},
};

function handleOAuthStep(event: Record<string, unknown>) {
	const loginId = event.loginId as string;
	const provider = event.provider as string;
	activeOAuthLogin = { loginId, provider };

	renderOAuthStep(event, {
		loginId,
		provider,
		stepId: event.stepId as string | undefined,
		onRespond: (response) => {
			const stepId = (response.stepId as string | undefined) ?? (event.stepId as string | undefined);
			if (!stepId) return;
			send({
				type: "oauth_login_response",
				loginId,
				stepId,
				cancelled: response.cancelled as boolean | undefined,
				value: response.value as string | undefined,
				selectedId: response.selectedId as string | undefined,
			});
		},
		onCancel: () => {
			send({ type: "oauth_login_cancel", provider });
			activeOAuthLogin = null;
			showToast("Login cancelled", "info");
		},
	});
}

function handleAuthSaved(provider: string, displayName: string) {
	clearAuthSpinnerTimer();
	savingAuthFor = null;
	authKeyError = null;
	pendingApiKey = "";
	configExpanded = true;
	if (!selectedProvider) selectedProvider = provider;
	patchProviderConfigured(provider, displayName);
	loadingModelsFor = provider;
	armAuthSpinnerTimer();
	showToast(`${displayName} configured — pick a model`, "info");
	debugLog("info", `auth saved: ${provider}`);
	send({ type: "get_auth_status" });
	listModelsForProvider(provider);
	rerender();
}

function handleServerEvent(event: Record<string, unknown>) {
	debugLog("in", event);

	if (event.type === "state_sync") {
		currentAssistant = null;
		handleStateSync(state, event);
		if (!state.modelAuthConfigured) {
			configExpanded = true;
		}
		if (state.modelProvider) {
			if (!selectedProvider) selectedProvider = state.modelProvider;
			const auth = cachedProviders.find((p) => p.provider === state.modelProvider);
			if (auth?.configured && cachedModels.length === 0) {
				listModelsForProvider(state.modelProvider);
			}
		}
		rerender();
		send({ type: "list_sessions" });

		if (pendingPrompt) {
			const queued = pendingPrompt;
			pendingPrompt = null;
			sessionExplicitlySelected = true;
			state.items.push({ kind: "user", text: queued.text });
			state.streaming = true;
			rerender();
			dispatchPrompt(queued);
		}
		return;
	}

	if (event.type === "session_list") {
		debugLog("info", "panel: sessions");
		sessions = event.sessions as SessionSummary[];
		rerenderSessions();
		return;
	}

	if (event.type === "node_list") {
		hubState.nodes = event.nodes as typeof hubState.nodes;
		rerenderNodes();
		return;
	}

	if (event.type === "hub_config") {
		hubState.hubConfig = event.config as typeof hubState.hubConfig;
		rerenderAgentPanel();
		return;
	}

	if (event.type === "extension_ui_request") {
		const req = event as unknown as ExtUIRequest;
		if (req.method === "notify") {
			showToast(req.statusText ?? req.message ?? "", req.notifyType ?? "info");
		} else if (["select", "confirm", "input", "editor"].includes(req.method)) {
			state.dialog = req;
			renderExtensionDialog(state.dialog, (value) => {
				state.dialog = null;
				send({ type: "extension_ui_response", ...value });
			});
		}
		return;
	}

	if (event.type === "extension_error") {
		showToast(`Extension error: ${event.error as string}`, "error");
		return;
	}

	if (event.type === "error") {
		if (savingAuthFor || loadingModelsFor) {
			clearAuthSpinnerTimer();
			savingAuthFor = null;
			loadingModelsFor = null;
		}
		if (pendingPrompt) {
			pendingPrompt = null;
			state.streaming = false;
		}
		showToast(event.message as string, "error");
		rerender();
		return;
	}

	if (event.type === "model_list") {
		debugLog("info", "models cached for agent config");
		cachedModels = event.models as ModelSummary[];
		state.modelRegistryError = event.error as string | undefined;
		clearAuthSpinnerTimer();
		loadingModelsFor = null;
		rerender();
		return;
	}

	if (event.type === "auth_status") {
		state.modelRegistryError = event.modelRegistryError as string | undefined;
		cachedProviders = event.providers as ProviderAuthSummary[];
		if (!selectedProvider && state.modelProvider) {
			selectedProvider = state.modelProvider;
		}
		if (nativeMobile && !selectedProvider && cachedProviders.length > 0) {
			selectedProvider = cachedProviders[0]!.provider;
		}
		if (selectedProvider) {
			const auth = cachedProviders.find((p) => p.provider === selectedProvider);
			if (auth?.configured) {
				listModelsForProvider(selectedProvider);
			} else {
				cachedModels = [];
			}
		}
		rerender();
		return;
	}

	if (event.type === "auth_saved") {
		handleAuthSaved(event.provider as string, event.displayName as string);
		return;
	}

	if (event.type === "auth_failed") {
		clearAuthSpinnerTimer();
		savingAuthFor = null;
		loadingModelsFor = null;
		const message = event.message as string;
		authKeyError = {
			provider: event.provider as string,
			message,
		};
		showToast(message, "error");
		rerender();
		return;
	}

	if (event.type === "oauth_login_step") {
		handleOAuthStep(event);
		return;
	}

	if (event.type === "oauth_login_complete") {
		activeOAuthLogin = null;
		if (event.error) {
			showToast(`Login failed: ${event.error as string}`, "error");
		} else {
			configExpanded = true;
			send({ type: "get_auth_status" });
			const oauthProvider = event.provider as string | undefined;
			if (oauthProvider) listModelsForProvider(oauthProvider);
		}
		return;
	}

	if (event.type === "session_tree") {
		debugLog("info", "panel: tree");
		renderTree(event.tree, event.leafId as string | null, (targetId) => {
			send({ type: "navigate_tree", targetId });
		});
		return;
	}

	currentAssistant = handleAgentEvent(state, event, currentAssistant);

	if (event.type === "agent_end") {
		send({ type: "list_sessions" });
	}

	if (event.type === "message_end") {
		const msg = event.message as Record<string, unknown> | undefined;
		if (msg?.role === "user" || msg?.role === "assistant") {
			send({ type: "list_sessions" });
		}
	}

	rerender();
}

function readPendingImages() {
	const pending = (window as unknown as { __piPendingImages?: import("../../shared/protocol.js").ImageContent[] }).__piPendingImages;
	if (pending?.length) {
		(window as unknown as { __piPendingImages?: import("../../shared/protocol.js").ImageContent[] }).__piPendingImages = [];
		return pending;
	}
	return undefined;
}

function dispatchPrompt(opts: {
	text: string;
	images?: import("../../shared/protocol.js").ImageContent[];
	streamingBehavior?: "steer" | "followUp";
}) {
	if (opts.streamingBehavior) {
		send({ type: "prompt", message: opts.text, streamingBehavior: opts.streamingBehavior, images: opts.images });
	} else {
		send({ type: "prompt", message: opts.text, images: opts.images });
	}
}

function sendPrompt() {
	const text = $input.value.trim();
	if (!text || !state.connected) return;

	if (!state.modelAuthConfigured) {
		configExpanded = true;
		showToast("Configure your API key in Agent → Configure before chatting.", "warning");
		rerender();
		return;
	}

	const wasStreaming = state.streaming;
	state.items.push({ kind: "user", text });
	$input.value = "";
	autoResizeInput();
	state.streaming = true;
	rerender();

	const images = readPendingImages();
	const promptOpts = {
		text,
		images,
		streamingBehavior: wasStreaming ? ("steer" as const) : undefined,
	};

	if (!sessionExplicitlySelected) {
		pendingPrompt = promptOpts;
		send({ type: "new_session" });
		return;
	}

	dispatchPrompt(promptOpts);
}

function autoResizeInput() {
	$input.style.height = "auto";
	$input.style.height = `${Math.min($input.scrollHeight, 200)}px`;
}

function fileToImageContent(file: File): Promise<import("../../shared/protocol.js").ImageContent | null> {
	return new Promise((resolve) => {
		if (!file.type.startsWith("image/")) {
			resolve(null);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			const base64 = result.split(",")[1];
			if (!base64) {
				resolve(null);
				return;
			}
			resolve({ type: "image", data: base64, mimeType: file.type });
		};
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(file);
	});
}

async function attachImages(files: FileList | File[]) {
	const list = (window as unknown as { __piPendingImages?: import("../../shared/protocol.js").ImageContent[] }).__piPendingImages ?? [];
	for (const file of files) {
		const img = await fileToImageContent(file);
		if (img) list.push(img);
	}
	(window as unknown as { __piPendingImages?: import("../../shared/protocol.js").ImageContent[] }).__piPendingImages = list;
	if (list.length) showToast(`${list.length} image(s) attached`, "info");
}

// Event wiring
$btnSend.addEventListener("click", sendPrompt);
$btnAbort.addEventListener("click", () => send({ type: "abort" }));
document.getElementById("btn-new")!.addEventListener("click", () => {
	sessionExplicitlySelected = true;
	send({ type: "new_session" });
});
document.getElementById("btn-show-archived")!.addEventListener("click", () => {
	showArchived = !showArchived;
	document.getElementById("btn-show-archived")!.classList.toggle("active", showArchived);
	rerenderSessions();
});
document.getElementById("btn-tree")!.addEventListener("click", () => {
	debugLog("info", "panel: tree open");
	send({ type: "get_tree" });
});
document.getElementById("panel-close")!.addEventListener("click", () => {
	closePanel();
});

document.getElementById("bridge-retry")!.addEventListener("click", () => {
	$statusTxt.textContent = "Connecting…";
	transport.connect();
});

$input.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendPrompt();
	}
});
$input.addEventListener("input", autoResizeInput);

$input.addEventListener("paste", (e) => {
	const items = e.clipboardData?.files;
	if (items?.length) {
		e.preventDefault();
		attachImages(items);
	}
});

$input.addEventListener("dragover", (e) => e.preventDefault());
$input.addEventListener("drop", (e) => {
	e.preventDefault();
	if (e.dataTransfer?.files?.length) attachImages(e.dataTransfer.files);
});

$dialogOverlay.addEventListener("click", (e) => {
	if (e.target === $dialogOverlay) {
		if (state.dialog) {
			send({ type: "extension_ui_response", id: state.dialog.id, cancelled: true });
			state.dialog = null;
		} else if (activeOAuthLogin) {
			send({ type: "oauth_login_cancel", provider: activeOAuthLogin.provider });
			activeOAuthLogin = null;
			showToast("Login cancelled", "info");
		}
		$dialogOverlay.classList.add("hidden");
	}
});

transport.onStateChange = (connState) => {
	state.connected = connState === "connected";
	debugLog("info", `connection: ${connState}`);
	if (!state.connected) {
		state.streaming = false;
		currentAssistant = null;
		selectedProvider = null;
		cachedProviders = [];
		cachedModels = [];
		clearAuthSpinnerTimer();
		savingAuthFor = null;
		loadingModelsFor = null;
		authKeyError = null;
		pendingApiKey = "";
	} else {
		send({ type: "list_sessions" });
		send({ type: "get_hub_config" });
		send({ type: "get_auth_status" });
		if (!nativeMobile) {
			send({ type: "get_nodes" });
		}
		if (state.modelProvider) {
			selectedProvider = state.modelProvider;
			listModelsForProvider(state.modelProvider);
		}
	}
	updateStatus();
	rerender();
};

if (nativeMobile) {
	void initNativeShell();
	initPanelCollapse($workspace);
	initMobileNav($workspace);
	initMatrixBg($chatPanel, $matrixBg);
	transport.subscribe(handleServerEvent);
	transport.connect();
	rerender();
} else {
	initDebugLogUI();
	initPanelCollapse($workspace);
	initMobileNav($workspace);
	initMatrixBg($chatPanel, $matrixBg);
	transport.subscribe(handleServerEvent);
	transport.connect();
	rerender();
}
