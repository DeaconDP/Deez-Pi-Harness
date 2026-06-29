import { refreshPanelCollapse } from "./panel-collapse.js";

export const COMPACT_MQ = "(max-width: 768px), (max-height: 700px)";

export type MobileTab = "sessions" | "chat" | "agent";

const TAB_STORAGE_KEY = "pi-hub-mobile-tab";

const TAB_VIEW_CLASS: Record<MobileTab, string> = {
	sessions: "mobile-view-sessions",
	chat: "mobile-view-chat",
	agent: "mobile-view-agent",
};

function loadTab(): MobileTab {
	try {
		const raw = sessionStorage.getItem(TAB_STORAGE_KEY);
		if (raw === "sessions" || raw === "chat" || raw === "agent") return raw;
	} catch {
		/* ignore */
	}
	return "chat";
}

function saveTab(tab: MobileTab): void {
	try {
		sessionStorage.setItem(TAB_STORAGE_KEY, tab);
	} catch {
		/* ignore */
	}
}

let workspace: HTMLElement | null = null;
let appEl: HTMLElement | null = null;
let navEl: HTMLElement | null = null;
let mq: MediaQueryList | null = null;
let activeTab: MobileTab = "chat";

export function isCompactViewport(): boolean {
	return mq?.matches ?? false;
}

function setActiveTab(tab: MobileTab): void {
	activeTab = tab;
	saveTab(tab);
	if (!workspace) return;

	workspace.classList.remove(
		"mobile-view-sessions",
		"mobile-view-chat",
		"mobile-view-agent",
	);
	workspace.classList.add(TAB_VIEW_CLASS[tab]);

	navEl?.querySelectorAll(".mobile-nav-tab").forEach((btn) => {
		const el = btn as HTMLButtonElement;
		const isActive = el.dataset.mobileTab === tab;
		el.classList.toggle("is-active", isActive);
		if (isActive) {
			el.setAttribute("aria-current", "page");
		} else {
			el.removeAttribute("aria-current");
		}
	});
}

function enterCompact(): void {
	workspace?.classList.add("mobile-compact");
	appEl?.classList.add("mobile-compact-app");
	navEl?.removeAttribute("hidden");
	setActiveTab(loadTab());
}

function exitCompact(): void {
	workspace?.classList.remove(
		"mobile-compact",
		"mobile-view-sessions",
		"mobile-view-chat",
		"mobile-view-agent",
	);
	appEl?.classList.remove("mobile-compact-app");
	navEl?.setAttribute("hidden", "");
	refreshPanelCollapse();
}

export function switchToChatTab(): void {
	if (!isCompactViewport()) return;
	setActiveTab("chat");
}

export function initMobileNav(ws: HTMLElement): void {
	workspace = ws;
	appEl = document.getElementById("app");
	navEl = document.getElementById("mobile-nav");
	mq = window.matchMedia(COMPACT_MQ);

	navEl?.querySelectorAll(".mobile-nav-tab").forEach((btn) => {
		btn.addEventListener("click", () => {
			const tab = (btn as HTMLButtonElement).dataset.mobileTab as MobileTab | undefined;
			if (tab) setActiveTab(tab);
		});
	});

	const handleChange = () => {
		if (mq!.matches) {
			enterCompact();
		} else {
			exitCompact();
		}
	};

	mq.addEventListener("change", handleChange);
	handleChange();
}
