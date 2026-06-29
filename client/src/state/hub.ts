import type { HubConfigSnapshot, StackNodeSummary } from "../../../shared/protocol.js";

export interface HubState {
	nodes: StackNodeSummary[];
	hubConfig: HubConfigSnapshot;
}

export function createHubState(): HubState {
	return {
		nodes: [],
		hubConfig: {
			agentRole: "coding",
			agentName: "Hub Agent",
			nodeLabel: "local",
		},
	};
}
