import * as readline from "readline/promises";
import * as fs from "fs/promises";
import * as path from "path";
import { type ToolCall } from "../tools/ToolRegistry";
import { type Session } from "./AgentLoop";
import { AuditLog } from "../safety/AuditLog";

export interface HITLApproval {
  granted: boolean;
  modified?: any;
  latencyMs: number;
}

export async function requestHumanApproval(
  toolCall: ToolCall,
  session: Session,
  timeoutMs: number = 60_000
): Promise<HITLApproval> {
  const t0 = Date.now();
  const riskLabel = "⚠️  HIGH RISK";
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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let timer: any;
  const timeoutPromise = new Promise<string>((resolve) => {
      timer = setTimeout(() => {
        process.stdout.write("\nTimed out. Auto-rejecting...\n");
        resolve("r");
      }, timeoutMs);
  });

  const answer = await Promise.race([
    rl.question(""),
    timeoutPromise,
  ]);

  clearTimeout(timer);
  rl.close();
  const latencyMs = Date.now() - t0;
  const decision = (answer as string).trim().toLowerCase();

  // Root fix: Use Chain-Hash Audit Log
  await AuditLog.log(session.sessionId, toolCall.name, toolCall.input, decision, latencyMs);

  switch (decision) {
    case "a":
      return { granted: true, latencyMs };
    case "m": {
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      const modifiedInput = await rl2.question("Modified parameters (JSON): ");
      rl2.close();
      try {
        const modified = JSON.parse(modifiedInput);
        await AuditLog.log(session.sessionId, toolCall.name, modified, "modified_approval", latencyMs);
        return { granted: true, modified, latencyMs };
      } catch {
        process.stdout.write("Invalid JSON. Rejecting.\n");
        return { granted: false, latencyMs };
      }
    }
    case "d":
      const diff = session.diffManager.getDiff();
      process.stdout.write(`\n--- CURRENT DIFF ---\n${diff}\n------------------\n`);
      return requestHumanApproval(toolCall, session, timeoutMs); // Re-prompt
    default:
      return { granted: false, latencyMs };
  }
}
