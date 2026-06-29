import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import type { AppState, AssistantItem, Block, ExtUIRequest, ThinkingBlock, ToolBlock, UserItem } from "../state/session.js";

const marked = new Marked(
	markedHighlight({
		emptyLangClass: "hljs",
		langPrefix: "hljs language-",
		highlight(code, lang) {
			const language = hljs.getLanguage(lang) ? lang : "plaintext";
			return hljs.highlight(code, { language }).value;
		},
	}),
);
marked.setOptions({ breaks: true, gfm: true });

const toolIcons: Record<string, string> = {
	bash: "⬡",
	read: "📖",
	edit: "✏️",
	write: "📝",
	grep: "🔍",
	find: "🗂️",
	ls: "📁",
};

export function escHtml(s: string) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getArgPreview(name: string, args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const a = args as Record<string, unknown>;
	if (name === "bash" && a.command) return String(a.command).slice(0, 80);
	if ((name === "read" || name === "write" || name === "edit" || name === "find" || name === "ls") && a.path)
		return String(a.path);
	if (name === "grep" && a.pattern) return `${a.pattern} ${a.path ?? ""}`.trim();
	const first = Object.values(a).find((v) => typeof v === "string");
	return first ? String(first).slice(0, 80) : "";
}

export function renderMessages(container: HTMLElement, state: AppState, onRerender: () => void) {
	container.innerHTML = "";
	for (const item of state.items) {
		container.appendChild(
			item.kind === "user" ? renderUserMsg(item) : renderAssistantMsg(item, onRerender),
		);
	}

	if (state.streaming) {
		const last = state.items[state.items.length - 1];
		const showTypingBubble =
			!last ||
			last.kind === "user" ||
			(last.kind === "assistant" && !assistantHasVisibleContent(last));
		if (showTypingBubble) {
			container.appendChild(renderTypingIndicator());
		}
	}

	const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
	if (nearBottom || state.streaming) container.scrollTop = container.scrollHeight;
}

function assistantHasVisibleContent(item: AssistantItem): boolean {
	return item.blocks.some(
		(b) =>
			(b.type === "text" && b.text.length > 0) ||
			(b.type === "thinking" && b.text.length > 0) ||
			b.type === "tool",
	);
}

function renderTypingIndicator(): HTMLElement {
	const div = document.createElement("div");
	div.className = "msg msg-assistant msg-typing";
	const wrap = document.createElement("div");
	wrap.className = "msg-bubble-wrap";
	wrap.innerHTML = `<span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>`;
	div.appendChild(wrap);
	return div;
}

function renderUserMsg(item: UserItem): HTMLElement {
	const div = document.createElement("div");
	div.className = "msg msg-user";
	const bubble = document.createElement("div");
	bubble.className = "msg-bubble";
	bubble.textContent = item.text;
	const time = document.createElement("div");
	time.className = "msg-time";
	time.textContent = formatMsgTime();
	div.append(bubble, time);
	return div;
}

