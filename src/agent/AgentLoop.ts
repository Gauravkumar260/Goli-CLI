import { ModelProvider, Message } from "../providers/ModelProvider";
import { ToolRegistry, ToolCall, ToolResult } from "../tools/ToolRegistry";
import { DiffManager } from "../diff/DiffManager";
import { AgentContext } from "./AgentContext";
import { compactContext } from "./compaction";
import { buildSystemPrompt } from "./systemPrompt";
import { SessionLogger, TurnEvent } from "../telemetry/SessionLogger";
import { logTurn, logAction, logSuccess, logFailure } from "../cli/renderer";
import { needsPlan, makePlan, Plan } from "./planner";
import { requestHumanApproval } from "./hitl";
import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline/promises";

export interface AgentConfig {
  maxTurns: number;
  errorThreshold: number;
  safetyDenialLimit: number;
  sessionCostCapUsd: number;
  compactionAt: number;
  sessionTimeoutMs: number;
  forcePlan?: boolean;
  autoApprove?: boolean;
}

export const DEFAULT_CONFIG: AgentConfig = {
  maxTurns: 30,
  errorThreshold: 3,
  safetyDenialLimit: 5,
  sessionCostCapUsd: 0.50,
  compactionAt: 0.80,
  sessionTimeoutMs: 600_000,
};

export interface AgentResult {
  success: boolean;
  message: string;
  context: AgentContext;
}

export interface Session {
  sessionId: string;
  model: ModelProvider;
  compactModel: ModelProvider;
  tools: ToolRegistry;
  diffManager: DiffManager;
  logger: SessionLogger;
  costUsd: number;
}

export class AgentLoop {
  private config: AgentConfig;

