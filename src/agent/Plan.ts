// src/agent/Plan.ts

export interface PlanStep {
	id: string;
	description: string;
	files: string[];
	rationale: string;
	dependsOn: string[];
}

export interface Plan {
	taskSummary: string;
	steps: PlanStep[];
}

/**
 * Groups steps into parallel buckets based on file overlap and dependencies.
 */
export function buildParallelBuckets(steps: PlanStep[]): PlanStep[][] {
	if (steps.length === 0) return [];

	const fileToSteps = new Map<string, PlanStep[]>();
	for (const step of steps) {
		for (const file of step.files) {
			if (!fileToSteps.has(file)) fileToSteps.set(file, []);
			fileToSteps.get(file)?.push(step);
		}
	}

	const parent = new Map(steps.map((s) => [s.id, s.id]));

	function find(id: string): string {
		let current = id;
		while (parent.get(current) !== current) {
			const p = parent.get(current)!;
			parent.set(current, parent.get(p) ?? p);
			current = p;
		}
		return current;
	}

	function union(a: string, b: string): void {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) {
			parent.set(rootA, rootB);
		}
	}

	for (const overlapping of fileToSteps.values()) {
		if (overlapping.length > 1) {
			const rootId = overlapping[0]!.id;
			for (let i = 1; i < overlapping.length; i++) {
				union(rootId, overlapping[i]!.id);
			}
		}
	}

	for (const step of steps) {
		for (const depId of step.dependsOn) {
			const depStep = steps.find((s) => s.id === depId);
			if (depStep) {
				union(step.id, depId);
			}
		}
	}

	const groups = new Map<string, PlanStep[]>();
	for (const step of steps) {
		const root = find(step.id);
		if (!groups.has(root)) groups.set(root, []);
		groups.get(root)?.push(step);
	}

	return [...groups.values()];
}
