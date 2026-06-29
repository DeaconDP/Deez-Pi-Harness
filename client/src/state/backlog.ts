import type { BacklogProject } from "../../../shared/backlog.js";

export interface BacklogState {
	projects: BacklogProject[];
	expandedId: string | null;
	dirtyIds: Set<string>;
	selectedNodeId: string | null;
}

export function createBacklogState(): BacklogState {
	return {
		projects: [],
		expandedId: null,
		dirtyIds: new Set(),
		selectedNodeId: null,
	};
}

export function setBacklogProjects(state: BacklogState, projects: BacklogProject[]): void {
	state.projects = [...projects].sort((a, b) => a.order - b.order);
	state.dirtyIds.clear();
}

export function markDirty(state: BacklogState, id: string): void {
	state.dirtyIds.add(id);
}

export function getProject(state: BacklogState, id: string): BacklogProject | undefined {
	return state.projects.find((p) => p.id === id);
}

export function updateLocalProject(state: BacklogState, project: BacklogProject): void {
	const idx = state.projects.findIndex((p) => p.id === project.id);
	if (idx >= 0) state.projects[idx] = project;
	markDirty(state, project.id);
}
