// src/agent/Coordinator.ts
import pLimit from "p-limit";
import type { AgentResult, AgentSession as Session } from "../config/types.js";
import { createProvider } from "../providers/router.js";
import { DockerSandbox } from "../sandbox/DockerSandbox.js";
import { AgentLoop } from "./AgentLoop.js";
import { ROLE_CONFIGS } from "./AgentRole.js";
import type { PlanStep } from "./Plan.js";
import { buildParallelBuckets } from "./Plan.js";
import { createPlan } from "./Planner.js";
import { MAX_PARALLEL_AGENTS } from "./TeamRunner.js";

export interface CoordinatorResult {
	finalAnswer: string;
	subResults: AgentResult[];
	totalCostUsd: number;
	totalTurns: number;
}

/**
 * Coordinated execution using specialized sub-agents.
 */
export async function coordinatedRun(
	task: string,
	session: Session,
): Promise<CoordinatorResult> {
	const allResults: AgentResult[] = [];
	let totalCost = 0;
	const agentLoop = new AgentLoop();

	console.log(`\n🔍 [Coordinator] Starting Scout Phase...`);
	const scoutConfig = ROLE_CONFIGS.scout;
	const scoutSession = makeSubSession(session, "scout", scoutConfig);
	const scoutResult = await agentLoop.run(
		`Explore the codebase and describe: (1) relevant files for "${task}", (2) key patterns, (3) dependencies`,
		scoutSession,
	);
	allResults.push(scoutResult);
	totalCost += scoutResult.costUsd || 0;

	console.log(`\n📝 [Coordinator] Starting Plan Phase...`);
	const plannerConfig = ROLE_CONFIGS.planner;
	const plannerProvider = createProvider(plannerConfig.modelSpec);
	const plan = await createPlan(task, plannerProvider, scoutResult.answer);

	const planBuckets = buildParallelBuckets(plan.steps ?? []);
	console.log(
		`\n🏗️ [Coordinator] Plan created with ${planBuckets.length} parallel buckets.`,
	);

	const limit = pLimit(MAX_PARALLEL_AGENTS);
	const implTasks = planBuckets.map((bucket: PlanStep[], idx: number) =>
		limit(async () => {
			console.log(
				`\n🚀 [Coordinator] Launching Implementer for Bucket ${idx + 1}...`,
			);
			const implConfig = ROLE_CONFIGS.implementer;
			const implSession = makeSubSession(session, `impl-${idx}`, implConfig);

			const sandbox = new DockerSandbox(
				session.repoRoot,
				`goli-sub-${session.sessionId}-${idx}`,
			);
			await sandbox.init();
			implSession.tools = implSession.tools.cloneWithSandbox(sandbox);

			const bucketTask = [
				`Your bucket: implement these steps only:`,
				...bucket.map((s: PlanStep, i: number) => `${i + 1}. ${s.description}`),
				bucket.some((s: PlanStep) => s.files.length > 0)
					? `\nFiles in your scope: ${[...new Set(bucket.flatMap((s: PlanStep) => s.files))].join(", ")}`
					: "",
			]
				.filter(Boolean)
				.join("\n");

			const result = await agentLoop.run(bucketTask, implSession);
			await sandbox.destroy();
			return result;
		}),
	);

	const implResults = (await Promise.all(implTasks)).filter(
		(r): r is AgentResult => r !== null,
	);
	allResults.push(...implResults);
	totalCost += implResults.reduce(
		(sum: number, r: AgentResult) => sum + r.costUsd || 0,
		0,
	);

	console.log(`\n🧠 [Coordinator] Starting Synthesis Phase...`);
	const orchConfig = ROLE_CONFIGS.orchestrator;
	const orchSession = makeSubSession(session, "orchestrator", orchConfig);
	const orchResult = await agentLoop.run(
		[
			`Original task: ${task}`,
			`Sub-agent results:`,
			...implResults.map(
				(r: AgentResult, i: number) =>
					`[Agent ${i + 1}] Status: ${r.status} — ${r.answer?.slice(0, 200) ?? "no answer"}`,
			),
			`Synthesize the results into a final summary for the user.`,
		].join("\n"),
		orchSession,
	);
	allResults.push(orchResult);
	totalCost += orchResult.costUsd || 0;

	return {
		finalAnswer:
			orchResult.answer ??
			implResults
				.map((r: AgentResult) => r.answer)
				.filter(Boolean)
				.join("\n\n"),
		subResults: allResults,
		totalCostUsd: totalCost,
		totalTurns: allResults.reduce(
			(sum: number, r: AgentResult) => sum + r.turns,
			0,
		),
	};
}

function makeSubSession(
	parent: Session,
	roleSuffix: string,
	roleConfig: { modelSpec: string; maxTurns: number },
): Session {
	return {
		...parent,
		sessionId: `${parent.sessionId}-${roleSuffix}`,
		model: roleConfig.modelSpec,
		model_provider: createProvider(roleConfig.modelSpec),
		turns: 0,
		costUsd: 0,
	};
}
