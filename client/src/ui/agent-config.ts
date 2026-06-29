import type { AppState } from "../state/session.js";

export type AgentStatusClass = "connecting" | "disconnected" | "connected" | "streaming";

export interface AgentStatus {
	label: string;
	statusClass: AgentStatusClass;
}

export function getAgentStatus(
	appState: AppState,
	wsState: "connecting" | "connected" | "disconnected" = "disconnected",
): AgentStatus {
	if (!appState.connected) {
		if (wsState === "connecting") {
			return { label: "Connecting…", statusClass: "connecting" };
		}
		return { label: "Disconnected", statusClass: "disconnected" };
	}
	if (appState.streaming) {
		return { label: "Busy", statusClass: "streaming" };
	}
	return { label: "Idle", statusClass: "connected" };
}