  constructor(config: AgentConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  async run(task: string, session: Session): Promise<AgentResult> {
    const deadline = Date.now() + this.config.sessionTimeoutMs;
    let turns = 0;
    let consecutiveErrors = 0;
    let totalSafetyDenials = 0;

    // ─── Week 13: Long-term Memory ─────────────────────────────────────────────
    const recentSessions = SessionLogger.getRecentSessions(3);
    let priorWorkSummary = "";
    if (recentSessions.length > 0) {
        priorWorkSummary = "\n## Prior work on this repo\n" + 
            recentSessions.map(s => `- Session ${s.session_id} (active ${s.last_active})`).join("\n");
        console.log(`\n🧠 Memory: Loaded ${recentSessions.length} recent sessions.`);
    }

    // ─── Phase 4.11: Planning ──────────────────────────────────────────────────
    let plan: Plan | null = null;
    const projectRoot = session.diffManager.getProjectRoot();
    const apexMd = await this.readApexMd(projectRoot);

    if (this.config.forcePlan || needsPlan(task)) {
      console.log("\n📋 Generating execution plan...");
      const files = await fs.readdir(projectRoot);
      const repoMap = files.filter(f => !f.startsWith('.')).join("\n");
      
      plan = await makePlan(task, repoMap, session.compactModel);
      this.displayPlan(plan);

      if (!this.config.autoApprove) {
        const approved = await this.askForConfirmation("Proceed with this plan? [y/N] ");
        if (!approved) {
          return this.fail("plan_rejected", new AgentContext(), session, turns);
        }
      }
    }

    // Build initial context
    const systemPrompt = buildSystemPrompt(apexMd, session.tools.getToolDefinitions()) + priorWorkSummary;
    let context = new AgentContext();
    context.systemPrompt = systemPrompt;
    context.messages.push({ role: 'system', content: systemPrompt });
    
    if (plan) {
      context.messages.push({ 
        role: 'user', 
        content: `Execution Plan:\n${JSON.stringify(plan, null, 2)}\n\nPlease execute the task following this plan. State which step you are on.` 
      });
    }
    
    context.messages.push({ role: 'user', content: task });
    session.logger.log({ turn: turns, type: 'start', costUsd: 0 });

    // ─── Main Loop ────────────────────────────────────────────────────────────
    while (turns < this.config.maxTurns) {
      logTurn(turns, this.config.maxTurns);

      if (Date.now() > deadline) {
        return this.fail("session_timeout", context, session, turns);
      }

      if (session.costUsd >= this.config.sessionCostCapUsd) {
        return this.fail("cost_cap_reached", context, session, turns);
      }

      const response = await session.model.complete(context.messages, context.systemPrompt);
      const cost = (response.length / 4) * (0.000015);
      session.costUsd += cost;
      session.logger.log({ turn: turns, type: 'model_response', costUsd: cost, response, model: 'sonnet' });

      process.stdout.write(`\x1b[90m${response.substring(0, 500)}${response.length > 500 ? '...' : ''}\x1b[0m\n`);

      if (response.includes("DONE")) {
        logSuccess("Task complete.");
        session.logger.log({ turn: turns, type: 'stop', response: "DONE" });
        return { success: true, message: response, context };
      }

      const toolCalls = this.parseToolCalls(response);
      if (toolCalls.length === 0) {
        context.messages.push({ role: 'assistant', content: response });
        context.messages.push({ role: 'user', content: "Please use a tool to proceed or respond with DONE if finished." });
        turns++;
        continue;
      }

      for (const toolCall of toolCalls) {
        logAction(toolCall.name, toolCall.input);

        // HITL (Human-in-the-Loop)
        if (!this.config.autoApprove && session.tools.isHighRisk(toolCall.name)) {
          const approval = await requestHumanApproval(toolCall, session);
          session.logger.log({ turn: turns, type: 'hitl', toolName: toolCall.name, hitlDecision: approval.granted ? 'approved' : 'rejected', latencyMs: approval.latencyMs });
          
          if (!approval.granted) {
            logFailure(`Action rejected by user: ${toolCall.name}`);
            return this.fail("human_denied", context, session, turns);
          }
          if (approval.modified) {
            toolCall.input = approval.modified;
            logAction(`${toolCall.name} (modified)`, toolCall.input);
          }
        }

        const result = await session.tools.dispatch(toolCall);
        session.logger.log({ 
            turn: turns, 
            type: 'tool_call', 
            toolName: toolCall.name, 
            toolInput: toolCall.input, 
            toolSuccess: result.success,
            latencyMs: 0 // Placeholder
        });

        if (result.isError) {
          logFailure(`${toolCall.name} failed: ${result.error}`);
          consecutiveErrors++;
          if (consecutiveErrors >= this.config.errorThreshold) {
            return this.fail("error_threshold", context, session, turns);
          }
        } else {
          logSuccess(`${toolCall.name} succeeded.`);
          consecutiveErrors = 0;
        }

        context.appendToolResult(toolCall, result);
      }

      // Checkpoints
      if (plan && plan.checkpointAfter.includes(turns + 1)) {
        console.log("\n🏁 Checkpoint reached.");
        if (!this.config.autoApprove) {
            const cont = await this.askForConfirmation("Continue to next turn? [Y/n] ", true);
            if (!cont) return this.fail("human_aborted", context, session, turns);
        }
      }

      context.updateTokenCount();
      if (context.tokenCount > context.windowSize * this.config.compactionAt) {
        context = await compactContext(context, session.compactModel);
        session.logger.log({ turn: turns, type: 'compaction' });
      }

      turns++;
    }

    return this.fail("max_turns_exceeded", context, session, turns);
  }

  private async readApexMd(root: string): Promise<string> {
    try {
      return await fs.readFile(path.join(root, "APEX.md"), "utf-8");
    } catch {
      return "";
    }
  }

  private parseToolCalls(response: string): ToolCall[] {
    try {
      const jsonMatch = response.match(/\[\s*\{[\s\S]*\}\s*\]|\{\s*\"name\"[\s\S]*\}/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]);

      const normalize = (p: any): ToolCall => ({
        name: p.name || p.tool,
        input: p.input || p.parameters || p.arguments || {}
      });

      if (Array.isArray(parsed)) {
        return parsed.map(normalize);
      }
      return [normalize(parsed)];
    } catch {
      return [];
    }
  }

  private displayPlan(plan: Plan) {
    console.log(`\n┌─ Execution Plan (${plan.complexity}) ─┐`);
    plan.steps.forEach(s => {
      console.log(`│ ${s.id}. ${s.tool.padEnd(15)} │ ${s.rationale}`);
    });
    console.log(`└─────────────────────────── turns: ~${plan.estimatedTurns} ┘\n`);
  }

  private async askForConfirmation(query: string, defaultYes: boolean = false): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(query);
    rl.close();
    const normalized = answer.trim().toLowerCase();
    if (normalized === "") return defaultYes;
    return normalized === 'y' || normalized === 'yes';
  }

  private fail(reason: string, context: AgentContext, session: Session, turns: number): AgentResult {
    logFailure(`Task failed: ${reason}`);
    session.logger.log({ turn: turns, type: 'failure', response: reason });
    return { success: false, message: `Task failed: ${reason}`, context };
  }
}
