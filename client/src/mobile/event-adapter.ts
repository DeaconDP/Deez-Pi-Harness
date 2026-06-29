export function assistantMessageEvent(text: string, streaming = true): Record<string, unknown> {
	return {
		type: "message_update",
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
		},
		streaming,
	};
}

export function assistantMessageStart(): Record<string, unknown> {
	return {
		type: "message_start",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "" }],
		},
	};
}

export function assistantMessageEnd(text: string): Record<string, unknown> {
	return {
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
			stopReason: "end_turn",
		},
	};
}

export function agentStartEvent(): Record<string, unknown> {
	return { type: "agent_start" };
}

export function agentEndEvent(): Record<string, unknown> {
	return { type: "agent_end" };
}
