import * as crypto from "node:crypto";
import type { WebSocketServer } from "ws";
import type { AgentHost } from "./agent.js";
import { broadcastAuthStatus } from "./auth.js";
import { broadcast } from "./extension-ui.js";

type StepResolver = {
	resolve: (value: string | undefined) => void;
	reject: (error: Error) => void;
};

const pendingSteps = new Map<string, StepResolver>();
const activeLogins = new Map<string, AbortController>();

export function resolveOAuthLoginResponse(stepId: string, response: Record<string, unknown>) {
	const pending = pendingSteps.get(stepId);
	if (!pending) return;

	pendingSteps.delete(stepId);
	if ("cancelled" in response && response.cancelled) {
		pending.reject(new Error("Login cancelled"));
		return;
	}
	if ("selectedId" in response && typeof response.selectedId === "string") {
		pending.resolve(response.selectedId);
		return;
	}
	if ("value" in response && typeof response.value === "string") {
		pending.resolve(response.value);
		return;
	}
	pending.resolve(undefined);
}

export function cancelOAuthLogin(provider?: string) {
	if (provider) {
		activeLogins.get(provider)?.abort();
		activeLogins.delete(provider);
		return;
	}
	for (const controller of activeLogins.values()) {
		controller.abort();
	}
	activeLogins.clear();
}

function createStepPromise(
	wss: WebSocketServer,
	loginId: string,
	provider: string,
	step: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const stepId = crypto.randomUUID();
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Login cancelled"));
			return;
		}

		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
			pendingSteps.delete(stepId);
		};

		const onAbort = () => {
			cleanup();
			reject(new Error("Login cancelled"));
		};

		signal?.addEventListener("abort", onAbort, { once: true });
		pendingSteps.set(stepId, {
			resolve: (value) => {
				cleanup();
				resolve(value);
			},
			reject: (error) => {
				cleanup();
				reject(error);
			},
		});

		broadcast(wss, { type: "oauth_login_step", loginId, provider, stepId, ...step });
	});
}

export async function runOAuthLogin(host: AgentHost, providerId: string) {
	if (activeLogins.has(providerId)) {
		broadcast(host.wss, {
			type: "error",
			message: `OAuth login already in progress for ${providerId}`,
		});
		return;
	}

	const displayName = host.modelRegistry.getProviderDisplayName(providerId);
	const providerInfo = host.authStorage
		.getOAuthProviders()
		.find((provider) => provider.id === providerId);
	if (!providerInfo) {
		broadcast(host.wss, {
			type: "error",
			message: `Unknown OAuth provider: ${providerId}`,
		});
		return;
	}

	const loginId = crypto.randomUUID();
	const controller = new AbortController();
	activeLogins.set(providerId, controller);
	const usesCallbackServer = providerInfo.usesCallbackServer ?? false;

	let manualCodeResolve: ((value: string) => void) | undefined;
	let manualCodeReject: ((error: Error) => void) | undefined;
	const manualCodePromise = usesCallbackServer
		? new Promise<string>((resolve, reject) => {
				manualCodeResolve = resolve;
				manualCodeReject = reject;
			})
		: undefined;

	const manualCodeStepId = usesCallbackServer ? crypto.randomUUID() : undefined;

	try {
		await host.authStorage.login(providerId, {
			signal: controller.signal,
			onAuth: (info) => {
				broadcast(host.wss, {
					type: "oauth_login_step",
					loginId,
					provider: providerId,
					kind: "url",
					url: info.url,
					instructions: info.instructions,
					manualCode: usesCallbackServer,
					stepId: manualCodeStepId,
				});
				if (usesCallbackServer && manualCodeStepId) {
					pendingSteps.set(manualCodeStepId, {
						resolve: (value) => {
							if (value && manualCodeResolve) {
								manualCodeResolve(value);
								manualCodeResolve = undefined;
							}
						},
						reject: (error) => {
							if (manualCodeReject) {
								manualCodeReject(error);
								manualCodeReject = undefined;
							}
						},
					});
					broadcast(host.wss, {
						type: "oauth_login_step",
						loginId,
						provider: providerId,
						kind: "manual_code",
						stepId: manualCodeStepId,
						message: "Paste redirect URL below, or complete login in browser:",
					});
				}
			},
			onDeviceCode: (info) => {
				broadcast(host.wss, {
					type: "oauth_login_step",
					loginId,
					provider: providerId,
					kind: "device_code",
					userCode: info.userCode,
					verificationUri: info.verificationUri,
					intervalSeconds: info.intervalSeconds,
					expiresInSeconds: info.expiresInSeconds,
				});
			},
			onPrompt: (prompt) =>
				createStepPromise(
					host.wss,
					loginId,
					providerId,
					{
						kind: "prompt",
						message: prompt.message,
						placeholder: prompt.placeholder,
					},
					controller.signal,
				).then((value) => value ?? ""),
			onSelect: (prompt) =>
				createStepPromise(
					host.wss,
					loginId,
					providerId,
					{
						kind: "select",
						message: prompt.message,
						options: prompt.options,
					},
					controller.signal,
				),
			onManualCodeInput: () => {
				if (!manualCodePromise) {
					return createStepPromise(
						host.wss,
						loginId,
						providerId,
						{
							kind: "manual_code",
							message: "Paste the authorization code or redirect URL:",
						},
						controller.signal,
					).then((value) => value ?? "");
				}
				return manualCodePromise;
			},
			onProgress: (message) => {
				broadcast(host.wss, {
					type: "oauth_login_step",
					loginId,
					provider: providerId,
					kind: "progress",
					message,
				});
			},
		});

		host.modelRegistry.refresh();
		broadcast(host.wss, {
			type: "oauth_login_complete",
			loginId,
			provider: providerId,
			success: true,
			displayName,
		});
		broadcastAuthStatus(host);
		broadcast(host.wss, {
			type: "auth_saved",
			provider: providerId,
			displayName,
		});
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		broadcast(host.wss, {
			type: "oauth_login_complete",
			loginId,
			provider: providerId,
			success: false,
			displayName,
			error: errorMsg !== "Login cancelled" ? errorMsg : undefined,
		});
	} finally {
		activeLogins.delete(providerId);
		if (manualCodeStepId) pendingSteps.delete(manualCodeStepId);
	}
}
