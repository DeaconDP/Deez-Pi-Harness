import type { AgentHost } from "./agent.js";

function modelsListUrl(baseUrl: string): string {
	const normalized = baseUrl.replace(/\/$/, "");
	return `${normalized}/models`;
}

async function parseErrorMessage(res: Response): Promise<string> {
	try {
		const body = (await res.json()) as { error?: { message?: string }; message?: string };
		return body.error?.message ?? body.message ?? `HTTP ${res.status}`;
	} catch {
		return `HTTP ${res.status}`;
	}
}

export async function validateProviderApiKey(
	host: AgentHost,
	provider: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
	const models = host.modelRegistry.getAll().filter((m) => m.provider === provider);
	if (models.length === 0) {
		return { ok: false, message: `No models found for provider "${provider}".` };
	}

	const model = models[0]!;
	const auth = await host.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		return { ok: false, message: auth.error };
	}

	const headers: Record<string, string> = { ...(auth.headers ?? {}) };
	if (auth.apiKey && !headers.Authorization) {
		headers.Authorization = `Bearer ${auth.apiKey}`;
	}
	if (!auth.apiKey && !headers.Authorization) {
		return { ok: false, message: "No API key available for validation." };
	}

	const url = modelsListUrl(model.baseUrl);

	try {
		const res = await fetch(url, {
			method: "GET",
			headers,
			signal: AbortSignal.timeout(15_000),
		});

		if (res.ok) {
			return { ok: true };
		}

		if (res.status === 401 || res.status === 403) {
			const msg = await parseErrorMessage(res);
			return { ok: false, message: `Invalid API key: ${msg}` };
		}

		if (res.status === 404) {
			return { ok: true };
		}

		const msg = await parseErrorMessage(res);
		return { ok: false, message: `Could not verify API key: ${msg}` };
	} catch (err) {
		return {
			ok: false,
			message: err instanceof Error ? err.message : "Could not reach provider.",
		};
	}
}