function formatMsgTime(): string {
	return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderAssistantMsg(item: AssistantItem, onRerender: () => void): HTMLElement {
	const div = document.createElement("div");
	div.className = "msg msg-assistant";
	const wrap = document.createElement("div");
	wrap.className = "msg-bubble-wrap";
	for (const block of item.blocks) {
		if (block.type === "thinking") wrap.appendChild(renderThinkingBlock(block, onRerender));
		else if (block.type === "tool") wrap.appendChild(renderToolBlock(block, onRerender));
		else if (block.type === "text") wrap.appendChild(renderTextBlock(block));
	}
	const time = document.createElement("div");
	time.className = "msg-time";
	time.textContent = formatMsgTime();
	div.append(wrap, time);
	return div;
}

function renderThinkingBlock(block: ThinkingBlock, onRerender: () => void): HTMLElement {
	const wrap = document.createElement("div");
	wrap.className = `block-thinking${block.expanded ? " expanded" : ""}`;
	const header = document.createElement("div");
	header.className = "block-header";
	header.innerHTML = `<span>Thinking</span><span class="chevron">▶</span>`;
	header.addEventListener("click", () => {
		block.expanded = !block.expanded;
		onRerender();
	});
	const content = document.createElement("div");
	content.className = "block-content";
	content.textContent = block.text;
	wrap.append(header, content);
	return wrap;
}

function renderToolBlock(block: ToolBlock, onRerender: () => void): HTMLElement {
	const wrap = document.createElement("div");
	const statusClass = block.running ? "running" : block.isError ? "error" : "success";
	wrap.className = `block-tool ${statusClass}${block.expanded ? " expanded" : ""}`;
	const argPreview = getArgPreview(block.name, block.args);
	const statusIcon = block.running ? "⟳ running…" : block.isError ? "✕ error" : "✓";
	const toolIcon = toolIcons[block.name] ?? "🔧";

	const header = document.createElement("div");
	header.className = "block-header";
	header.innerHTML = `
		<span class="tool-name">${toolIcon} ${escHtml(block.name)}</span>
		<span class="tool-arg-preview">${escHtml(argPreview)}</span>
		<span class="tool-status">${statusIcon}</span>
		<span class="chevron">${block.expanded ? "▲" : "▼"}</span>`;
	header.addEventListener("click", () => {
		block.expanded = !block.expanded;
		onRerender();
	});

	const content = document.createElement("div");
	content.className = "block-content";
	if (block.args !== undefined) {
		const argsLabel = document.createElement("div");
		argsLabel.className = "tool-section-label";
		argsLabel.textContent = "Arguments";
		const argsPre = document.createElement("pre");
		argsPre.className = "tool-args-pre";
		argsPre.textContent =
			typeof block.args === "string" ? block.args : JSON.stringify(block.args, null, 2);
		content.append(argsLabel, argsPre);
	}
	if (block.output) {
		const outLabel = document.createElement("div");
		outLabel.className = "tool-section-label";
		outLabel.textContent = block.running ? "Output (streaming)" : "Output";
		const outPre = document.createElement("pre");
		outPre.className = `tool-output-pre${block.isError ? " error-output" : ""}`;
		outPre.textContent = block.output;
		content.append(outLabel, outPre);
	}
	wrap.append(header, content);
	return wrap;
}

function renderTextBlock(block: Block & { type: "text" }): HTMLElement {
	const div = document.createElement("div");
	const isError =
		block.text.startsWith("Error:") ||
		block.text === "Operation aborted" ||
		block.text === "Request was aborted";
	div.className = isError ? "block-text block-error" : "block-text";
	div.innerHTML = marked.parse(block.text) as string;
	return div;
}

export function showToast(msg: string, type: "info" | "warning" | "error" = "info") {
	const container = document.getElementById("toast-container") ?? createToastContainer();
	const el = document.createElement("div");
	el.className = `toast toast-${type}`;
	el.textContent = msg;
	container.appendChild(el);
	setTimeout(() => el.remove(), 5000);
}

function createToastContainer() {
	const el = document.createElement("div");
	el.id = "toast-container";
	document.body.appendChild(el);
	return el;
}

export function renderExtensionDialog(
	req: ExtUIRequest | null,
	onRespond: (value: Record<string, unknown>) => void,
) {
	const overlay = document.getElementById("dialog-overlay")!;
	const titleEl = document.getElementById("dialog-title")!;
	const msgEl = document.getElementById("dialog-message")!;
	const bodyEl = document.getElementById("dialog-body")!;
	const actionsEl = document.getElementById("dialog-actions")!;

	if (!req) {
		overlay.classList.add("hidden");
		return;
	}

	titleEl.textContent = req.title ?? "";
	msgEl.textContent = req.message ?? "";
	bodyEl.innerHTML = "";
	actionsEl.innerHTML = "";

	const respond = (value: Record<string, unknown>) => {
		onRespond({ id: req.id, ...value });
		overlay.classList.add("hidden");
	};

	if (req.method === "select") {
		for (const opt of req.options ?? []) {
			const btn = document.createElement("button");
			btn.className = "dialog-select-option";
			btn.textContent = opt;
			btn.addEventListener("click", () => respond({ value: opt }));
			bodyEl.appendChild(btn);
		}
		addCancelBtn(actionsEl, respond);
	} else if (req.method === "confirm") {
		const yes = document.createElement("button");
		yes.className = "btn btn-primary";
		yes.textContent = "Yes";
		yes.addEventListener("click", () => respond({ confirmed: true }));
		const no = document.createElement("button");
		no.className = "btn btn-ghost";
		no.textContent = "No";
		no.addEventListener("click", () => respond({ confirmed: false }));
		actionsEl.append(no, yes);
	} else if (req.method === "input" || req.method === "editor") {
		const isEditor = req.method === "editor";
		const field = document.createElement(isEditor ? "textarea" : "input");
		field.className = isEditor ? "dialog-textarea" : "dialog-input";
		if (!isEditor) {
			(field as HTMLInputElement).type = req.inputType ?? "text";
		}
		if (req.prefill) (field as HTMLInputElement | HTMLTextAreaElement).value = req.prefill;
		bodyEl.appendChild(field);
		setTimeout(() => field.focus(), 50);
		const ok = document.createElement("button");
		ok.className = "btn btn-primary";
		ok.textContent = "OK";
		ok.addEventListener("click", () =>
			respond({ value: (field as HTMLInputElement | HTMLTextAreaElement).value }),
		);
		field.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !isEditor) {
				e.preventDefault();
				respond({ value: (field as HTMLInputElement).value });
			}
		});
		addCancelBtn(actionsEl, respond);
		actionsEl.appendChild(ok);
	}

	overlay.classList.remove("hidden");
}

