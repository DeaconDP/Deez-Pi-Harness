/** Hub configuration types. */

import type { AgentRole } from "./backlog.js";

export interface HubConfig {
	agentRole: AgentRole;
	agentName: string;
	nodeLabel: string;
	peerToken?: string;
	tailscaleTag?: string;
}

export const DEFAULT_HUB_CONFIG: HubConfig = {
	agentRole: "coding",
	agentName: "Hub Agent",
	nodeLabel: typeof process !== "undefined" && process.env?.HOSTNAME
		? process.env.HOSTNAME
		: "local",
};
