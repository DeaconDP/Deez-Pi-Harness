import type { AppState } from "../state/session.js";

export interface ThinkingControlCallbacks {
	onSetThinkingLevel: (level: string) => void;
}

const LEVEL_LABELS: Record<string, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Max",
};

let lastNonOffLevel = "medium";
let popoverOpen = false;

function formatLevelLabel(level: string): string {
	return LEVEL_LABELS[level] ?? level;
}

function isThinkingOn(level: string | undefined): boolean {
	return !!level && level !== "off";
}

function effortLevels(available: string[] | undefined): string[] {
	return (available ?? []).filter((l) => l !== "off");
}

export function renderThinkingControl(
	container: HTMLElement,
	appState: AppState,
	callbacks: ThinkingControlCallbacks,
): void {
	container.innerHTML = "";
	popoverOpen = false;

	const supportsThinking = appState.supportsThinking ?? false;
	const level = appState.thinkingLevel ?? "off";
	const available = effortLevels(appState.availableThinkingLevels);
	const thinkingOn = isThinkingOn(level);

	if (thinkingOn && level !== "off") {
		lastNonOffLevel = level;
	}

	const chip = document.createElement("button");
	chip.type = "button";
	chip.className = `thinking-chip btn btn-ghost btn-sm${thinkingOn ? " is-on" : ""}${!supportsThinking ? " is-disabled" : ""}`;
	chip.disabled = !appState.connected || !supportsThinking;
	chip.title = supportsThinking
		? thinkingOn
			? `Thinking: ${formatLevelLabel(level)}`
			: "Thinking off"
		: "Current model doesn't support thinking";
	chip.setAttribute("aria-expanded", String(popoverOpen));
	chip.setAttribute("aria-haspopup", "true");

	const chipLabel = document.createElement("span");
	chipLabel.className = "thinking-chip-label";
	chipLabel.textContent = thinkingOn ? formatLevelLabel(level) : "Think";
	chip.append(chipLabel);

	const chevron = document.createElement("span");
	chevron.className = "thinking-chip-chevron";
	chevron.setAttribute("aria-hidden", "true");
	chevron.textContent = "▾";
	chip.append(chevron);

	const popover = document.createElement("div");
	popover.className = `thinking-popover${popoverOpen ? " open" : ""}`;
	popover.hidden = !popoverOpen;

	const toggleRow = document.createElement("label");
	toggleRow.className = "thinking-popover-row thinking-toggle-row";
	const toggleLabel = document.createElement("span");
	toggleLabel.textContent = "Thinking";
	const toggleInput = document.createElement("input");
	toggleInput.type = "checkbox";
	toggleInput.className = "thinking-toggle-input";
	toggleInput.checked = thinkingOn;
	toggleInput.disabled = !supportsThinking;
	toggleRow.append(toggleLabel, toggleInput);
	popover.appendChild(toggleRow);

	const effortSection = document.createElement("div");
	effortSection.className = "thinking-effort-section";
	if (!thinkingOn) {
		effortSection.hidden = true;
	}

	const effortLabel = document.createElement("div");
	effortLabel.className = "thinking-effort-label";
	effortLabel.textContent = "Effort";
	effortSection.appendChild(effortLabel);

	const effortList = document.createElement("div");
	effortList.className = "thinking-effort-list";
	for (const option of available) {
		const row = document.createElement("label");
		row.className = "thinking-effort-option";
		const radio = document.createElement("input");
		radio.type = "radio";
		radio.name = "thinking-effort";
		radio.value = option;
		radio.checked = level === option;
		radio.disabled = !thinkingOn;
		const text = document.createElement("span");
		text.textContent = formatLevelLabel(option);
		row.append(radio, text);
		row.addEventListener("click", (e) => {
			e.stopPropagation();
			if (!thinkingOn) return;
			callbacks.onSetThinkingLevel(option);
			lastNonOffLevel = option;
			popoverOpen = false;
		});
		effortList.appendChild(row);
	}
	effortSection.appendChild(effortList);
	popover.appendChild(effortSection);

	const wrap = document.createElement("div");
	wrap.className = "thinking-control";

	const closePopover = () => {
		popoverOpen = false;
		popover.hidden = true;
		popover.classList.remove("open");
		chip.setAttribute("aria-expanded", "false");
	};

	chip.addEventListener("click", (e) => {
		e.stopPropagation();
		if (!supportsThinking) return;
		if (popoverOpen) {
			closePopover();
			return;
		}
		popoverOpen = true;
		popover.hidden = false;
		popover.classList.add("open");
		chip.setAttribute("aria-expanded", "true");

		const onDocClick = (ev: MouseEvent) => {
			if (!wrap.contains(ev.target as Node)) {
				closePopover();
				document.removeEventListener("mousedown", onDocClick);
			}
		};
		setTimeout(() => document.addEventListener("mousedown", onDocClick), 0);
	});

	toggleInput.addEventListener("change", () => {
		const next = toggleInput.checked ? lastNonOffLevel || "medium" : "off";
		callbacks.onSetThinkingLevel(next);
		if (toggleInput.checked) {
			lastNonOffLevel = next;
		}
		closePopover();
	});

	wrap.append(chip, popover);
	container.appendChild(wrap);
}
