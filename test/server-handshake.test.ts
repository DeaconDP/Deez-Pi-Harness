import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import WebSocket from "ws";
import { startServer } from "../server/index.js";

function randomPort(): number {
	return 31400 + Math.floor(Math.random() * 1000);
}

describe("WebSocket handshake", () => {
	let port: number;
	let shutdown: () => Promise<void>;

	before(async () => {
		port = randomPort();
		const server = await startServer({ port, cwd: process.cwd(), host: "127.0.0.1" });
		shutdown = server.shutdown;
	});

	after(async () => {
		await shutdown();
	});

	it("pushes state_sync, backlog_snapshot, node_list, and hub_config on connect", async () => {
		const messages = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
			const received: Record<string, unknown>[] = [];
			const timeout = setTimeout(() => {
				ws.close();
				reject(new Error(`timeout waiting for handshake (got ${received.length} messages)`));
			}, 30_000);

			ws.on("message", (data) => {
				received.push(JSON.parse(data.toString()) as Record<string, unknown>);
				if (received.length >= 4) {
					clearTimeout(timeout);
					ws.close();
					resolve(received);
				}
			});
			ws.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});

		const types = messages.map((m) => m.type);
		assert.ok(types.includes("state_sync"), `missing state_sync: ${types.join(", ")}`);
		assert.ok(types.includes("backlog_snapshot"), `missing backlog_snapshot: ${types.join(", ")}`);
		assert.ok(types.includes("node_list"), `missing node_list: ${types.join(", ")}`);
		assert.ok(types.includes("hub_config"), `missing hub_config: ${types.join(", ")}`);

		const stateSync = messages.find((m) => m.type === "state_sync");
		assert.equal(typeof stateSync?.streaming, "boolean");
		assert.ok(Array.isArray(stateSync?.messages));

		const nodeList = messages.find((m) => m.type === "node_list");
		assert.ok(Array.isArray(nodeList?.nodes));

		const hubConfig = messages.find((m) => m.type === "hub_config");
		assert.equal(typeof hubConfig?.config, "object");
	});

	it("responds to get_nodes with node_list", async () => {
		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
			const timeout = setTimeout(() => {
				ws.close();
				reject(new Error("timeout waiting for get_nodes response"));
			}, 30_000);

			ws.on("open", () => {
				ws.send(JSON.stringify({ type: "get_nodes" }));
			});

			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString()) as Record<string, unknown>;
				if (msg.type === "node_list") {
					clearTimeout(timeout);
					assert.ok(Array.isArray(msg.nodes));
					ws.close();
					resolve();
				}
			});

			ws.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});
	});
});
