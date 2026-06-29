import type { AppState } from "../state/session.js";
import type { HubState } from "../state/hub.js";
import type { ModelSummary, ProviderAuthSummary } from "../../../shared/protocol.js";
import { createCombobox } from "./combobox.js";
import { getAgentStatus, type AgentStatus, type AgentStatusClass } from "./agent-config.js";

export type { AgentStatus, AgentStatusClass };
export { getAgentStatus };

export interface AgentPanelCallbacks {
	onSetAgentName: (name: string) => void;
	onSetAgentRole: (role: string) => void;
	onToggleExpand: () => void;
	onProviderSelect: (provider: string) => void;
	onSaveApiKey: (provider: string, apiKey: string) => void;
	onOAuthConnect: (provider: string, displayName: string) => void;
	onRemoveAuth: (provider: string) => void;
	onModelSelect: (provider: string, modelId: string) => void;
}

export interface AgentPanelAuthUi {
	savingFor: string | null;
	loadingModelsFor: string | null;
	error: { provider: string; message: string } | null;
	pendingApiKey: string;
}

export interface AgentPanelRenderOptions {
	expanded: boolean;
	providers: ProviderAuthSummary[];
	models: ModelSummary[];
	appState: AppState;
	hubState: HubState;
	selectedProvider: string | null;
	authUi: AgentPanelAuthUi;
	wsState?: "connecting" | "connected" | "disconnected";
	callbacks: AgentPanelCallbacks;
}

const PROVIDER_KEY_URLS: Record<string, string> = {
	openrouter: "https://openrouter.ai/keys",
	openai: "https://platform.openai.com/api-keys",
	anthropic: "https://console.anthropic.com/settings/keys",
	google: "https://aistudio.google.com/apikey",
	groq: "https://console.groq.com/keys",
	mistral: "https://console.mistral.ai/api-keys/",
};

interface FocusState {
	field: string;
	selectionStart?: number;
	selectionEnd?: number;
	value?: string;
}

function captureFocus(container: HTMLElement): FocusState | null {
	const active = document.activeElement;
	if (!active || !container.contains(active) || !(active instanceof HTMLElement)) return null;
	const field = active.dataset.agentField;
	if (!field) return null;
	const state: FocusState = { field };
	if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
		state.selectionStart = active.selectionStart ?? undefined;
		state.selectionEnd = active.selectionEnd ?? undefined;
		state.value = active.value;
	}
	return state;
}

function restoreFocus(container: HTMLElement, focus: FocusState | null) {
	if (!focus) return;
	const el = container.querySelector(`[data-agent-field="${focus.field}"]`);
	if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
	if (focus.value !== undefined) el.value = focus.value;
	el.focus();
	if (focus.selectionStart !== undefined && focus.selectionEnd !== undefined) {
		try {
			el.setSelectionRange(focus.selectionStart, focus.selectionEnd);
		} catch {
			// ignore invalid range for password inputs etc.
		}
	}
}

function authStatusHint(p: ProviderAuthSummary): string {
	if (!p.configured) return "Not configured";
	if (p.source === "environment" && p.label) return `Configured via ${p.label}`;
	if (p.source === "runtime") return `Configured via ${p.label ?? "runtime"}`;
	return "Key saved";
}

function providerBadge(p: ProviderAuthSummary): { badge: string; badgeClass: string } {
	if (p.configured) return { badge: "Configured", badgeClass: "is-configured" };
	if (p.authType === "oauth") return { badge: "OAuth", badgeClass: "is-oauth" };
	return { badge: "Not set", badgeClass: "is-unset" };
}

function modelDisplayLabel(m: ModelSummary): { label: string; suffix?: string } {
	const base = m.name ?? m.id;
	if (/\(free\)/i.test(base)) return { label: base };
	if (/free/i.test(m.id) || /free/i.test(base)) return { label: base, suffix: "(free)" };
	return { label: base };
}

function buildCollapsedSummary(
	opts: AgentPanelRenderOptions,
	selectedAuth: ProviderAuthSummary | undefined,
): string {
	const { selectedProvider, appState } = opts;
	const parts: string[] = [];
	if (selectedProvider && selectedAuth) {
		parts.push(selectedAuth.displayName);
		parts.push(selectedAuth.configured ? "Key saved" : "Key not set");
	} else if (selectedProvider) {
		parts.push(selectedProvider);
	}
	if (appState.model) {
		parts.push(appState.model);
	}
	return parts.length > 0 ? parts.join(" · ") : "Not configured yet";
}

