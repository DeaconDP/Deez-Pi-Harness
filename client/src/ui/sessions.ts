import type { SessionSummary } from "../../../shared/protocol.js";

export interface SessionCallbacks {
	onSelect: (path: string) => void;
	onRename: (path: string, currentName: string) => void;
	onArchive: (path: string) => void;
	onUnarchive: (path: string) => void;
	onDelete: (path: string, displayName: string) => void;
}

function sessionDisplayName(session: SessionSummary): string {
	return session.name || session.firstMessage || "Untitled";
}

export function renderSessions(
	container: HTMLElement,
	sessions: SessionSummary[],
	currentSessionId: string | undefined,
	showArchived: boolean,
	callbacks: SessionCallbacks,
): void {
	container.innerHTML = "";

	const visible = sessions.filter((s) => showArchived ? s.archived : !s.archived);

	if (!visible.length) {
		const empty = document.createElement("p");
		empty.className = "panel-empty";
		empty.textContent = showArchived
			? "No archived sessions."
			: "No sessions found for this project.";
		container.appendChild(empty);
		return;
	}

	const list = document.createElement("ul");
	list.className = "panel-list";

	for (const session of visible) {
		const item = document.createElement("li");
		item.className = `panel-list-item session-row${session.id === currentSessionId ? " selected" : ""}${session.archived ? " archived" : ""}`;
		item.dataset.path = session.path;

		const main = document.createElement("div");
		main.className = "session-row-main";
		main.addEventListener("click", () => callbacks.onSelect(session.path));

		const title = document.createElement("div");
		title.className = "panel-list-title";
		title.textContent = sessionDisplayName(session);

		const meta = document.createElement("div");
		meta.className = "panel-list-meta";
		const archivedLabel = session.archived ? " · archived" : "";
		meta.textContent = `${session.messageCount} messages · ${new Date(session.modified).toLocaleString()}${archivedLabel}`;

		main.append(title, meta);

		const actions = document.createElement("div");
		actions.className = "session-row-actions";

		const renameBtn = document.createElement("button");
		renameBtn.type = "button";
		renameBtn.className = "btn btn-ghost btn-sm session-action-btn";
		renameBtn.title = "Rename";
		renameBtn.textContent = "✎";
		renameBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			callbacks.onRename(session.path, sessionDisplayName(session));
		});

		if (session.archived) {
			const unarchiveBtn = document.createElement("button");
			unarchiveBtn.type = "button";
			unarchiveBtn.className = "btn btn-ghost btn-sm session-action-btn";
			unarchiveBtn.title = "Unarchive";
			unarchiveBtn.textContent = "↩";
			unarchiveBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				callbacks.onUnarchive(session.path);
			});
			actions.append(renameBtn, unarchiveBtn);
		} else {
			const archiveBtn = document.createElement("button");
			archiveBtn.type = "button";
			archiveBtn.className = "btn btn-ghost btn-sm session-action-btn";
			archiveBtn.title = "Archive";
			archiveBtn.textContent = "▤";
			archiveBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				callbacks.onArchive(session.path);
			});

			const deleteBtn = document.createElement("button");
			deleteBtn.type = "button";
			deleteBtn.className = "btn btn-ghost btn-sm session-action-btn session-action-delete";
			deleteBtn.title = "Delete";
			deleteBtn.textContent = "✕";
			deleteBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				callbacks.onDelete(session.path, sessionDisplayName(session));
			});

			actions.append(renameBtn, archiveBtn, deleteBtn);
		}

		item.append(main, actions);
		list.appendChild(item);
	}

	container.appendChild(list);
}
