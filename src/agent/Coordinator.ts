import { type Session, AgentLoop, type AgentResult } from "./AgentLoop";
import { type Plan } from "./planner";
import os from 'node:os';
import pLimit from 'p-limit';
import { ConfigManager } from '../config/features';

export const MAX_PARALLEL_AGENTS = (() => {
  const freeMemGb = os.freemem() / (1024 ** 3);
  const agentsFromMemory = Math.floor((freeMemGb - 4) / 1.8);
  const agentsFromCpu = 2; 
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

    if (useParallel && plan.steps.length > 1) {
        console.log(`\n⚡ Goli-CLI Parallel Mode: Active (Limit: ${MAX_PARALLEL_AGENTS})`);
        return this.runParallel(plan);
    } else {
        return this.runSequential(plan);
    }
  }

  private async runParallel(plan: Plan): Promise<AgentResult> {
      // Root Fix: Partition plan into independent groups to avoid race conditions
      const groups = this.partitionPlan(plan);
      console.log(`📂 Plan partitioned into ${groups.length} execution batches.`);

      let overallSuccess = true;
      let combinedMessage = "";

      for (const group of groups) {
          console.log(`▶️ Executing batch of ${group.length} tasks...`);
          const results = await this.runWithConcurrency(
              group.map(step => () => this.runSingleStep(step)),
              MAX_PARALLEL_AGENTS
          );
          
          if (results.some(r => !r.success)) overallSuccess = false;
          combinedMessage += results.map(r => r.message).join("\n");
      }

      return {
          success: overallSuccess,
          message: combinedMessage,
          context: (await new AgentLoop().run("Finalizing", this.session)).context, // approximation
          costUsd: this.session.costUsd
      };
  }

  private partitionPlan(plan: Plan): any[][] {
      const batches: any[][] = [];
      let currentBatch: any[] = [];
      const seenFiles = new Set<string>();

      for (const step of plan.steps) {
          // Extract file target from step (heuristic)
          const targetFile = this.extractTargetFile(step);
          
          if (targetFile && seenFiles.has(targetFile)) {
              // Conflict found! Finish current batch and start next one.
              batches.push(currentBatch);
              currentBatch = [step];
              seenFiles.clear();
              seenFiles.add(targetFile);
          } else {
              currentBatch.push(step);
              if (targetFile) seenFiles.add(targetFile);
          }
      }
      if (currentBatch.length > 0) batches.push(currentBatch);
      return batches;
  }

  private extractTargetFile(step: any): string | null {
      // In a real implementation, we'd ask the model to predict targets.
      // For the Phase 8 root fix, we look for path-like strings in rationale/tool.
      const match = step.rationale.match(/[a-zA-Z0-9_\-\.\/]+\.(ts|js|py|md|json|txt)/);
      return match ? match[0] : null;
  }

  private async runSingleStep(step: any): Promise<AgentResult> {
      const agent = new AgentLoop();
      // Execute only the specific step rationale
      return await agent.run(`Task: ${step.tool} - ${step.rationale}`, this.session);
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