function createField(
	label: string,
	control: () => HTMLElement,
	opts?: { large?: boolean },
): HTMLElement {
	const field = document.createElement("div");
	field.className = "agent-panel-field";

	const l = document.createElement("label");
	l.className = `agent-panel-field-label${opts?.large ? " is-large" : ""}`;
	l.textContent = label;

	field.append(l, control());
	return field;
}

function createHelper(text: string, className = "agent-panel-hint"): HTMLElement {
	const p = document.createElement("p");
	p.className = className;
	p.textContent = text;
	return p;
}

type StepState = "complete" | "active" | "pending";

function createStep(
	number: number,
	title: string,
	description: string,
	state: StepState,
	isLast: boolean,
	renderBody: (body: HTMLElement) => void,
): HTMLElement {
	const step = document.createElement("div");
	step.className = `agent-panel-step${state === "pending" ? " is-pending" : ""}`;
	step.dataset.step = String(number);

	const rail = document.createElement("div");
	rail.className = "agent-panel-step-rail";

	const marker = document.createElement("div");
	marker.className = `agent-panel-step-marker is-${state}`;
	marker.textContent = state === "complete" ? "✓" : String(number);
	marker.setAttribute("aria-hidden", "true");

	rail.appendChild(marker);
	if (!isLast) {
		const line = document.createElement("div");
		line.className = "agent-panel-step-line";
		rail.appendChild(line);
	}

	const body = document.createElement("div");
	body.className = "agent-panel-step-body";

	const heading = document.createElement("h3");
	heading.className = "agent-panel-step-title";
	heading.textContent = title;

	const desc = document.createElement("p");
	desc.className = "agent-panel-step-desc";
	desc.textContent = description;

	body.append(heading, desc);
	renderBody(body);

	step.append(rail, body);
	return step;
}

function renderApiKeyStep(
	body: HTMLElement,
	opts: AgentPanelRenderOptions,
	selectedAuth: ProviderAuthSummary | undefined,
): void {
	const { selectedProvider, appState, authUi, callbacks } = opts;
	if (!selectedProvider) {
		body.appendChild(createHelper("Pick a provider in step 1 first."));
		return;
	}
	if (!selectedAuth) {
		body.appendChild(createHelper("Unknown provider."));
		return;
	}

	if (selectedAuth.authType === "oauth") {
		body.appendChild(
			createHelper(`Sign in with ${selectedAuth.displayName} instead of pasting a key.`),
		);
		if (selectedAuth.configured) {
			const row = document.createElement("div");
			row.className = "agent-panel-key-status-row";
			const pill = document.createElement("span");
			pill.className = "agent-panel-status-pill is-success";
			pill.textContent = authStatusHint(selectedAuth);
			row.appendChild(pill);
			if (selectedAuth.stored) {
				const remove = document.createElement("button");
				remove.type = "button";
				remove.className = "agent-panel-inline-btn btn btn-ghost btn-sm";
				remove.textContent = "Remove";
				remove.addEventListener("click", () => callbacks.onRemoveAuth(selectedProvider));
				row.appendChild(remove);
			}
			body.appendChild(row);
		} else {
			const connect = document.createElement("button");
			connect.type = "button";
			connect.className = "btn btn-ghost btn-sm";
			connect.textContent = `Connect ${selectedAuth.displayName}`;
			connect.disabled = !appState.connected;
			connect.addEventListener("click", () =>
				callbacks.onOAuthConnect(selectedProvider, selectedAuth.displayName),
			);
			body.appendChild(connect);
		}
		return;
	}

	if (selectedAuth.configured) {
		const row = document.createElement("div");
		row.className = "agent-panel-key-status-row";
		const pill = document.createElement("span");
		pill.className = "agent-panel-status-pill is-success";
		pill.textContent = authStatusHint(selectedAuth);
		row.appendChild(pill);
		if (selectedAuth.stored) {
			const remove = document.createElement("button");
			remove.type = "button";
			remove.className = "agent-panel-inline-btn btn btn-ghost btn-sm";
			remove.textContent = "Remove";
			remove.addEventListener("click", () => callbacks.onRemoveAuth(selectedProvider));
			row.appendChild(remove);
		}
		body.appendChild(row);
		return;
	}

	const keyUrl = PROVIDER_KEY_URLS[selectedProvider];
	if (keyUrl) {
		const linkRow = document.createElement("p");
		linkRow.className = "agent-panel-hint";
		const link = document.createElement("a");
		link.href = keyUrl;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.className = "agent-panel-link";
		link.textContent = `Get a ${selectedAuth.displayName} API key`;
		linkRow.append("Need a key? ", link);
		body.appendChild(linkRow);
	}

	const keyRow = document.createElement("div");
	keyRow.className = "agent-panel-key-row";

	const keyInput = document.createElement("input");
	keyInput.type = "password";
	keyInput.className = "agent-field-input agent-panel-key-input";
	keyInput.placeholder = "Paste your API key";
	keyInput.autocomplete = "off";
	keyInput.dataset.agentField = "api-key";
	keyInput.value = authUi.pendingApiKey;

	const isSaving = authUi.savingFor === selectedProvider;
	keyInput.disabled = !appState.connected || isSaving;

	const toggleVis = document.createElement("button");
	toggleVis.type = "button";
	toggleVis.className = "agent-panel-key-toggle btn btn-ghost btn-sm";
	toggleVis.textContent = "Show";
	toggleVis.title = "Show or hide API key";
	toggleVis.disabled = isSaving;
	toggleVis.addEventListener("mousedown", (e) => e.preventDefault());
	toggleVis.addEventListener("click", () => {
		const showing = keyInput.type === "text";
		keyInput.type = showing ? "password" : "text";
		toggleVis.textContent = showing ? "Show" : "Hide";
	});

	const saveBtn = document.createElement("button");
	saveBtn.type = "button";
	saveBtn.className = "agent-config-save-btn btn btn-ghost btn-sm";
	saveBtn.disabled = !appState.connected || isSaving;

	const submitKey = () => {
		const apiKey = keyInput.value.trim();
		if (apiKey) callbacks.onSaveApiKey(selectedProvider, apiKey);
	};

	keyInput.addEventListener("blur", submitKey);
	keyInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			submitKey();
		}
	});

	if (isSaving) {
		saveBtn.innerHTML = `<span class="spinner spinner-sm" aria-hidden="true"></span>`;
		saveBtn.setAttribute("aria-label", "Saving");
	} else {
		saveBtn.textContent = "Save";
		saveBtn.addEventListener("mousedown", (e) => e.preventDefault());
		saveBtn.addEventListener("click", submitKey);
	}

	keyRow.append(keyInput, toggleVis, saveBtn);
	body.appendChild(keyRow);

	if (authUi.error?.provider === selectedProvider) {
		body.appendChild(createHelper(authUi.error.message, "agent-panel-error"));
	}
}

