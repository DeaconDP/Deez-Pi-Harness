import type { BacklogProject, ProjectPriority, ProjectStage, ProjectStatus, SchedulePeriod } from "../../../shared/backlog.js";
import { PROJECT_STAGES } from "../../../shared/backlog.js";
import type { BacklogState } from "../state/backlog.js";
import { updateLocalProject, getProject as findProject } from "../state/backlog.js";
import type { ClientCommand } from "../../../shared/protocol.js";

export interface BacklogCallbacks {
	onSend: (cmd: ClientCommand) => void;
}

let dragId: string | null = null;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const AUTO_SAVE_DELAY_MS = 400;

function flushBacklogSave(
	projectId: string,
	state: BacklogState,
	callbacks: BacklogCallbacks,
): void {
	const pending = saveTimers.get(projectId);
	if (pending) {
		clearTimeout(pending);
		saveTimers.delete(projectId);
	}
	const current = findProject(state, projectId);
	if (current) callbacks.onSend({ type: "update_backlog", project: current });
}

function scheduleBacklogSave(
	projectId: string,
	state: BacklogState,
	callbacks: BacklogCallbacks,
): void {
	const pending = saveTimers.get(projectId);
	if (pending) clearTimeout(pending);
	saveTimers.set(
		projectId,
		setTimeout(() => {
			saveTimers.delete(projectId);
			const current = findProject(state, projectId);
			if (current) callbacks.onSend({ type: "update_backlog", project: current });
		}, AUTO_SAVE_DELAY_MS),
	);
}

export function renderBacklog(
	container: HTMLElement,
	state: BacklogState,
	callbacks: BacklogCallbacks,
): void {
	container.innerHTML = "";

	if (!state.projects.length) {
		const empty = document.createElement("div");
		empty.className = "backlog-empty";
		empty.textContent = "No projects yet. Add one to get started.";
		container.appendChild(empty);
		return;
	}

	const table = document.createElement("table");
	table.className = "backlog-table";
	table.innerHTML = `
		<thead><tr>
			<th class="col-drag"></th>
			<th class="col-name">Name</th>
			<th class="col-status">Stat</th>
			<th class="col-priority">Pri</th>
			<th class="col-stage">Stage</th>
			<th class="col-schedule">Sched</th>
			<th class="col-workspace">Workspace</th>
			<th class="col-actions">Actions</th>
		</tr></thead>`;

	const tbody = document.createElement("tbody");

	for (const project of state.projects) {
		tbody.appendChild(renderRow(project, state, callbacks));
		if (state.expandedId === project.id) {
			tbody.appendChild(renderInstructionRow(project, state, callbacks));
		}
	}

	table.appendChild(tbody);
	container.appendChild(table);
}

function renderRow(
	project: BacklogProject,
	state: BacklogState,
	callbacks: BacklogCallbacks,
): HTMLTableRowElement {
	const tr = document.createElement("tr");
	tr.className = "backlog-row";
	tr.dataset.id = project.id;

	const tdDrag = document.createElement("td");
	tdDrag.className = "col-drag";
	const handle = document.createElement("span");
	handle.className = "backlog-drag-handle";
	handle.textContent = "⠿";
	handle.draggable = true;
	handle.addEventListener("dragstart", (e) => {
		dragId = project.id;
		tr.classList.add("dragging");
		e.dataTransfer!.effectAllowed = "move";
	});
	handle.addEventListener("dragend", () => {
		dragId = null;
		tr.classList.remove("dragging");
	});
	tdDrag.appendChild(handle);

	tr.addEventListener("dragover", (e) => {
		e.preventDefault();
		if (dragId && dragId !== project.id) tr.classList.add("drag-over");
	});
	tr.addEventListener("dragleave", () => tr.classList.remove("drag-over"));
	tr.addEventListener("drop", (e) => {
		e.preventDefault();
		tr.classList.remove("drag-over");
		if (!dragId || dragId === project.id) return;
		const ids = state.projects.map((p) => p.id);
		const from = ids.indexOf(dragId);
		const to = ids.indexOf(project.id);
		if (from < 0 || to < 0) return;
		ids.splice(from, 1);
		ids.splice(to, 0, dragId);
		callbacks.onSend({ type: "reorder_backlog", projectIds: ids });
	});

	tr.append(
		tdDrag,
		cellName(project, state, callbacks),
		cellSelect("status", project, ["busy", "idle"] as ProjectStatus[], state, callbacks),
		cellSelect("priority", project, ["crit", "hi", "med", "low"] as ProjectPriority[], state, callbacks),
		cellStage(project, state, callbacks),
		cellSchedule(project, state, callbacks),
		cellInput("workspaceFolder", project, state, callbacks),
		cellActions(project, state, callbacks),
	);

	return tr;
}

