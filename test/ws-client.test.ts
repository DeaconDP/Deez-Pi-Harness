import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { afterEach, describe, it } from "node:test";
import { WebSocketServer, type WebSocket } from "ws";
import { WsClient } from "../client/src/ws/client.js";

type ReceivedCommand = { type: string };

function listen(server: Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				reject(new Error("failed to bind test server"));
				return;
			}
			resolve(addr.port);
		});
	});
}

function waitFor(
	predicate: () => boolean,
	timeoutMs = 5000,
	intervalMs = 50,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (predicate()) {
				resolve();
				return;
			}
			if (Date.now() - started > timeoutMs) {
				reject(new Error("timeout"));
				return;
			}
			setTimeout(tick, intervalMs);
		};
		tick();
	});
}

describe("WsClient", () => {
	let server: Server;
	let wss: WebSocketServer;
	let clients: WsClient[] = [];
	const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");

	afterEach(async () => {
		for (const client of clients) client.disconnect();
		clients = [];
		wss?.close();
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		if (locationDescriptor) {
			Object.defineProperty(globalThis, "location", locationDescriptor);
		} else {
			Reflect.deleteProperty(globalThis, "location");
		}
	});

	async function startMockBridge(onMessage?: (cmd: ReceivedCommand) => void) {
		const received: ReceivedCommand[] = [];
		server = createServer();
		wss = new WebSocketServer({ server, path: "/ws" });
		wss.on("connection", (ws: WebSocket) => {
			ws.on("message", (data) => {
				const cmd = JSON.parse(data.toString()) as ReceivedCommand;
				received.push(cmd);
				onMessage?.(cmd);
			});
		});
		const port = await listen(server);
		Object.defineProperty(globalThis, "location", {
			configurable: true,
			value: { protocol: "http:", host: `127.0.0.1:${port}` },
		});
		return { received, port };
	}

	it("queues commands while disconnected and flushes on connect", async () => {
		const { received } = await startMockBridge();
		const client = new WsClient();
		clients.push(client);

		client.send({ type: "get_backlog" });
		client.send({ type: "list_sessions" });
		assert.equal(received.length, 0);

		client.connect();
		await waitFor(() => client.state === "connected" && received.length >= 2);

		assert.equal(received[0]?.type, "get_backlog");
		assert.equal(received[1]?.type, "list_sessions");
		client.disconnect();
	});

	it("enters disconnected state when the server closes the connection", async () => {
		const { received } = await startMockBridge();
		const client = new WsClient();
		clients.push(client);
		const states: string[] = [];
		client.onStateChange = (state) => states.push(state);

		client.connect();
		await waitFor(() => client.state === "connected");
		client.send({ type: "get_hub_config" });
		await waitFor(() => received.length >= 1);

		for (const ws of wss.clients) ws.close();
		await waitFor(() => client.state === "disconnected");

		assert.ok(states.includes("connecting"));
		assert.ok(states.includes("connected"));
		assert.ok(states.includes("disconnected"));
		client.disconnect();
	});
});
