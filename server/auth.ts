import type { WebSocketServer } from "ws";
import type { AgentHost } from "./agent.js";
import type { ProviderAuthSummary } from "../shared/protocol.js";
import { broadcast } from "./extension-ui.js";

function getAuthType(
	host: AgentHost,
	provider: string,
): "api_key" | "oauth" {
	const oauthIds = new Set(host.authStorage.getOAuthProviders().map((p) => p.id));
	return oauthIds.has(provider) ? "oauth" : "api_key";
}

function sortAuthProviders(providers: ProviderAuthSummary[]): ProviderAuthSummary[] {
	return [...providers].sort((a, b) => {
		if (a.provider === "openrouter") return -1;
		if (b.provider === "openrouter") return 1;
		return a.displayName.localeCompare(b.displayName);
	});
}

export function getAuthProviderSummaries(host: AgentHost): ProviderAuthSummary[] {
	const providers = new Set(host.modelRegistry.getAll().map((m) => m.provider));
	const summaries = [...providers].map((provider) => {
		const status = host.modelRegistry.getProviderAuthStatus(provider);
		const configured = status.configured || host.authStorage.has(provider);
		return {
			provider,
			displayName: host.modelRegistry.getProviderDisplayName(provider),
			configured,
			authType: getAuthType(host, provider),
			source: status.source,
			label: status.label,
			stored: host.authStorage.has(provider),
		};
	});
	return sortAuthProviders(summaries);
}

export function broadcastAuthStatus(host: AgentHost, wss?: WebSocketServer) {
	const target = wss ?? host.wss;
	broadcast(target, {
		type: "auth_status",
		providers: getAuthProviderSummaries(host),
		modelRegistryError: host.modelRegistry.getError(),
	});
}
