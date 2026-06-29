const MAX_ENTRIES = 200;

export type DebugDirection = "out" | "in" | "info";

export interface DebugEntry {
	ts: number;
	direction: DebugDirection;
	label: string;
}

const entries: DebugEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
	for (const fn of listeners) fn();
}

function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

function redactPayload(payload: unknown): unknown {
	if (!payload || typeof payload !== "object") return payload;
	const obj = { ...(payload as Record<string, unknown>) };
	if (obj.type === "set_auth" && typeof obj.apiKey === "string") {
		obj.apiKey = "[redacted]";
	}
	return obj;
}

function summarizePayload(payload: unknown): string {
	const safe = redactPayload(payload);
	try {
		const text = JSON.stringify(safe);
		return text.length > 240 ? `${text.slice(0, 240)}…` : text;
	} catch {
		return String(payload);
	}
}

export function debugLog(direction: DebugDirection, payload: unknown) {
	const label =
		direction === "info"
			? String(payload)
			: summarizePayload(payload);
	entries.push({ ts: Date.now(), direction, label });
	if (entries.length > MAX_ENTRIES) entries.shift();
	notify();
}

export function debugLogSubscribe(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function debugLogClear() {
	entries.length = 0;
	notify();
}

export function debugLogEntries(): readonly DebugEntry[] {
	return entries;
}

export function initDebugLogUI() {
	const bar = document.getElementById("debug-log-bar")!;
	const toggle = document.getElementById("debug-log-toggle")!;
	const countEl = document.getElementById("debug-log-count")!;
	const clearBtn = document.getElementById("debug-log-clear")!;
	const body = document.getElementById("debug-log-body")!;
	const content = document.getElementById("debug-log-content")!;

	let expanded = false;

	function render() {
		const count = entries.length;
		countEl.textContent = String(count);
		toggle.textContent = expanded ? "▾ Debug log" : "▸ Debug log";
		body.classList.toggle("hidden", !expanded);

		content.innerHTML = entries
			.map((e) => {
				const arrow = e.direction === "out" ? "→" : e.direction === "in" ? "←" : "·";
				return `<div class="debug-log-line"><span class="debug-log-ts">${formatTime(e.ts)}</span> <span class="debug-log-arrow">${arrow}</span> ${escapeHtml(e.label)}</div>`;
			})
			.join("");
		content.scrollTop = content.scrollHeight;
	}

	toggle.addEventListener("click", () => {
		expanded = !expanded;
		render();
	});

	clearBtn.addEventListener("click", () => {
		debugLogClear();
	});

	debugLogSubscribe(render);
	render();
}

function escapeHtml(s: string): string {
	const el = document.createElement("span");
	el.textContent = s;
	return el.innerHTML;
}
