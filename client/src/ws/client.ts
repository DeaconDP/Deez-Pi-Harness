import type { ClientCommand } from "../../shared/protocol.js";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export type MessageHandler = (event: Record<string, unknown>) => void;

const MAX_QUEUE_SIZE = 100;

export class WsClient {
	private ws: WebSocket | null = null;
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private handlers = new Set<MessageHandler>();
	private pendingQueue: ClientCommand[] = [];
	state: ConnectionState = "connecting";

	onStateChange?: (state: ConnectionState) => void;

	connect() {
		if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
			return;
		}

		this.setState("connecting");
		const proto = location.protocol === "https:" ? "wss:" : "ws:";
		this.ws = new WebSocket(`${proto}//${location.host}/ws`);

		this.ws.onopen = () => {
			this.reconnectAttempt = 0;
			this.setState("connected");
			this.flushQueue();
		};

		this.ws.onclose = () => {
			this.ws = null;
			this.setState("disconnected");
			this.scheduleReconnect();
		};

		this.ws.onerror = () => this.ws?.close();

		this.ws.onmessage = (e) => {
			try {
				const event = JSON.parse(e.data as string) as Record<string, unknown>;
				for (const handler of this.handlers) handler(event);
			} catch {
				/* ignore malformed messages */
			}
		};
	}

	private setState(state: ConnectionState) {
		this.state = state;
		this.onStateChange?.(state);
	}

	private scheduleReconnect() {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30000);
		this.reconnectAttempt++;
		this.reconnectTimer = setTimeout(() => this.connect(), delay);
	}

	private flushQueue() {
		if (this.ws?.readyState !== WebSocket.OPEN) return;
		while (this.pendingQueue.length > 0) {
			const cmd = this.pendingQueue.shift()!;
			this.ws.send(JSON.stringify(cmd));
		}
	}

	subscribe(handler: MessageHandler) {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	send(cmd: ClientCommand) {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(cmd));
			return;
		}
		if (this.pendingQueue.length >= MAX_QUEUE_SIZE) {
			this.pendingQueue.shift();
		}
		this.pendingQueue.push(cmd);
	}

	disconnect() {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		this.pendingQueue = [];
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.onerror = null;
			this.ws.close();
			this.ws = null;
		}
		this.setState("disconnected");
	}
}
