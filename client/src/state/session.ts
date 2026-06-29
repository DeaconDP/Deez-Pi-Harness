export interface ThinkingBlock {
	type: "thinking";
	text: string;
	expanded: boolean;
}

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ToolBlock {
	type: "tool";
	callId: string;
	name: string;
	args: unknown;
	output: string;
	isError: boolean;
	running: boolean;
	expanded: boolean;
}

export type Block = ThinkingBlock | TextBlock | ToolBlock;

export interface UserItem {
	kind: "user";
	text: string;
}

export interface AssistantItem {
	kind: "assistant";
	blocks: Block[];
	streaming: boolean;
}

export type ConversationItem = UserItem | AssistantItem;

export interface ExtUIRequest {
	id: string;
	method: string;
	title?: string;
	message?: string;
	options?: string[];
	prefill?: string;
	inputType?: string;
	notifyType?: "info" | "warning" | "error";
	statusText?: string;
}

export interface AppState {
	connected: boolean;
	streaming: boolean;
	items: ConversationItem[];
	dialog: ExtUIRequest | null;
	cwd?: string;
	sessionId?: string;
	sessionName?: string;
	model?: string;
	modelProvider?: string;
	modelAuthConfigured?: boolean;
	modelRegistryError?: string;
	currentModel?: { provider: string; id: string };
	thinkingLevel?: string;
	supportsThinking?: boolean;
	availableThinkingLevels?: string[];
}

export function createInitialState(): AppState {
	return {
		connected: false,
		streaming: false,
		items: [],
		dialog: null,
	};
}

export function extractUserText(msg: Record<string, unknown>): string {
	const content = msg.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return (content as Array<Record<string, unknown>>)
			.filter((c) => c.type === "text")
			.map((c) => c.text as string)
			.join("\n");
	}
	return String(content ?? "");
}

function findExistingToolBlock(blocks: Block[] | undefined, callId: string): ToolBlock | undefined {
	return blocks?.find((b): b is ToolBlock => b.type === "tool" && b.callId === callId);
}

function findExistingThinkingBlock(blocks: Block[] | undefined): ThinkingBlock | undefined {
	return blocks?.find((b): b is ThinkingBlock => b.type === "thinking");
}

export function blocksFromAssistantPayload(
	message: Record<string, unknown>,
	existingBlocks?: Block[],
): Block[] {
	const contentArr = message.content as Array<Record<string, unknown>> | undefined;
	const blocks: Block[] = [];

	if (contentArr) {
		for (const c of contentArr) {
			if (c.type === "text") {
				const text = String(c.text ?? "");
				if (text) blocks.push({ type: "text", text });
			} else if (c.type === "thinking") {
				const existing = findExistingThinkingBlock(existingBlocks);
				blocks.push({
					type: "thinking",
					text: String(c.thinking ?? ""),
					expanded: existing?.expanded ?? false,
				});
			} else if (c.type === "toolCall") {
				const callId = c.id as string;
				const existing = findExistingToolBlock(existingBlocks, callId);
				blocks.push({
					type: "tool",
					callId,
					name: c.name as string,
					args: c.arguments,
					output: existing?.output ?? "",
					isError: existing?.isError ?? false,
					running: existing?.running ?? true,
					expanded: existing?.expanded ?? false,
				});
			}
		}
	}

	const hasVisibleContent = blocks.some(
		(b) =>
			(b.type === "text" && b.text.trim().length > 0) ||
			(b.type === "thinking" && b.text.trim().length > 0) ||
			b.type === "tool",
	);
	const hasToolCalls = contentArr?.some((c) => c.type === "toolCall") ?? false;
	const stopReason = message.stopReason as string | undefined;
	const errorMessage = message.errorMessage as string | undefined;

	if (!hasVisibleContent && !hasToolCalls) {
		if (stopReason === "error") {
			const raw = errorMessage || "Unknown error";
			const text = raw.includes("Missing Authentication header")
				? "Authentication required. Open Agent → Configure, select your provider, and enter a valid API key."
				: raw;
			blocks.push({ type: "text", text: `Error: ${text}` });
		} else if (stopReason === "aborted") {
			const text =
				errorMessage && errorMessage !== "Request was aborted"
					? errorMessage
					: "Operation aborted";
			blocks.push({ type: "text", text });
		}
	}

	return blocks;
}

function syncAssistantFromMessage(item: AssistantItem, message: Record<string, unknown>) {
	item.blocks = blocksFromAssistantPayload(message, item.blocks);
}

