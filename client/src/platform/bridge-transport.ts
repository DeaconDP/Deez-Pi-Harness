import { WsClient } from "../ws/client.js";
import type { ChatTransport, ConnectionState, MessageHandler } from "./transport.js";

export function createBridgeTransport(): ChatTransport {
	const ws = new WsClient();
	return {
		get state() {
			return ws.state;
		},
		set onStateChange(handler: ((state: ConnectionState) => void) | undefined) {
			ws.onStateChange = handler;
		},
		get onStateChange() {
			return ws.onStateChange;
		},
		connect() {
			ws.connect();
		},
		disconnect() {
			ws.disconnect();
		},
		send(cmd) {
			ws.send(cmd);
		},
		subscribe(handler: MessageHandler) {
			return ws.subscribe(handler);
		},
	};
}