function addCancelBtn(container: HTMLElement, respond: (v: Record<string, unknown>) => void) {
	const btn = document.createElement("button");
	btn.className = "btn btn-ghost";
	btn.textContent = "Cancel";
	btn.addEventListener("click", () => respond({ cancelled: true }));
	container.appendChild(btn);
}

export function openPanel(title: string, bodyHtml: string) {
	const overlay = document.getElementById("panel-overlay")!;
	document.getElementById("panel-title")!.textContent = title;
	document.getElementById("panel-body")!.innerHTML = bodyHtml;
	overlay.classList.remove("hidden");
}

export function closePanel() {
	document.getElementById("panel-overlay")!.classList.add("hidden");
}

export function renderModelList(
	models: Array<{ provider: string; id: string; name?: string; available: boolean }>,
	current: { provider: string; id: string } | undefined,
	onSelect: (provider: string, id: string) => void,
	error?: string,
) {
	const html = `
		${error ? `<p class="panel-error">${escHtml(error)}</p>` : ""}
		<ul class="panel-list">${models
			.map((m) => {
				const selected = current?.provider === m.provider && current?.id === m.id;
				const disabled = !m.available;
				return `<li class="panel-list-item${selected ? " selected" : ""}${disabled ? " disabled" : ""}"
					data-provider="${escHtml(m.provider)}" data-id="${escHtml(m.id)}">
					<div class="panel-list-title">${escHtml(m.name ?? m.id)}</div>
					<div class="panel-list-meta">${escHtml(m.provider)}${disabled ? " · auth not configured" : ""}</div>
				</li>`;
			})
			.join("")}</ul>`;
	openPanel("Models", html);
	document.querySelectorAll(".panel-list-item:not(.disabled)").forEach((el) => {
		el.addEventListener("click", () => {
			const target = el as HTMLElement;
			onSelect(target.dataset.provider!, target.dataset.id!);
			closePanel();
		});
	});
}

import type { ProviderAuthSummary } from "../../../shared/protocol.js";

function authStatusLabel(p: ProviderAuthSummary): string {
	if (!p.configured) return "✕ not configured";
	if (p.source === "environment" && p.label) return `✓ via ${p.label}`;
	if (p.source === "runtime") return `✓ via ${p.label ?? "runtime"}`;
	if (p.source === "models_json_command") return "✓ via models.json command";
	if (p.source === "models_json_key") return "✓ via models.json";
	return "✓ configured";
}