function cellName(project: BacklogProject, state: BacklogState, callbacks: BacklogCallbacks): HTMLTableCellElement {
	const td = document.createElement("td");
	td.className = "col-name";
	const input = document.createElement("input");
	input.type = "text";
	input.value = project.name;
	input.addEventListener("change", () => applyPatch(project, state, callbacks, { name: input.value }));
	td.appendChild(input);
	return td;
}

function cellInput(
	field: "workspaceFolder",
	project: BacklogProject,
	state: BacklogState,
	callbacks: BacklogCallbacks,
): HTMLTableCellElement {
	const td = document.createElement("td");
	td.className = "col-workspace";
	const input = document.createElement("input");
	input.type = "text";
	input.value = project.workspaceFolder;
	input.placeholder = "~/project";
	input.title = project.workspaceFolder;
	input.addEventListener("change", () => applyPatch(project, state, callbacks, { workspaceFolder: input.value }));
	td.appendChild(input);
	return td;
}

function cellSelect<T extends string>(
	field: "status" | "priority",
	project: BacklogProject,
	options: T[],
	state: BacklogState,
	callbacks: BacklogCallbacks,
): HTMLTableCellElement {
	const td = document.createElement("td");
	const select = document.createElement("select");
	if (field === "priority") select.className = `priority-${project.priority}`;
	for (const opt of options) {
		const o = document.createElement("option");
		o.value = opt;
		o.textContent = field === "status" ? (opt === "busy" ? "Busy" : "Idle") : opt.toUpperCase();
		o.selected = project[field] === opt;
		select.appendChild(o);
	}
	select.addEventListener("change", () => {
		if (field === "priority") select.className = `priority-${select.value}`;
		applyPatch(project, state, callbacks, { [field]: select.value } as Partial<BacklogProject>);
	});
	td.appendChild(select);
	return td;
}

function cellStage(project: BacklogProject, state: BacklogState, callbacks: BacklogCallbacks): HTMLTableCellElement {
	const td = document.createElement("td");
	td.className = "col-stage";
	const wrap = document.createElement("div");
	wrap.style.display = "flex";
	wrap.style.gap = "2px";
	wrap.style.alignItems = "center";

	const select = document.createElement("select");
	for (const stage of PROJECT_STAGES) {
		const o = document.createElement("option");
		o.value = stage;
		o.textContent = stage.slice(0, 4);
		o.title = stage;
		o.selected = project.stage === stage;
		select.appendChild(o);
	}
	select.addEventListener("change", () =>
		applyPatch(project, state, callbacks, { stage: select.value as ProjectStage }),
	);

	const expand = document.createElement("button");
	expand.type = "button";
	expand.className = "backlog-expand-btn";
	expand.textContent = state.expandedId === project.id ? "▼" : "▶";
	expand.title = "Edit stage instruction";
	expand.addEventListener("click", () => {
		state.expandedId = state.expandedId === project.id ? null : project.id;
		renderBacklog(
			document.getElementById("backlog-table-wrap")!,
			state,
			callbacks,
		);
	});

	wrap.append(select, expand);
	td.appendChild(wrap);
	return td;
}