export function renderAgentPanel(container: HTMLElement, opts: AgentPanelRenderOptions): void {
	const focus = captureFocus(container);
	container.innerHTML = "";

	const {
		expanded,
		providers,
		models,
		appState,
		hubState,
		selectedProvider,
		authUi,
		callbacks,
		wsState = "disconnected",
	} = opts;

	const disabled = !appState.connected;
	const name = hubState.hubConfig.agentName || "Hub Agent";
	const role = hubState.hubConfig.agentRole;
	const selectedAuth = providers.find((p) => p.provider === selectedProvider);

	const identity = document.createElement("section");
	identity.className = "agent-panel-identity";

	const identityHeader = document.createElement("div");
	identityHeader.className = "agent-panel-identity-header";

	const status = getAgentStatus(appState, wsState);
	const statusPill = document.createElement("span");
	statusPill.className = `agent-panel-status-chip status-dot ${status.statusClass}`;
	statusPill.title = status.label;
	const statusLabel = document.createElement("span");
	statusLabel.className = "agent-panel-status-chip-label";
	statusLabel.textContent = status.label;
	statusPill.appendChild(statusLabel);
	identityHeader.appendChild(statusPill);
	identity.appendChild(identityHeader);

	identity.appendChild(
		createField("Name", () => {
			const input = document.createElement("input");
			input.type = "text";
			input.className = "agent-field-input agent-panel-name-input";
			input.value = name;
			input.placeholder = "Agent name";
			input.disabled = disabled;
			input.autocomplete = "off";
			input.dataset.agentField = "name";
			const commit = () => {
				const next = input.value.trim();
				if (next && next !== hubState.hubConfig.agentName) {
					callbacks.onSetAgentName(next);
				} else if (!next) {
					input.value = hubState.hubConfig.agentName || "Hub Agent";
				}
			};
			input.addEventListener("blur", commit);
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					input.blur();
				}
			});
			return input;
		}, { large: true }),
	);

	identity.appendChild(
		createField("Role", () => {
			const input = document.createElement("input");
			input.type = "text";
			input.className = "agent-field-input";
			input.value = role;
			input.placeholder = "e.g. Chatbot, coding assistant";
			input.disabled = disabled;
			input.autocomplete = "off";
			input.dataset.agentField = "role";
			const commit = () => {
				const next = input.value.trim();
				if (next && next !== hubState.hubConfig.agentRole) {
					callbacks.onSetAgentRole(next);
				} else if (!next) {
					input.value = hubState.hubConfig.agentRole || "coding";
				}
			};
			input.addEventListener("blur", commit);
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					input.blur();
				}
			});
			return input;
		}),
	);

	const setup = document.createElement("section");
	setup.className = "agent-panel-setup";

	const setupHeader = document.createElement("div");
	setupHeader.className = "agent-panel-setup-header";

	const toggle = document.createElement("button");
	toggle.type = "button";
	toggle.className = `agent-panel-setup-toggle btn btn-ghost btn-sm${expanded ? " expanded" : ""}`;
	toggle.setAttribute("aria-expanded", String(expanded));
	toggle.innerHTML = `<span class="agent-panel-setup-chevron" aria-hidden="true">▸</span> Model setup`;
	toggle.addEventListener("click", callbacks.onToggleExpand);
	setupHeader.appendChild(toggle);
	setup.appendChild(setupHeader);

	if (!expanded) {
		const summary = document.createElement("p");
		summary.className = "agent-panel-summary";
		summary.textContent = buildCollapsedSummary(opts, selectedAuth);
		setup.appendChild(summary);
	}

	container.append(identity, setup);

	if (!expanded) {
		restoreFocus(container, focus);
		return;
	}

	const availableModels = models.filter((m) => m.provider === selectedProvider && m.available);
	const isLoadingModels = authUi.loadingModelsFor === selectedProvider;
	const hasAvailableModels = availableModels.length > 0;
	const modelEnabled = !!selectedProvider && hasAvailableModels && !isLoadingModels;

	const currentModelId =
		appState.modelProvider === selectedProvider && appState.model
			? models.find(
					(m) =>
						m.provider === selectedProvider &&
						(m.name === appState.model || m.id === appState.model),
				)?.id ?? models.find((m) => m.provider === selectedProvider && m.id === appState.model)?.id
			: null;

	const step1Complete = !!selectedProvider;
	const step2Complete = !!selectedAuth?.configured;
	const step3Complete = !!currentModelId && appState.modelAuthConfigured;

	const stepState = (step: 1 | 2 | 3): StepState => {
		if (step === 1) return step1Complete ? "complete" : "active";
		if (step === 2) {
			if (step2Complete) return "complete";
			if (step1Complete) return "active";
			return "pending";
		}
		if (step3Complete) return "complete";
		if (step2Complete) return "active";
		if (step1Complete) return "pending";
		return "pending";
	};

	const stepsWrap = document.createElement("div");
	stepsWrap.className = "agent-panel-steps";

	// Step 1 — Provider
	stepsWrap.appendChild(
		createStep(
			1,
			"Choose a provider",
			"This is the service that hosts AI models and bills your usage. Pick the one your API key belongs to.",
			stepState(1),
			false,
			(body) => {
				if (!selectedProvider) {
					body.appendChild(
						createHelper("OpenRouter is a good starting point — it gives access to many models with one key."),
					);
				}
				const providerCombobox = createCombobox({
					options: providers.map((p) => {
						const { badge, badgeClass } = providerBadge(p);
						return {
							value: p.provider,
							label: p.displayName,
							badge,
							badgeClass,
						};
					}),
					value: selectedProvider,
					placeholder: "Search providers…",
					disabled: disabled,
					fieldId: "provider",
					wrapClass: "agent-field-input",
					onSelect: callbacks.onProviderSelect,
				});
				body.appendChild(providerCombobox);
			},
		),
	);

	// Step 2 — API key
	stepsWrap.appendChild(
		createStep(
			2,
			"Add your API key",
			"Your key stays on this device. It's sent only to the provider you chose so the agent can talk to their API.",
			stepState(2),
			false,
			(body) => renderApiKeyStep(body, opts, selectedAuth),
		),
	);

	// Step 3 — Model
	stepsWrap.appendChild(
		createStep(
			3,
			"Pick a model",
			"This controls how smart, fast, and expensive each reply is. You can change it anytime.",
			stepState(3),
			true,
			(body) => {
				const modelCombobox = createCombobox({
					options: availableModels.map((m) => {
						const { label, suffix } = modelDisplayLabel(m);
						return { value: m.id, label, suffix };
					}),
					value: currentModelId,
					placeholder: isLoadingModels ? "Loading models…" : "Search models…",
					disabled: !modelEnabled && !isLoadingModels,
					fieldId: "model",
					wrapClass: "agent-field-input",
					onSelect: (modelId) => {
						if (selectedProvider) callbacks.onModelSelect(selectedProvider, modelId);
					},
				});
				body.appendChild(modelCombobox);

				if (isLoadingModels) {
					const hint = document.createElement("p");
					hint.className = "agent-panel-hint agent-panel-loading";
					const spinner = document.createElement("span");
					spinner.className = "spinner spinner-sm";
					spinner.setAttribute("aria-hidden", "true");
					const providerName = selectedAuth?.displayName ?? selectedProvider ?? "provider";
					hint.append(spinner, document.createTextNode(` Fetching models from ${providerName}…`));
					body.appendChild(hint);
				} else if (!modelEnabled) {
					if (!selectedProvider) {
						body.appendChild(createHelper("Choose a provider first."));
					} else if (!selectedAuth?.configured) {
						body.appendChild(
							createHelper("Add your API key first — then we'll load available models."),
						);
					} else if (availableModels.length === 0) {
						body.appendChild(
							createHelper(
								"No models available for this provider. Check your key or try another provider.",
							),
						);
					}
				}

				if (appState.modelRegistryError) {
					body.appendChild(createHelper(appState.modelRegistryError, "agent-panel-error"));
				}
			},
		),
	);

	setup.appendChild(stepsWrap);
	restoreFocus(container, focus);
}

