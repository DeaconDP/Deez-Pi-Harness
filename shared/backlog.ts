/** Backlog project types shared between client and server. */

export type ProjectStatus = "busy" | "idle";
export type ProjectPriority = "crit" | "hi" | "med" | "low";
export type ProjectStage = "planning" | "designing" | "developing" | "testing" | "maintaining";
export type SchedulePeriod = "day" | "week" | "month";
export type AgentRole = string;

export interface BacklogProject {
	id: string;
	order: number;
	name: string;
	status: ProjectStatus;
	priority: ProjectPriority;
	stage: ProjectStage;
	stageInstructions: Record<ProjectStage, string>;
	schedule: { count: number; period: SchedulePeriod };
	workspaceFolder: string;
	updatedAt: string;
}

export const PROJECT_STAGES: ProjectStage[] = [
	"planning",
	"designing",
	"developing",
	"testing",
	"maintaining",
];

export const DEFAULT_STAGE_INSTRUCTIONS: Record<ProjectStage, string> = {
	planning:
		"Review the project workspace and produce a concise plan: goals, risks, and next steps. Update any planning docs if they exist.",
	designing:
		"Review requirements and refine the design: architecture, interfaces, and UX. Document decisions in the workspace.",
	developing:
		"Implement the next highest-priority development task. Run tests and keep changes focused.",
	testing:
		"Run relevant tests, fix failures, and add coverage for recent changes. Report what passed and what remains.",
	maintaining:
		"Perform maintenance: dependency updates, small fixes, cleanup, and documentation refresh.",
};

export function createDefaultProject(order: number): BacklogProject {
	const now = new Date().toISOString();
	return {
		id: crypto.randomUUID(),
		order,
		name: "New project",
		status: "idle",
		priority: "med",
		stage: "planning",
		stageInstructions: { ...DEFAULT_STAGE_INSTRUCTIONS },
		schedule: { count: 1, period: "day" },
		workspaceFolder: "",
		updatedAt: now,
	};
}
