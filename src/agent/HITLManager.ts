import * as readline from "node:readline/promises";
import type { ToolCall } from "../tools/ToolRegistry.js";
import type { Session } from "./AgentLoop.js";
import { AuditLog } from "../safety/AuditLog.js";

export interface HITLApproval {
        granted: boolean;
        modified?: any;
        latencyMs: number;
}

export class HITLManager {
        private auditLog = new AuditLog();

        async requestApproval(
                toolCall: ToolCall,
                session: Session,
                timeoutMs = 60_000,
        ): Promise<HITLApproval> {
                const t0 = Date.now();
                const result = await requestHumanApproval(toolCall, session, timeoutMs);
                const latencyMs = Date.now() - t0;

                await this.auditLog.log(
                        session.sessionId,
                        "human_approval",
                        toolCall.name,
                        { input: toolCall.input, decision: result.granted ? "approved" : "rejected" },
                        result.granted ? "PROCEED" : "DENY",
                        latencyMs
                );

                return result;
        }
}

export async function requestHumanApproval(
        toolCall: ToolCall,
        session: Session,
        timeoutMs = 60_000,
): Promise<HITLApproval> {
        const t0 = Date.now();
        const riskLabel = "⚠  HIGH RISK";
        const description = `${toolCall.name}: ${JSON.stringify(toolCall.input)}`;

        process.stdout.write(`
┌──────────────────────────────────────────────────────────┐
│  Goli-CLI — Action requires your approval ${riskLabel}
├──────────────────────────────────────────────────────────┤
│  Tool:    ${toolCall.name}
│  Action:  ${description}
├──────────────────────────────────────────────────────────┤
│  [A] Approve   [R] Reject   [M] Modify   [D] Show diff
└──────────────────────────────────────────────────────────┘
  (auto-reject in ${timeoutMs / 1000}s)
> `);

        const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
        });

        let timer: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<string>((resolve) => {
                timer = setTimeout(() => {
                        process.stdout.write("\nTimed out. Auto-rejecting...\n");
                        resolve("r");
                }, timeoutMs);
        });

        const answer = await Promise.race([rl.question(""), timeoutPromise]);

        if (timer) clearTimeout(timer);
        rl.close();
        const decision = (answer as string).trim().toLowerCase();

        switch (decision) {
                case "a":
                        return { granted: true, latencyMs: Date.now() - t0 };
                case "m": {
                        const rl2 = readline.createInterface({
                                input: process.stdin,
                                output: process.stdout,
                        });
                        const modifiedInput = await rl2.question("Modified parameters (JSON): ");
                        rl2.close();
                        try {
                                const modified = JSON.parse(modifiedInput);
                                return { granted: true, modified, latencyMs: Date.now() - t0 };
                        } catch {
                                process.stdout.write("Invalid JSON. Rejecting.\n");
                                return { granted: false, latencyMs: Date.now() - t0 };
                        }
                }
                case "d": {
                        const diff = await session.sandbox.execute("git diff HEAD");
                        process.stdout.write(`\n--- CURRENT DIFF ---\n${diff}\n------------------\n`);
                        const remainingTimeout = Math.max(0, timeoutMs - (Date.now() - t0));
                        return requestHumanApproval(toolCall, session, remainingTimeout);
                }
                default:
                        return { granted: false, latencyMs: Date.now() - t0 };
        }
}
