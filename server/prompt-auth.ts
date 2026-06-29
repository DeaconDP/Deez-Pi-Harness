import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentHost } from "./agent.js";

type ResolvedAuth = Awaited<ReturnType<AgentHost["modelRegistry"]["getApiKeyAndHeaders"]>>;

export function hasRequestAuth(auth: ResolvedAuth): boolean {
	if (!auth.ok) return false;
	if (auth.apiKey) return true;
	const headers = auth.headers ?? {};
	return Object.keys(headers).some((key) => {
		const lower = key.toLowerCase();
		return lower === "authorization" || lower === "cf-aig-authorization";
	});
}

export async function getPromptAuthError(
	host: AgentHost,
	session: AgentSession,
): Promise<string | null> {
	const model = session.model;
	if (!model) {
		return "No model selected. Open Agent → Configure and choose a model.";
	}

	const auth = await host.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) return auth.error;
	if (!hasRequestAuth(auth)) {
		const name = host.modelRegistry.getProviderDisplayName(model.provider);
		return `No API key for ${name}. Open Agent → Configure, select ${name}, and enter your API key.`;
	}

	return null;
}

export async function isModelAuthReady(host: AgentHost, session: AgentSession): Promise<boolean> {
	const model = session.model;
	if (!model) return false;
	const auth = await host.modelRegistry.getApiKeyAndHeaders(model);
	return hasRequestAuth(auth);
}
