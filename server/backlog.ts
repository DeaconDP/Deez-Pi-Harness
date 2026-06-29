import * as fs from "node:fs";
import * as path from "node:path";
import {
	createDefaultProject,
	type BacklogProject,
} from "../shared/backlog.js";
import { getConfigDir } from "./config.js";

const BACKLOG_PATH = () => path.join(getConfigDir(), "backlog.json");

export class BacklogStore {
	private projects: BacklogProject[] = [];

	constructor() {
		this.load();
	}

	load(): BacklogProject[] {
		try {
			const p = BACKLOG_PATH();
			if (fs.existsSync(p)) {
				const data = JSON.parse(fs.readFileSync(p, "utf8")) as { projects?: BacklogProject[] };
				this.projects = (data.projects ?? []).sort((a, b) => a.order - b.order);
				return this.projects;
			}
		} catch {
			/* empty */
		}
		this.projects = [];
		return this.projects;
	}

	getAll(): BacklogProject[] {
		return [...this.projects];
	}

	getById(id: string): BacklogProject | undefined {
		return this.projects.find((p) => p.id === id);
	}

	private save(): void {
		fs.mkdirSync(getConfigDir(), { recursive: true });
		const tmp = `${BACKLOG_PATH()}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify({ projects: this.projects }, null, 2));
		fs.renameSync(tmp, BACKLOG_PATH());
	}

	upsert(project: BacklogProject): BacklogProject {
		const idx = this.projects.findIndex((p) => p.id === project.id);
		const next = { ...project, updatedAt: new Date().toISOString() };
		if (idx >= 0) {
			this.projects[idx] = next;
		} else {
			this.projects.push(next);
		}
		this.projects.sort((a, b) => a.order - b.order);
		this.save();
		return next;
	}

	add(): BacklogProject {
		const order = this.projects.length ? Math.max(...this.projects.map((p) => p.order)) + 1 : 0;
		const project = createDefaultProject(order);
		this.projects.push(project);
		this.save();
		return project;
	}

	remove(id: string): boolean {
		const before = this.projects.length;
		this.projects = this.projects.filter((p) => p.id !== id);
		if (this.projects.length === before) return false;
		this.save();
		return true;
	}

	reorder(projectIds: string[]): BacklogProject[] {
		const map = new Map(this.projects.map((p) => [p.id, p]));
		const reordered: BacklogProject[] = [];
		projectIds.forEach((id, i) => {
			const p = map.get(id);
			if (p) reordered.push({ ...p, order: i, updatedAt: new Date().toISOString() });
		});
		for (const p of this.projects) {
			if (!projectIds.includes(p.id)) {
				reordered.push({ ...p, order: reordered.length });
			}
		}
		this.projects = reordered;
		this.save();
		return this.getAll();
	}

	markIdle(projectId: string): BacklogProject | undefined {
		const p = this.getById(projectId);
		if (!p) return undefined;
		return this.upsert({ ...p, status: "idle" });
	}

	markBusy(projectId: string): BacklogProject | undefined {
		const p = this.getById(projectId);
		if (!p) return undefined;
		return this.upsert({ ...p, status: "busy" });
	}

	mergeRemote(project: BacklogProject): BacklogProject {
		const existing = this.getById(project.id);
		if (!existing) return this.upsert(project);
		if (new Date(project.updatedAt) >= new Date(existing.updatedAt)) {
			return this.upsert(project);
		}
		return existing;
	}
}