export interface AuthPanelCallbacks {
	onConfigure: (provider: string, authType: "api_key" | "oauth", displayName: string) => void;
	onRemove: (provider: string) => void;
}

export function renderAuthPanel(
	providers: ProviderAuthSummary[],
	callbacks: AuthPanelCallbacks,
	registryError?: string,
) {
	const html = `
		${registryError ? `<p class="panel-error">${escHtml(registryError)}</p>` : ""}
		<ul class="panel-list">${providers
			.map((p) => {
				const removeBtn = p.stored
					? `<button type="button" class="btn btn-ghost btn-sm auth-remove-btn" data-provider="${escHtml(p.provider)}">Remove</button>`
					: "";
				return `<li class="panel-list-item auth-row" data-provider="${escHtml(p.provider)}" data-auth-type="${p.authType}">
					<div class="auth-row-main">
						<div class="panel-list-title">${escHtml(p.displayName)}</div>
						<div class="panel-list-meta">${escHtml(authStatusLabel(p))}</div>
					</div>
					${removeBtn ? `<div class="auth-row-actions">${removeBtn}</div>` : ""}
				</li>`;
			})
			.join("")}</ul>`;
	openPanel("Auth", html);

	document.querySelectorAll(".auth-row").forEach((el) => {
		el.addEventListener("click", () => {
			const target = el as HTMLElement;
			const provider = target.dataset.provider!;
			const authType = target.dataset.authType as "api_key" | "oauth";
			const displayName =
				providers.find((p) => p.provider === provider)?.displayName ?? provider;
			callbacks.onConfigure(provider, authType, displayName);
		});
	});

	document.querySelectorAll(".auth-remove-btn").forEach((el) => {
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			const provider = (el as HTMLElement).dataset.provider!;
			callbacks.onRemove(provider);
		});
	});
}

/** @deprecated Use renderAuthPanel */
export function renderAuthStatus(
	providers: Array<{ provider: string; displayName: string; configured: boolean }>,
	registryError?: string,
) {
	renderAuthPanel(
		providers.map((p) => ({
			...p,
			authType: "api_key" as const,
			stored: p.configured,
		})),
		{
			onConfigure: () => {},
			onRemove: () => {},
		},
		registryError,
	);
}

export interface OAuthStepDialog {
	loginId: string;
	provider: string;
	stepId?: string;
	onRespond: (response: Record<string, unknown>) => void;
	onCancel: () => void;
}