function cellSchedule(project: BacklogProject, state: BacklogState, callbacks: BacklogCallbacks): HTMLTableCellElement {
	const td = document.createElement("td");
	td.className = "col-schedule";
	const wrap = document.createElement("div");
	wrap.className = "backlog-schedule";

	const count = document.createElement("input");
	count.type = "number";
	count.min = "1";
	count.max = "99";
	count.value = String(project.schedule.count);
	count.addEventListener("change", () =>
		applyPatch(project, state, callbacks, {
			schedule: { ...project.schedule, count: Math.max(1, Number(count.value) || 1) },
		}),
	);

	const period = document.createElement("select");
	for (const p of ["day", "week", "month"] as SchedulePeriod[]) {
		const o = document.createElement("option");
		o.value = p;
		o.textContent = `/${p.slice(0, 1)}`;
		o.title = `per ${p}`;
		o.selected = project.schedule.period === p;
		period.appendChild(o);
	}
	period.addEventListener("change", () =>
		applyPatch(project, state, callbacks, {
			schedule: { ...project.schedule, period: period.value as SchedulePeriod },
		}),
	);

	wrap.append(count, period);
	td.appendChild(wrap);
	return td;
}

function cellActions(project: BacklogProject, state: BacklogState, callbacks: BacklogCallbacks): HTMLTableCellElement {
	const td = document.createElement("td");
	td.className = "col-actions";
	const wrap = document.createElement("div");
	wrap.className = "backlog-actions";

	const btnPush = document.createElement("button");
	btnPush.type = "button";
	btnPush.className = "btn btn-ghost btn-sm btn-pressable";
	btnPush.textContent = "Push";
	btnPush.title = "Push to selected node";
	btnPush.disabled = !state.selectedNodeId;
	btnPush.addEventListener("click", () => {
		flushBacklogSave(project.id, state, callbacks);
		if (!state.selectedNodeId) return;
		callbacks.onSend({
			type: "push_backlog_to_peer",
			projectId: project.id,
			nodeId: state.selectedNodeId,
		});
	});

	const btnRun = document.createElement("button");
	btnRun.type = "button";
	btnRun.className = "btn btn-primary btn-sm btn-pressable";
	btnRun.textContent = "Run";
	btnRun.title = "Run stage instruction now";
	btnRun.addEventListener("click", () => {
		flushBacklogSave(project.id, state, callbacks);
		callbacks.onSend({
			type: "run_backlog_project",
			projectId: project.id,
			nodeId: state.selectedNodeId ?? undefined,
		});
	});

	const btnDel = document.createElement("button");
	btnDel.type = "button";
	btnDel.className = "btn btn-ghost btn-sm";
	btnDel.textContent = "✕";
	btnDel.title = "Delete project";
	btnDel.addEventListener("click", () => {
		callbacks.onSend({ type: "delete_backlog_project", projectId: project.id });
	});

	wrap.append(btnPush, btnRun, btnDel);
	td.appendChild(wrap);
	return td;
}

function renderInstructionRow(
	project: BacklogProject,
	state: BacklogState,
	callbacks: BacklogCallbacks,
): HTMLTableRowElement {
	const tr = document.createElement("tr");
	tr.className = "backlog-instruction-row";
	const td = document.createElement("td");
	td.colSpan = 8;
	const label = document.createElement("div");
	label.style.fontSize = "10px";
	label.style.color = "var(--text-faint)";
	label.style.marginBottom = "4px";
	label.textContent = `Instruction for ${project.stage}:`;
	const ta = document.createElement("textarea");
	ta.value = project.stageInstructions[project.stage];
	ta.addEventListener("change", () => {
		const stageInstructions = { ...project.stageInstructions, [project.stage]: ta.value };
		applyPatch(project, state, callbacks, { stageInstructions });
	});
	td.append(label, ta);
	tr.appendChild(td);
	return tr;
}

function applyPatch(
	project: BacklogProject,
	state: BacklogState,
	callbacks: BacklogCallbacks,
	changes: Partial<BacklogProject>,
): void {
	const next = { ...project, ...changes };
	updateLocalProject(state, next);
	scheduleBacklogSave(project.id, state, callbacks);
}
