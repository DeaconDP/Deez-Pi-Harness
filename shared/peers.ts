/** Direct WebSocket peer protocol between Pi PWA bridges. */

import type { BacklogProject } from "./backlog.js";

export interface PeerAuth {
	token: string;
}

export type PeerMessage =
	| { type: "auth"; token: string }
	| { type: "auth_ok" }
	| { type: "auth_fail"; reason: string }
	| { type: "update_backlog"; project: BacklogProject; fromNode: string }
	| { type: "backlog_snapshot_request" }
	| { type: "backlog_snapshot"; projects: BacklogProject[]; fromNode: string }
	| { type: "run_project"; projectId: string; fromNode: string }
	| { type: "task_complete"; projectId: string; projectName: string; fromNode: string }
	| { type: "ack"; ref: string };

export interface PeerNotification {
	id: string;
	timestamp: string;
	kind: "backlog_update" | "task_complete" | "run_started" | "info";
	fromNode: string;
	message: string;
	projectId?: string;
	projectName?: string;
}
