import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import WebSocket from "ws";
import { startServer } from "../server/index.js";

function randomPort(): number {
	return 31400 + Math.floor(Math.random() * 1000);
}

function waitForMessage(
	ws: WebSocket,
	predicate: (msg: Record<string, unknown>) => boolean,
	timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			ws.off("message", onMessage);
			reject(new Error("timeout waiting for message"));
		}, timeoutMs);

		function onMessage(data: WebSocket.RawData) {
			const msg = JSON.parse(data.toString()) as Record<string, unknown>;
			if (predicate(msg)) {
				clearTimeout(timeout);
				ws.off("message", onMessage);
				resolve(msg);
			}
		}

		ws.on("message", onMessage);
	});
}

describe("auth flow", () => {
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

	it("set_auth saves immediately and list_models can scope by provider", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
		await new Promise<void>((resolve, reject) => {
			ws.once("open", () => resolve());
			ws.once("error", reject);
		});

		try {
			// Drain handshake messages
			await new Promise((r) => setTimeout(r, 200));

			ws.send(
				JSON.stringify({
					type: "set_auth",
					provider: "openrouter",
					apiKey: "sk-test-openrouter-key",
				}),
			);

			const authSaved = await waitForMessage(
				ws,
				(msg) => msg.type === "auth_saved" && msg.provider === "openrouter",
				2_000,
			);
			assert.equal(authSaved.displayName, "OpenRouter");

			ws.send(JSON.stringify({ type: "list_models", provider: "openrouter" }));

			const modelList = await waitForMessage(ws, (msg) => msg.type === "model_list", 5_000);
			const models = modelList.models as Array<{
				provider: string;
				id: string;
				available: boolean;
			}>;

			assert.ok(models.length > 0, "expected openrouter models");
			assert.ok(
				models.every((m) => m.provider === "openrouter"),
				"list_models provider filter should return only openrouter models",
			);
			assert.ok(
				models.some((m) => m.available),
				"at least one openrouter model should be available after set_auth",
			);
		} finally {
			ws.close();
		}
	});
});
