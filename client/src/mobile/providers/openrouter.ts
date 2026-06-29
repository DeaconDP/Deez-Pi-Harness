import type { ImageContent } from "../../../shared/protocol.js";
import type { ConversationItem } from "../state/session.js";

export const OPENROUTER_PROVIDER = "openrouter";

export interface OpenRouterModel {
	id: string;
	name: string;
}

export interface StreamCallbacks {
	onDelta: (text: string) => void;
	onDone: () => void;
	onError: (message: string) => void;
}

type ChatMessage =
	| { role: "user" | "assistant" | "system"; content: string }
	| {
			role: "user";
			content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
	  };

function itemsToMessages(items: ConversationItem[]): ChatMessage[] {
	const messages: ChatMessage[] = [];
	for (const item of items) {
		if (item.kind === "user") {
			messages.push({ role: "user", content: item.text });
		} else if (item.kind === "assistant") {
			const text = item.blocks
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("");
			if (text) messages.push({ role: "assistant", content: text });
		}
	}
	return messages;
}

function buildUserMessage(text: string, images?: ImageContent[]): ChatMessage {
	if (!images?.length) {
		return { role: "user", content: text };
	}
	const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
	if (text) content.push({ type: "text", text });
	for (const img of images) {
		content.push({
			type: "image_url",
			image_url: { url: `data:${img.mimeType};base64,${img.data}` },
		});
	}
	return { role: "user", content };
}

export async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
	const res = await fetch("https://openrouter.ai/api/v1/models", {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(body || `Failed to list models (${res.status})`);
	}
	const data = (await res.json()) as { data?: Array<{ id: string; name?: string }> };
	return (data.data ?? [])
		.map((m) => ({ id: m.id, name: m.name ?? m.id }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function streamOpenRouterChat(opts: {
	apiKey: string;
	modelId: string;
	history: ConversationItem[];
	userText: string;
	images?: ImageContent[];
	signal?: AbortSignal;
	callbacks: StreamCallbacks;
}): Promise<void> {
	const messages: ChatMessage[] = [
		{
			role: "system",
			content:
				"You are a helpful AI assistant in the Deez Pi Ui mobile app. Chat-only mode: you cannot run shell commands or edit files on the device.",
		},
		...itemsToMessages(opts.history),
		buildUserMessage(opts.userText, opts.images),
	];

	const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${opts.apiKey}`,
			"Content-Type": "application/json",
			"HTTP-Referer": "https://deac.online",
			"X-Title": "Deez Pi Ui",
		},
		body: JSON.stringify({
			model: opts.modelId,
			messages,
			stream: true,
		}),
		signal: opts.signal,
	});

	if (!res.ok) {
		const body = await res.text();
		let message = body || `Request failed (${res.status})`;
		try {
			const parsed = JSON.parse(body) as { error?: { message?: string } };
			message = parsed.error?.message ?? message;
		} catch {
			/* use raw body */
		}
		opts.callbacks.onError(message);
		return;
	}

	const reader = res.body?.getReader();
	if (!reader) {
		opts.callbacks.onError("No response stream");
		return;
	}

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data:")) continue;
			const payload = trimmed.slice(5).trim();
			if (payload === "[DONE]") continue;
			try {
				const chunk = JSON.parse(payload) as {
					choices?: Array<{ delta?: { content?: string } }>;
					error?: { message?: string };
				};
				if (chunk.error?.message) {
					opts.callbacks.onError(chunk.error.message);
					return;
				}
				const delta = chunk.choices?.[0]?.delta?.content;
				if (delta) opts.callbacks.onDelta(delta);
			} catch {
				/* skip malformed chunk */
			}
		}
	}

	opts.callbacks.onDone();
}

export function validateOpenRouterKey(apiKey: string): Promise<void> {
	return fetchOpenRouterModels(apiKey).then(() => undefined);
}