export function handleStateSync(state: AppState, data: Record<string, unknown>): AssistantItem | null {
	const messages = data.messages as Array<Record<string, unknown>> | undefined;
	state.items = [];
	state.streaming = (data.streaming as boolean) ?? false;
	state.cwd = data.cwd as string | undefined;
	state.sessionId = data.sessionId as string | undefined;
	state.sessionName = data.sessionName as string | undefined;
	state.model = data.model as string | undefined;
	state.modelProvider = data.modelProvider as string | undefined;
	state.modelAuthConfigured = data.modelAuthConfigured as boolean | undefined;
	state.thinkingLevel = data.thinkingLevel as string | undefined;
	state.supportsThinking = data.supportsThinking as boolean | undefined;
	state.availableThinkingLevels = data.availableThinkingLevels as string[] | undefined;

	if (!messages) return null;

	for (const msg of messages) {
		if (msg.role === "user") {
			state.items.push({ kind: "user", text: extractUserText(msg) });
		} else if (msg.role === "assistant") {
			state.items.push({
				kind: "assistant",
				blocks: blocksFromAssistantPayload(msg),
				streaming: false,
			});
		} else if (msg.role === "toolResult") {
			const callId = msg.toolCallId as string;
			const content = (msg.content as Array<Record<string, unknown>> | undefined)?.[0];
			const text = content?.type === "text" ? (content.text as string) : "";
			findToolBlock(state, callId, (b) => {
				b.output = text;
				b.running = false;
				b.isError = (msg.isError as boolean) ?? false;
				if (b.isError) b.expanded = true;
			});
		}
	}

	return null;
}

export function findToolBlock(
	state: AppState,
	callId: string,
	mutate: (b: ToolBlock) => void,
) {
	for (let i = state.items.length - 1; i >= 0; i--) {
		const item = state.items[i];
		if (item.kind === "assistant") {
			const block = item.blocks.find((b): b is ToolBlock => b.type === "tool" && b.callId === callId);
			if (block) {
				mutate(block);
				return;
			}
		}
	}
}

export function handleAgentEvent(
	state: AppState,
	event: Record<string, unknown>,
	currentAssistant: AssistantItem | null,
): AssistantItem | null {
	switch (event.type) {
		case "state_sync":
			return handleStateSync(state, event);

		case "agent_start": {
			state.streaming = true;
			const item: AssistantItem = { kind: "assistant", blocks: [], streaming: true };
			state.items.push(item);
			return item;
		}

		case "message_update": {
			const msg = event.message as Record<string, unknown> | undefined;
			if (!currentAssistant) break;
			if (msg?.role === "assistant") {
				syncAssistantFromMessage(currentAssistant, msg);
			}
			break;
		}

		case "message_start": {
			const msg = event.message as Record<string, unknown> | undefined;
			if (msg?.role === "assistant") {
				if (currentAssistant && currentAssistant.blocks.length > 0) {
					currentAssistant.streaming = false;
					const item: AssistantItem = { kind: "assistant", blocks: [], streaming: true };
					state.items.push(item);
					syncAssistantFromMessage(item, msg);
					return item;
				}
				if (!currentAssistant) {
					const item: AssistantItem = { kind: "assistant", blocks: [], streaming: true };
					state.items.push(item);
					syncAssistantFromMessage(item, msg);
					return item;
				}
				syncAssistantFromMessage(currentAssistant, msg);
			}
			break;
		}

		case "message_end": {
			const msg = event.message as Record<string, unknown> | undefined;
			if (msg?.role === "assistant" && currentAssistant) {
				syncAssistantFromMessage(currentAssistant, msg);
				currentAssistant.streaming = false;
			}
			break;
		}

		case "tool_execution_update": {
			const partial = event.partialResult as Record<string, unknown> | undefined;
			const content = (partial?.content as Array<Record<string, unknown>> | undefined)?.[0];
			const text = content?.type === "text" ? (content.text as string) : "";
			if (text) findToolBlock(state, event.toolCallId as string, (b) => { b.output = text; });
			break;
		}

		case "tool_execution_end": {
			const result = event.result as Record<string, unknown> | undefined;
			const content = (result?.content as Array<Record<string, unknown>> | undefined)?.[0];
			const text = content?.type === "text" ? (content.text as string) : "";
			findToolBlock(state, event.toolCallId as string, (b) => {
				b.running = false;
				b.isError = (event.isError as boolean) ?? false;
				if (text) b.output = text;
				if (b.isError) b.expanded = true;
			});
			break;
		}

		case "agent_end":
			state.streaming = false;
			if (currentAssistant) currentAssistant.streaming = false;
			return null;
	}

	return currentAssistant;
}
