/** Shared WebSocket protocol between Pi PWA client and bridge server. */

import type { BacklogProject } from "./backlog.js";
import type { AgentRole } from "./backlog.js";
import type { PeerNotification } from "./peers.js";

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

/** Client → server commands */
export type ClientCommand =
	| { type: "prompt"; message: string; streamingBehavior?: "steer" | "followUp"; images?: ImageContent[] }
	| { type: "steer"; message: string; images?: ImageContent[] }
	| { type: "follow_up"; message: string; images?: ImageContent[] }
	| { type: "abort" }
	| { type: "new_session" }
	| { type: "list_sessions" }
	| { type: "resume_session"; path: string }
	| { type: "rename_session"; path: string; name: string }
	| { type: "delete_session"; path: string }
	| { type: "archive_session"; path: string }
	| { type: "unarchive_session"; path: string }
	| { type: "set_model"; provider: string; modelId: string }
	| { type: "cycle_model"; direction?: "forward" | "backward" }
	| { type: "set_thinking_level"; level: string }
	| { type: "cycle_thinking_level" }
	| { type: "navigate_tree"; targetId: string }
	| { type: "get_tree" }
	| { type: "compact"; customInstructions?: string }
	| { type: "list_models"; provider?: string }
	| { type: "get_auth_status" }
	| { type: "set_auth"; provider: string; apiKey: string }
	| { type: "remove_auth"; provider: string }
	| { type: "oauth_login"; provider: string }
	| { type: "oauth_login_cancel"; provider?: string }
	| {
			type: "oauth_login_response";
			loginId: string;
			stepId: string;
			cancelled?: boolean;
			value?: string;
			selectedId?: string;
	  }
	| { type: "extension_ui_response"; id: string; [key: string]: unknown }
	| { type: "get_backlog" }
	| { type: "update_backlog"; project: BacklogProject }
	| { type: "reorder_backlog"; projectIds: string[] }
	| { type: "add_backlog_project" }
	| { type: "delete_backlog_project"; projectId: string }
	| { type: "run_backlog_project"; projectId: string; nodeId?: string }
	| { type: "push_backlog_to_peer"; projectId: string; nodeId: string }
	| { type: "get_nodes" }
	| { type: "get_hub_config" }
	| { type: "set_hub_config"; config: Partial<HubConfigSnapshot> };

/** Server → client messages (includes Pi AgentSessionEvent passthrough) */
export interface StateSyncMessage {
	type: "state_sync";
	messages: unknown[];
	streaming: boolean;
	model?: string;
	modelProvider?: string;
	modelAuthConfigured?: boolean;
	sessionId?: string;
	cwd?: string;
	sessionName?: string;
	thinkingLevel?: string;
	supportsThinking?: boolean;
	availableThinkingLevels?: string[];
}

export interface SessionListMessage {
	type: "session_list";
	sessions: SessionSummary[];
}

export interface SessionSummary {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
	archived?: boolean;
}

export interface ModelListMessage {
	type: "model_list";
	models: ModelSummary[];
	current?: { provider: string; id: string };
	error?: string;
}

export interface ModelSummary {
	provider: string;
	id: string;
	name?: string;
	available: boolean;
}

export interface AuthStatusMessage {
	type: "auth_status";
	providers: ProviderAuthSummary[];
	modelRegistryError?: string;
}

export interface AuthSavedMessage {
	type: "auth_saved";
	provider: string;
	displayName: string;
}

export interface AuthFailedMessage {
	type: "auth_failed";
	provider: string;
	message: string;
}

export type AuthSource =
	| "stored"
	| "runtime"
	| "environment"
	| "fallback"
	| "models_json_key"
	| "models_json_command";

export interface ProviderAuthSummary {
	provider: string;
	displayName: string;
	configured: boolean;
	authType: "api_key" | "oauth";
	source?: AuthSource;
	label?: string;
	stored: boolean;
	error?: string;
}

export type OAuthLoginStepMessage =
	| {
			type: "oauth_login_step";
			loginId: string;
			provider: string;
			kind: "url";
			url: string;
			instructions?: string;
			manualCode?: boolean;
			stepId?: string;
	  }
	| {
			type: "oauth_login_step";
			loginId: string;
			provider: string;
			kind: "device_code";
			userCode: string;
			verificationUri: string;
			intervalSeconds?: number;
			expiresInSeconds?: number;
	  }
	| {
			type: "oauth_login_step";
			loginId: string;
			provider: string;
			kind: "prompt";
			stepId: string;
			message: string;
			placeholder?: string;
	  }
	| {
			type: "oauth_login_step";
			loginId: string;
			provider: string;
			kind: "select";
			stepId: string;
			message: string;
			options: Array<{ id: string; label: string }>;
	  }
	| {
			type: "oauth_login_step";
			loginId: string;
			provider: string;
			kind: "manual_code";
			stepId: string;
			message: string;
	  }
	| {
			type: "oauth_login_step";
			loginId: string;
			provider: string;
			kind: "progress";
			message: string;
	  };

export interface OAuthLoginCompleteMessage {
	type: "oauth_login_complete";
	loginId: string;
	provider: string;
	success: boolean;
	displayName?: string;
	error?: string;
}

export interface TreeMessage {
	type: "session_tree";
	tree: unknown;
	leafId: string | null;
}

export interface ErrorMessage {
	type: "error";
	message: string;
}

export interface BacklogSnapshotMessage {
	type: "backlog_snapshot";
	projects: BacklogProject[];
}

export interface BacklogUpdatedMessage {
	type: "backlog_updated";
	projects: BacklogProject[];
}

export interface PeerNotificationMessage {
	type: "peer_notification";
	notification: PeerNotification;
}

export interface StackNodeSummary {
	id: string;
	name: string;
	hostname: string;
	tailscaleIp: string;
	isLocal: boolean;
	piActive: boolean;
	providerConnected: boolean;
	llmModel: string;
	lastSeen: string;
}

export interface NodeListMessage {
	type: "node_list";
	nodes: StackNodeSummary[];
}

export interface HubConfigSnapshot {
	agentRole: AgentRole;
	agentName: string;
	nodeLabel: string;
}

export interface HubConfigMessage {
	type: "hub_config";
	config: HubConfigSnapshot;
}

export interface NodeStatusResponse {
	ok: boolean;
	nodeLabel: string;
	piActive: boolean;
	providerConnected: boolean;
	llmModel: string;
	modelProvider?: string;
	streaming: boolean;
}

export const DEFAULT_PORT = 3141;
export const DEFAULT_HOST = "127.0.0.1";