export function patchAgentAuthUi(
	container: HTMLElement,
	opts: AgentPanelRenderOptions,
): boolean {
	const keyStep = container.querySelector('.agent-panel-step[data-step="2"] .agent-panel-step-body');
	const modelStep = container.querySelector('.agent-panel-step[data-step="3"] .agent-panel-step-body');
	if (!keyStep || !modelStep) return false;

	const selectedAuth = opts.providers.find((p) => p.provider === opts.selectedProvider);

	keyStep.innerHTML = "";
	const keyHeading = document.createElement("h3");
	keyHeading.className = "agent-panel-step-title";
	keyHeading.textContent = "Add your API key";
	const keyDesc = document.createElement("p");
	keyDesc.className = "agent-panel-step-desc";
	keyDesc.textContent =
		"Your key stays on this device. It's sent only to the provider you chose so the agent can talk to their API.";
	keyStep.append(keyHeading, keyDesc);
	renderApiKeyStep(keyStep, opts, selectedAuth);

	const modelBody = modelStep;
	const availableModels = opts.models.filter(
		(m) => m.provider === opts.selectedProvider && m.available,
	);
	const isLoadingModels = opts.authUi.loadingModelsFor === opts.selectedProvider;
	const hasAvailableModels = availableModels.length > 0;
	const modelEnabled =
		!!opts.selectedProvider && hasAvailableModels && !isLoadingModels;
	const currentModelId =
		opts.appState.modelProvider === opts.selectedProvider && opts.appState.model
			? opts.models.find(
					(m) =>
						m.provider === opts.selectedProvider &&
						(m.name === opts.appState.model || m.id === opts.appState.model),
				)?.id ??
				opts.models.find((m) => m.provider === opts.selectedProvider && m.id === opts.appState.model)?.id
			: null;

	// Only patch model hints / combobox disabled state if loading changed
	const loadingHint = modelBody.querySelector(".agent-panel-loading");
	if (isLoadingModels && !loadingHint) {
		const hint = document.createElement("p");
		hint.className = "agent-panel-hint agent-panel-loading";
		const spinner = document.createElement("span");
		spinner.className = "spinner spinner-sm";
		spinner.setAttribute("aria-hidden", "true");
		const providerName =
			selectedAuth?.displayName ?? opts.selectedProvider ?? "provider";
		hint.append(spinner, document.createTextNode(` Fetching models from ${providerName}…`));
		modelBody.appendChild(hint);
	} else if (!isLoadingModels && loadingHint) {
		loadingHint.remove();
	}

	const combobox = modelBody.querySelector(".combobox");
	if (combobox && "setDisabled" in combobox) {
		(combobox as import("./combobox.js").ComboboxElement).setDisabled(
			!modelEnabled && !isLoadingModels,
		);
	}

	void currentModelId;
	return true;
}
