import { type Session, AgentLoop, type AgentResult } from "./AgentLoop";
import { type Plan } from "./planner";

/**
 * Goli-CLI Coordinator (Phase 4 Skeleton)
 * 
 * In Phase 4, the coordinator runs subagent tasks sequentially to respect 
 * hardware constraints (16GB RAM / 4 Threads). Parallel execution is deferred 
 * to Phase 6.
 */
export class Coordinator {
  constructor(private session: Session) {}

  async run(plan: Plan): Promise<AgentResult> {
    this.session.logger.log({ turn: 0, type: 'start', response: `Starting coordinated execution of plan ${plan.planId}` });

    const agent = new AgentLoop();

    // In Phase 4, we simply delegate to the main loop which is already plan-aware.
    return await agent.run(this.session.sessionId, this.session);
  }

  // Placeholder for Phase 6 parallel logic
  protected async runWithConcurrency<T>(tasks: Array<() => Promise<T>>, _limit: number): Promise<T[]> {
      const results: T[] = [];
      for (const task of tasks) {
          results.push(await task());
      }
      return results;
  }
}