export function renderOAuthStep(step: Record<string, unknown>, dialog: OAuthStepDialog) {
	const kind = step.kind as string;
	const stepId = (step.stepId as string | undefined) ?? dialog.stepId;
	const overlay = document.getElementById("dialog-overlay")!;
	const titleEl = document.getElementById("dialog-title")!;
	const msgEl = document.getElementById("dialog-message")!;
	const bodyEl = document.getElementById("dialog-body")!;
	const actionsEl = document.getElementById("dialog-actions")!;

	const close = (response: Record<string, unknown>) => {
		if (stepId) {
			dialog.onRespond({ stepId, ...response });
		}
		overlay.classList.add("hidden");
	};

	const cancel = () => {
		if (stepId) {
			close({ cancelled: true });
		} else {
			dialog.onCancel();
			overlay.classList.add("hidden");
		}
	};

	titleEl.textContent = "";
	msgEl.textContent = "";
	bodyEl.innerHTML = "";
	actionsEl.innerHTML = "";

	if (kind === "url") {
		const url = step.url as string;
		const instructions = step.instructions as string | undefined;
		titleEl.textContent = "Sign in";
		msgEl.textContent = instructions ?? "Complete sign-in in your browser.";
		window.open(url, "_blank", "noopener,noreferrer");
		if (step.manualCode && step.stepId) {
			const field = document.createElement("input");
			field.className = "dialog-input";
			field.type = "text";
			field.placeholder = "Paste redirect URL…";
			bodyEl.appendChild(field);
			const ok = document.createElement("button");
			ok.className = "btn btn-primary";
			ok.textContent = "Submit";
			ok.addEventListener("click", () =>
				close({ value: field.value }),
			);
			const cancelBtn = document.createElement("button");
			cancelBtn.className = "btn btn-ghost";
			cancelBtn.textContent = "Cancel";
			cancelBtn.addEventListener("click", cancel);
			actionsEl.append(cancelBtn, ok);
		} else {
			const done = document.createElement("button");
			done.className = "btn btn-primary";
			done.textContent = "Close";
			done.addEventListener("click", () => overlay.classList.add("hidden"));
			actionsEl.appendChild(done);
		}
	} else if (kind === "device_code") {
		titleEl.textContent = "Device code";
		const code = document.createElement("div");
		code.className = "oauth-device-code";
		code.textContent = step.userCode as string;
		const link = document.createElement("a");
		link.className = "oauth-device-link";
		link.href = step.verificationUri as string;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.textContent = step.verificationUri as string;
		bodyEl.append(code, link);
		msgEl.textContent = "Open the link and enter the code above.";
		const waiting = document.createElement("button");
		waiting.className = "btn btn-primary";
		waiting.textContent = "Waiting…";
		waiting.disabled = true;
		const cancelBtn = document.createElement("button");
		cancelBtn.className = "btn btn-ghost";
		cancelBtn.textContent = "Cancel";
		cancelBtn.addEventListener("click", () => {
			dialog.onCancel();
			overlay.classList.add("hidden");
		});
		actionsEl.append(cancelBtn, waiting);
	} else if (kind === "prompt" || kind === "manual_code") {
		titleEl.textContent = "Sign in";
		msgEl.textContent = (step.message as string) ?? "";
		const field = document.createElement("input");
		field.className = "dialog-input";
		field.type = "text";
		if (step.placeholder) field.placeholder = step.placeholder as string;
		bodyEl.appendChild(field);
		setTimeout(() => field.focus(), 50);
		const ok = document.createElement("button");
		ok.className = "btn btn-primary";
		ok.textContent = "OK";
		ok.addEventListener("click", () => close({ value: field.value }));
		const cancelBtn = document.createElement("button");
		cancelBtn.className = "btn btn-ghost";
		cancelBtn.textContent = "Cancel";
		cancelBtn.addEventListener("click", cancel);
		actionsEl.append(cancelBtn, ok);
	} else if (kind === "select") {
		titleEl.textContent = "Sign in";
		msgEl.textContent = step.message as string;
		for (const opt of (step.options as Array<{ id: string; label: string }>) ?? []) {
			const btn = document.createElement("button");
			btn.className = "dialog-select-option";
			btn.textContent = opt.label;
			btn.addEventListener("click", () => close({ selectedId: opt.id }));
			bodyEl.appendChild(btn);
		}
		const cancelBtn = document.createElement("button");
		cancelBtn.className = "btn btn-ghost";
		cancelBtn.textContent = "Cancel";
		cancelBtn.addEventListener("click", cancel);
		actionsEl.appendChild(cancelBtn);
	} else if (kind === "progress") {
		showToast(step.message as string, "info");
		return;
	}

	overlay.classList.remove("hidden");
}

export function showApiKeyDialog(
	displayName: string,
	onSubmit: (apiKey: string) => void,
	onCancel?: () => void,
) {
	renderExtensionDialog(
		{
			id: "auth-api-key",
			method: "input",
			title: displayName,
			message: "Enter API key:",
			inputType: "password",
		},
		(value) => {
			if ("cancelled" in value && value.cancelled) {
				onCancel?.();
				return;
			}
			const apiKey = "value" in value ? String(value.value ?? "").trim() : "";
			if (apiKey) onSubmit(apiKey);
		},
	);
}

