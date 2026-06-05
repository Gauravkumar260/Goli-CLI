import { logAction, logMessage, logTurn } from "../cli/renderer.js";
import {
	type AgentConfig,
	type AgentResult,
	DEFAULT_CONFIG,
	type AgentSession as Session,
	type StopReason,
	type ToolCall,
} from "../config/types.js";
import type { Message } from "../providers/ModelProvider.js";
import { ActionGate } from "../safety/ActionGate.js";
import { BlastRadiusTracker } from "../safety/BlastRadiusTracker.js";
import { InjectionProbe } from "../safety/InjectionProbe.js";
import { buildInitialContext, type InitialContext } from "./AgentContext.js";
import { compactContext, estimateTokens, shouldCompact } from "./Compaction.js";
import { DoomLoopDetector } from "./DoomLoopDetector.js";
import { requestHumanApproval } from "./HITLManager.js";

export type { AgentConfig, AgentResult, Session, StopReason, ToolCall };
export { DEFAULT_CONFIG };

function finish(
	status: AgentResult["status"],
	reason: StopReason,
	turns: number,
	costUsd: number,
	startTime: number,
	session: Session,
	answer?: string,
	messages: Message[] = [],
	ctx?: InitialContext,
): AgentResult {
	const result: AgentResult = {
		status,
		reason,
		turns,
		costUsd,
		durationMs: Date.now() - startTime,
		...(answer ? { answer } : {}),
		context: ctx
			? { ...ctx, messages }
			: {
					messages,
					systemPrompt: "",
					userMessage: "",
					retrievedChunks: [],
					goliCLIMd: "",
					estimatedTokens: 0,
				},
	};
	session.logger.log({ event: "session_end", ...result });
	return result;
}

export class AgentLoop {
	private config: AgentConfig;

	constructor(config: AgentConfig = DEFAULT_CONFIG) {
		this.config = config;
	}

