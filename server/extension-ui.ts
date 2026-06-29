import * as crypto from "node:crypto";
import type { WebSocketServer } from "ws";

type PendingUIRequest = {
	resolve: (response: Record<string, unknown>) => void;
};

const pendingExtensionRequests = new Map<string, PendingUIRequest>();

export function broadcast(wss: WebSocketServer, msg: unknown) {
	const data = JSON.stringify(msg);
	for (const client of wss.clients) {
		if (client.readyState === 1) {
			client.send(data);
		}
	}
}

export function resolveExtensionUIResponse(id: string, response: Record<string, unknown>) {
	const pending = pendingExtensionRequests.get(id);
	if (pending) {
		pendingExtensionRequests.delete(id);
		pending.resolve(response);
	}
}

export function createExtensionUIContext(wss: WebSocketServer) {
	function createDialogPromise<T>(
		opts: { signal?: AbortSignal; timeout?: number } | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (r: Record<string, unknown>) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
		const id = crypto.randomUUID();
		return new Promise<T>((resolve) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
			};
			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });
			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}
			pendingExtensionRequests.set(id, {
				resolve: (response) => {
					cleanup();
					resolve(parseResponse(response));
				},
			});
			broadcast(wss, { type: "extension_ui_request", id, ...request });
		});
	}

	return {
		select: (
			title: string,
			options: string[],
			opts?: { signal?: AbortSignal; timeout?: number },
		) =>
			createDialogPromise(
				opts,
				undefined as string | undefined,
				{ method: "select", title, options, timeout: opts?.timeout },
				(r) =>
					"cancelled" in r && r.cancelled
						? undefined
						: "value" in r
							? (r.value as string)
							: undefined,
			),
		confirm: (
			title: string,
			message?: string,
			opts?: { signal?: AbortSignal; timeout?: number },
		) =>
			createDialogPromise(
				opts,
				false,
				{ method: "confirm", title, message, timeout: opts?.timeout },
				(r) =>
					"cancelled" in r && r.cancelled
						? false
						: "confirmed" in r
							? (r.confirmed as boolean)
							: false,
			),
		input: (
			title: string,
			placeholder?: string,
			opts?: { signal?: AbortSignal; timeout?: number },
		) =>
			createDialogPromise(
				opts,
				undefined as string | undefined,
				{ method: "input", title, placeholder, timeout: opts?.timeout },
				(r) =>
					"cancelled" in r && r.cancelled
						? undefined
						: "value" in r
							? (r.value as string)
							: undefined,
			),
		notify(message: string, type?: "info" | "warning" | "error") {
			broadcast(wss, {
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "notify",
				message,
				notifyType: type,
			});
		},
		onTerminalInput() {
			return () => {};
		},
		setStatus(key: string, text: string | undefined) {
			broadcast(wss, {
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
			});
		},
		setWorkingMessage(_message: string | undefined) {},
		setWidget(
			key: string,
			content: string[] | undefined,
			options?: { placement?: string },
		) {
			if (content === undefined || Array.isArray(content)) {
				broadcast(wss, {
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content,
					widgetPlacement: options?.placement,
				});
			}
		},
		setTitle(_title: string | undefined) {},
		editor: undefined,
	};
}