export function renderTree(tree: unknown, leafId: string | null, onSelect: (id: string) => void) {
	const body = document.createElement("div");
	body.className = "tree-view";
	const nodes = Array.isArray(tree) ? tree : tree ? [tree] : [];
	for (const node of nodes) {
		body.appendChild(renderTreeNode(node, leafId, onSelect));
	}
	openPanel("Session Tree", "");
	document.getElementById("panel-body")!.innerHTML = "";
	document.getElementById("panel-body")!.appendChild(body);
}

function renderTreeNode(node: unknown, leafId: string | null, onSelect: (id: string) => void): HTMLElement {
	const container = document.createElement("div");
	if (!node || typeof node !== "object") return container;

	const item = node as { entry?: { id?: string; type?: string }; children?: unknown[]; label?: string };
	const id = item.entry?.id;
	if (id) {
		const btn = document.createElement("button");
		btn.className = `tree-btn${id === leafId ? " active" : ""}`;
		const label = item.label ?? item.entry?.type ?? id.slice(0, 8);
		btn.textContent = label;
		btn.addEventListener("click", () => {
			onSelect(id);
			closePanel();
		});
		container.appendChild(btn);
	}
	if (item.children?.length) {
		const childList = document.createElement("ul");
		childList.className = "tree-list";
		for (const child of item.children) {
			const li = document.createElement("li");
			li.className = "tree-item";
			li.appendChild(renderTreeNode(child, leafId, onSelect));
			childList.appendChild(li);
		}
		container.appendChild(childList);
	}
	return container;
}

export function showConfirmDialog(
	title: string,
	message: string,
	onConfirm: () => void,
): void {
	const overlay = document.getElementById("dialog-overlay")!;
	const titleEl = document.getElementById("dialog-title")!;
	const msgEl = document.getElementById("dialog-message")!;
	const bodyEl = document.getElementById("dialog-body")!;
	const actionsEl = document.getElementById("dialog-actions")!;

	titleEl.textContent = title;
	msgEl.textContent = message;
	bodyEl.innerHTML = "";
	actionsEl.innerHTML = "";

	const close = () => overlay.classList.add("hidden");

	const no = document.createElement("button");
	no.className = "btn btn-ghost";
	no.textContent = "Cancel";
	no.addEventListener("click", close);

	const yes = document.createElement("button");
	yes.className = "btn btn-danger";
	yes.textContent = "Delete";
	yes.addEventListener("click", () => {
		close();
		onConfirm();
	});

	actionsEl.append(no, yes);
	overlay.classList.remove("hidden");
}

export function showInputDialog(
	title: string,
	prefill: string,
	placeholder: string,
	onSubmit: (value: string) => void,
): void {
	const overlay = document.getElementById("dialog-overlay")!;
	const titleEl = document.getElementById("dialog-title")!;
	const msgEl = document.getElementById("dialog-message")!;
	const bodyEl = document.getElementById("dialog-body")!;
	const actionsEl = document.getElementById("dialog-actions")!;

	titleEl.textContent = title;
	msgEl.textContent = "";
	bodyEl.innerHTML = "";
	actionsEl.innerHTML = "";

	const field = document.createElement("input");
	field.className = "dialog-input";
	field.type = "text";
	field.value = prefill;
	field.placeholder = placeholder;
	bodyEl.appendChild(field);

	const close = () => overlay.classList.add("hidden");

	const submit = () => {
		const value = field.value.trim();
		if (!value) return;
		close();
		onSubmit(value);
	};

	const cancel = document.createElement("button");
	cancel.className = "btn btn-ghost";
	cancel.textContent = "Cancel";
	cancel.addEventListener("click", close);

	const ok = document.createElement("button");
	ok.className = "btn btn-primary";
	ok.textContent = "Save";
	ok.addEventListener("click", submit);

	field.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			submit();
		}
		if (e.key === "Escape") {
			e.preventDefault();
			close();
		}
	});

	actionsEl.append(cancel, ok);
	overlay.classList.remove("hidden");
	setTimeout(() => field.focus(), 50);
}
