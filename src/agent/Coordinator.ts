import { type Session, AgentLoop, type AgentResult } from "./AgentLoop";
import { type Plan } from "./planner";
import os from 'node:os';
import pLimit from 'p-limit';
import { ConfigManager } from '../config/features';

export const MAX_PARALLEL_AGENTS = (() => {
  const freeMemGb = os.freemem() / (1024 ** 3);
  const agentsFromMemory = Math.floor((freeMemGb - 4) / 1.8);
  const agentsFromCpu = 2; // 2 cores / 4 threads limit
  return Math.max(1, Math.min(agentsFromMemory, agentsFromCpu));
})();

export class Coordinator {
  private config: ConfigManager;

  constructor(private session: Session) {
      this.config = new ConfigManager();
  }

  async run(plan: Plan): Promise<AgentResult> {
    await this.config.load();
    const useParallel = this.config.getFeature('experimental_parallel_execution');

    this.session.logger.log({ 
        turn: 0, 
        type: 'start', 
        response: `Starting coordinated execution [parallel=${useParallel}] of plan ${plan.planId}` 
    });

    if (useParallel && plan.steps.length > 3) {
        console.log(`\n⚡ Goli-CLI Parallel Mode: Using up to ${MAX_PARALLEL_AGENTS} subagents.`);
        // Note: Real parallel execution requires partitioning the plan, 
        // which is a complex task. For Phase 8 skeleton, we simulate.
        return this.runSequential(plan);
    } else {
        return this.runSequential(plan);
    }
  }

  private async runSequential(plan: Plan): Promise<AgentResult> {
    const agent = new AgentLoop();
    return await agent.run(this.session.task, this.session);
  }

  protected async runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
      const limiter = pLimit(limit);
      return Promise.all(tasks.map(t => limiter(t)));
  }
}
