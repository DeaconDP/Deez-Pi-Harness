import { Preferences } from "@capacitor/preferences";
import type { ConversationItem } from "../state/session.js";

const SESSIONS_KEY = "mobile_sessions";
const ACTIVE_SESSION_KEY = "mobile_active_session";
const MODEL_KEY = "mobile_model";
const HUB_CONFIG_KEY = "mobile_hub_config";

export interface MobileSessionMeta {
	path: string;
	id: string;
	name?: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
	archived?: boolean;
}

export interface MobileSessionData {
	meta: MobileSessionMeta;
	items: ConversationItem[];
}

export interface StoredSessions {
	sessions: Record<string, MobileSessionData>;
	order: string[];
}

export interface MobileModelSelection {
	provider: string;
	modelId: string;
	modelName?: string;
}

export interface MobileHubConfig {
	agentName: string;
	agentRole: string;
}

async function readSessions(): Promise<StoredSessions> {
	const { value } = await Preferences.get({ key: SESSIONS_KEY });
	if (!value) return { sessions: {}, order: [] };
	try {
		return JSON.parse(value) as StoredSessions;
	} catch {
		return { sessions: {}, order: [] };
	}
}

async function writeSessions(data: StoredSessions): Promise<void> {
	await Preferences.set({ key: SESSIONS_KEY, value: JSON.stringify(data) });
}

function newSessionId(): string {
	return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function firstUserMessage(items: ConversationItem[]): string {
	const user = items.find((i) => i.kind === "user");
	return user?.text.slice(0, 80) || "New chat";
}

export async function getActiveSessionPath(): Promise<string | null> {
	const { value } = await Preferences.get({ key: ACTIVE_SESSION_KEY });
	return value || null;
}

export async function setActiveSessionPath(path: string | null): Promise<void> {
	if (path) {
		await Preferences.set({ key: ACTIVE_SESSION_KEY, value: path });
	} else {
		await Preferences.remove({ key: ACTIVE_SESSION_KEY });
	}
}

export async function getModelSelection(): Promise<MobileModelSelection | null> {
	const { value } = await Preferences.get({ key: MODEL_KEY });
	if (!value) return null;
	try {
		return JSON.parse(value) as MobileModelSelection;
	} catch {
		return null;
	}
}

export async function setModelSelection(selection: MobileModelSelection): Promise<void> {
	await Preferences.set({ key: MODEL_KEY, value: JSON.stringify(selection) });
}

export async function getHubConfig(): Promise<MobileHubConfig> {
	const { value } = await Preferences.get({ key: HUB_CONFIG_KEY });
	if (!value) {
		return { agentName: "Mobile Agent", agentRole: "chat" };
	}
	try {
		return JSON.parse(value) as MobileHubConfig;
	} catch {
		return { agentName: "Mobile Agent", agentRole: "chat" };
	}
}

export async function setHubConfig(config: Partial<MobileHubConfig>): Promise<void> {
	const current = await getHubConfig();
	await Preferences.set({
		key: HUB_CONFIG_KEY,
		value: JSON.stringify({ ...current, ...config }),
	});
}

export async function createSession(): Promise<MobileSessionData> {
	const id = newSessionId();
	const path = `mobile://${id}`;
	const meta: MobileSessionMeta = {
		path,
		id,
		name: "New chat",
		modified: new Date().toISOString(),
		messageCount: 0,
		firstMessage: "New chat",
	};
	const session: MobileSessionData = { meta, items: [] };
	const store = await readSessions();
	store.sessions[path] = session;
	store.order.unshift(path);
	await writeSessions(store);
	await setActiveSessionPath(path);
	return session;
}

export async function loadSession(path: string): Promise<MobileSessionData | null> {
	const store = await readSessions();
	return store.sessions[path] ?? null;
}

export async function saveSessionItems(path: string, items: ConversationItem[]): Promise<void> {
	const store = await readSessions();
	const existing = store.sessions[path];
	if (!existing) return;
	existing.items = items;
	existing.meta.messageCount = items.filter((i) => i.kind === "user").length;
	existing.meta.firstMessage = firstUserMessage(items);
	existing.meta.modified = new Date().toISOString();
	if (!existing.meta.name || existing.meta.name === "New chat") {
		const first = firstUserMessage(items);
		if (first !== "New chat") existing.meta.name = first.slice(0, 40);
	}
	store.sessions[path] = existing;
	await writeSessions(store);
}

export async function listSessionMetas(includeArchived = false): Promise<MobileSessionMeta[]> {
	const store = await readSessions();
	return store.order
		.map((path) => store.sessions[path]?.meta)
		.filter((m): m is MobileSessionMeta => Boolean(m))
		.filter((m) => includeArchived || !m.archived);
}

export async function renameSession(path: string, name: string): Promise<void> {
	const store = await readSessions();
	const session = store.sessions[path];
	if (!session) return;
	session.meta.name = name;
	await writeSessions(store);
}

export async function archiveSession(path: string, archived: boolean): Promise<void> {
	const store = await readSessions();
	const session = store.sessions[path];
	if (!session) return;
	session.meta.archived = archived;
	await writeSessions(store);
}

export async function deleteSession(path: string): Promise<void> {
	const store = await readSessions();
	delete store.sessions[path];
	store.order = store.order.filter((p) => p !== path);
	await writeSessions(store);
	const active = await getActiveSessionPath();
	if (active === path) {
		await setActiveSessionPath(store.order[0] ?? null);
	}
}