	async run(task: string, session: Session): Promise<AgentResult> {
		const startTime = Date.now();
		const deadline = startTime + this.config.sessionTimeoutMs;
		const doomDetect = new DoomLoopDetector();
		const blastRadius = new BlastRadiusTracker();
		const gate = new ActionGate(session);

		let turns = 0;
		let consecutiveErrors = 0;
		let safetyDenials = 0;

		const retrievedChunks = await session.retriever
			.search(task, 8, undefined, session.embedder)
			.catch(() => []);

		const ctx = await buildInitialContext(
			task,
			session.repoRoot,
			retrievedChunks,
		);

		const messages: Array<{
			role: "user" | "assistant" | "tool" | "system";
			content: string;
		}> = [{ role: "user", content: ctx.userMessage }];

		session.logger.log({
			event: "session_start",
			task,
			model: session.model,
			turns: 0,
		});

		while (turns < this.config.maxTurns) {
			logTurn(turns, this.config.maxTurns);

			if (Date.now() > deadline)
				return finish(
					"failed",
					"session_timeout",
					turns,
					session.costUsd,
					startTime,
					session,
					undefined,
					messages,
					ctx,
				);

			if (session.costUsd >= this.config.sessionCostCapUsd)
				return finish(
					"failed",
					"cost_cap",
					turns,
					session.costUsd,
					startTime,
					session,
					undefined,
					messages,
					ctx,
				);

			const currentTokens = estimateTokens(ctx.systemPrompt, messages);
			if (
				shouldCompact(
					currentTokens,
					this.config.contextWindowTokens,
					this.config.compactionThreshold,
				)
			) {
				const compacted = await compactContext(
					messages,
					ctx.systemPrompt,
					session.compactModel,
				).catch(() => null);
				if (compacted) {
					messages.length = 0;
					messages.push(...compacted.messages);
				}
			}

			let response: any;
			try {
				response = await session.model_provider.complete(
					messages,
					ctx.systemPrompt,
				);
			} catch (err) {
				session.logger.log({
					event: "model_error",
					turn: turns,
					error: String(err),
				});
				consecutiveErrors++;
				if (consecutiveErrors >= this.config.consecutiveErrorLimit)
					return finish(
						"failed",
						"consecutive_errors",
						turns,
						session.costUsd,
						startTime,
						session,
						undefined,
						messages,
						ctx,
					);
				await new Promise((r) => setTimeout(r, 1000 * consecutiveErrors));
				continue;
			}

			const turnCost = response.costUsd;
			session.costUsd += turnCost;
			session.logger.log({
				event: "model_response",
				turn: turns,
				costUsd: turnCost,
				inputTokens: response.usage.inputTokens,
				outputTokens: response.usage.outputTokens,
				cacheRead: response.usage.cacheRead,
				cacheWrite: response.usage.cacheWrite,
			});

			const responseText = response.text;
			logMessage(responseText);

			if (responseText.includes("DONE")) {
				return finish(
					"done",
					"final_answer",
					turns,
					session.costUsd,
					startTime,
					session,
					responseText,
					messages,
					ctx,
				);
			}

			const toolCalls = this.parseToolCalls(responseText);
			if (toolCalls.length === 0) {
				return finish(
					"done",
					"final_answer",
					turns,
					session.costUsd,
					startTime,
					session,
					responseText,
					messages,
					ctx,
				);
			}

			for (const toolCall of toolCalls) {
				logAction(toolCall.name, toolCall.input);

				doomDetect.record(turns, toolCall.name, toolCall.input);
				const doomEvent = doomDetect.detect();
				if (doomEvent) {
					session.logger.log({ event: "doom_loop", ...doomEvent });
					return finish(
						"failed",
						"doom_loop",
						turns,
						session.costUsd,
						startTime,
						session,
						undefined,
						messages,
						ctx,
					);
				}

				const gateResult = await gate.check(
					task,
					toolCall,
					session,
					blastRadius,
				);
				if (gateResult.decision === "DENY") {
					safetyDenials++;
					if (safetyDenials >= this.config.safetyDenialLimit)
						return finish(
							"failed",
							"safety_denial_limit",
							turns,
							session.costUsd,
							startTime,
							session,
							undefined,
							messages,
							ctx,
						);
					messages.push({
						role: "tool",
						content: `[BLOCKED] ${gateResult.reason}`,
					});
					continue;
				}

				if (
					gateResult.decision === "REQUIRE_HITL" ||
					gateResult.decision === "ESCALATE"
				) {
					const approval = await requestHumanApproval(toolCall, session);
					if (!approval.granted)
						return finish(
							"failed",
							"human_denied",
							turns,
							session.costUsd,
							startTime,
							session,
							undefined,
							messages,
							ctx,
						);
					if (approval.modified) toolCall.input = approval.modified;
				}

				const result = await session.tools.dispatch(toolCall);

				if (toolCall.name === "write_file" || toolCall.name === "edit_file") {
					blastRadius.recordFileModification(
						(toolCall.input as { path: string }).path,
					);
				}
				if (toolCall.name === "shell_exec") {
					blastRadius.recordShellExecution();
				}

				if (result.output) {
					const probeResult = InjectionProbe.scan(result.output);
					if (probeResult.flagged)
						result.output = InjectionProbe.wrap(result.output);
				}

				if (!result.success) {
					consecutiveErrors++;
					if (consecutiveErrors >= this.config.consecutiveErrorLimit)
						return finish(
							"failed",
							"consecutive_errors",
							turns,
							session.costUsd,
							startTime,
							session,
							undefined,
							messages,
							ctx,
						);
				} else {
					consecutiveErrors = 0;
				}

				messages.push({
					role: "tool",
					content: result.success
						? result.output || "done"
						: `[ERROR] ${result.error}`,
				});
			}
			turns++;
		}

		return finish(
			"failed",
			"max_turns",
			turns,
			session.costUsd,
			startTime,
			session,
			undefined,
			messages,
			ctx,
		);
	}

	private parseToolCalls(response: string): ToolCall[] {
		try {
			const jsonMatch = response.match(
				/\[\s*\{[\s\S]*\}\s*\]|\{\s*"name"[\s\S]*\}/,
			);
			if (!jsonMatch) return [];
			const parsed = JSON.parse(jsonMatch[0]);
			return Array.isArray(parsed) ? parsed : [parsed];
		} catch {
			return [];
		}
	}
}
