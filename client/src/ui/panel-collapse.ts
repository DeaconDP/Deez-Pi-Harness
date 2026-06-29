const STORAGE_KEY = "pi-hub-panel-collapse";

type PanelSide = "left" | "right";

interface CollapseState {
	left: boolean;
	right: boolean;
}

function loadState(): CollapseState {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<CollapseState>;
			return {
				left: parsed.left !== false,
				right: parsed.right !== false,
			};
		}
	} catch {
		/* ignore */
	}
	return { left: true, right: true };
}

function saveState(state: CollapseState): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		/* ignore */
	}
}

function applyPanel(
	panel: HTMLElement,
	side: PanelSide,
	expanded: boolean,
	toggle: HTMLButtonElement,
): void {
	panel.classList.toggle("is-collapsed", !expanded);
	toggle.setAttribute("aria-expanded", String(expanded));
	toggle.title = expanded
		? `Collapse ${side === "left" ? "sessions" : "agent"} panel`
		: `Expand ${side === "left" ? "sessions" : "agent"} panel`;
}

let workspaceEl: HTMLElement | null = null;
let syncPanels: (() => void) | null = null;

export function refreshPanelCollapse(): void {
	syncPanels?.();
}

export function initPanelCollapse(workspace: HTMLElement): void {
	const leftPanel = document.getElementById("panel-sessions");
	const rightPanel = document.getElementById("panel-agent");
	const leftToggle = document.getElementById("panel-sessions-toggle") as HTMLButtonElement | null;
	const rightToggle = document.getElementById("panel-agent-toggle") as HTMLButtonElement | null;

	if (!leftPanel || !rightPanel || !leftToggle || !rightToggle) return;

	workspaceEl = workspace;
	const state = loadState();

	syncPanels = () => {
		applyPanel(leftPanel, "left", state.left, leftToggle);
		applyPanel(rightPanel, "right", state.right, rightToggle);
		workspace.classList.toggle("left-collapsed", !state.left);
		workspace.classList.toggle("right-collapsed", !state.right);
	};

	leftToggle.addEventListener("click", () => {
		if (workspace.classList.contains("mobile-compact")) return;
		state.left = !state.left;
		syncPanels!();
		saveState(state);
	});

	rightToggle.addEventListener("click", () => {
		if (workspace.classList.contains("mobile-compact")) return;
		state.right = !state.right;
		syncPanels!();
		saveState(state);
	});

	syncPanels();
}
