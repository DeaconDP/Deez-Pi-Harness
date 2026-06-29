import type { ClientCommand } from "../../../shared/protocol.js";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export type MessageHandler = (event: Record<string, unknown>) => void;

export interface ChatTransport {
	state: ConnectionState;
	onStateChange?: (state: ConnectionState) => void;
	connect(): void;
	disconnect(): void;
	send(cmd: ClientCommand): void;
	subscribe(handler: MessageHandler): () => void;
}
