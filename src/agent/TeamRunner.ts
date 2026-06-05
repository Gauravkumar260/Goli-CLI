// src/agent/TeamRunner.ts
import os from "node:os";
import pLimit from "p-limit";
import type { AgentResult, AgentSession as Session } from "../config/types.js";
import { AgentLoop } from "./AgentLoop.js";
import { DEFAULT_CONFIG } from "./AgentLoop.js";
import type { Plan, PlanStep } from "./Plan.js";
import { ROLE_CONFIGS } from "./AgentRole.js";
import { createProvider } from "../providers/router.js";
import { DockerSandbox } from "../sandbox/DockerSandbox.js";

export const MAX_PARALLEL_AGENTS = (() => {
        const freeGb = os.freemem() / 1024 ** 3;
        // 1.6GB per agent headroom as specified in strategy
        return Math.max(1, Math.floor(freeGb / 1.6));
})();

export function hasHeadroom(requiredMb = 1600): boolean {
        const freeMb = os.freemem() / 1024 ** 2;
        return freeMb > requiredMb;
}

export class TeamRunner {
        constructor(private session: Session) {}

        async runPlan(plan: Plan): Promise<AgentResult[]> {
        // Simple implementation: run steps sequentially for now or use buildParallelBuckets if needed
        const buckets = [plan.steps]; 
                const limiter = pLimit(MAX_PARALLEL_AGENTS);
                const allResults: AgentResult[] = [];

        for (const bucket of buckets) {
            console.log(`\nðŸš€ [TeamRunner] Launching parallel bucket with ${bucket.length} agents...`);
            const tasks = bucket.map((step) => 
                limiter(async () => {
                    if (!hasHeadroom()) {
                        console.warn(`[TeamRunner] Low headroom for step ${step.id}. Waiting...`);
                    }
                    return this.runStep(step);
                })
            );
            const bucketResults = await Promise.all(tasks);
            allResults.push(...bucketResults);
        }

                return allResults;
        }

        private async runStep(step: PlanStep): Promise<AgentResult> {
                const agent = new AgentLoop(DEFAULT_CONFIG);
                
        const implConfig = ROLE_CONFIGS.implementer!;
        const subSession = this.makeSubSession(`step-${step.id}`, implConfig);

        const sandbox = new DockerSandbox(this.session.repoRoot, `goli-step-${this.session.sessionId}-${step.id}`);
        await sandbox.init();
        subSession.tools = (subSession.tools as any).cloneWithSandbox(sandbox);

        const taskPrompt = [
            `Execute Plan Step ${step.id}: ${step.description}`,
            `Rationale: ${step.rationale}`,
            step.files.length > 0 ? `Files in scope: ${step.files.join(', ')}` : '',
            `Strictly follow the implementation role guidelines.`
        ].filter(Boolean).join('\n');

        const result = await agent.run(taskPrompt, subSession);
        await sandbox.destroy();
        return result;
        }

    private makeSubSession(suffix: string, config: any): Session {
        return {
            ...this.session,
            sessionId: `${this.session.sessionId}-${suffix}`,
            model: config.modelSpec,
            model_provider: createProvider(config.modelSpec),
            turns: 0,
            costUsd: 0,
        };
    }
}
