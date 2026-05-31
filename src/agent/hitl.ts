import * as readline from "readline/promises";
import * as fs from "fs/promises";
import * as path from "path";
import { ToolCall } from "../tools/ToolRegistry";
import { Session } from "./AgentLoop";
import { createHash } from "crypto";

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
│  APEX — Action requires your approval ${riskLabel}
├──────────────────────────────────────────────────────────┤
│  Tool:    ${toolCall.name}
│  Action:  ${description}
├──────────────────────────────────────────────────────────┤
│  [A] Approve   [R] Reject   [M] Modify   [D] Show diff
└──────────────────────────────────────────────────────────┘
  (auto-reject in ${timeoutMs / 1000}s)
> `);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const answer = await Promise.race([
    rl.question(""),
    new Promise<string>((resolve) =>
      setTimeout(() => {
        process.stdout.write("\nTimed out. Auto-rejecting...\n");
        resolve("r");
      }, timeoutMs)
    ),
  ]);

  rl.close();
  const latencyMs = Date.now() - t0;
  const decision = (answer as string).trim().toLowerCase();

  await logAudit(toolCall, session.sessionId, decision, latencyMs);

  switch (decision) {
    case "a":
      return { granted: true, latencyMs };
    case "m": {
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      const modifiedInput = await rl2.question("Modified parameters (JSON): ");
      rl2.close();
      try {
        return { granted: true, modified: JSON.parse(modifiedInput), latencyMs };
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

async function logAudit(toolCall: ToolCall, sessionId: string, decision: string, latencyMs: number) {
  const auditPath = path.join(process.cwd(), ".apex", "audit.jsonl");
  const payloadHash = createHash("sha256").update(JSON.stringify(toolCall.input)).digest("hex");
  
  const entry = {
    ts: new Date().toISOString(),
    session: sessionId,
    tool: toolCall.name,
    payload_hash: payloadHash,
    decision: decision === "a" ? "approved" : decision === "r" ? "rejected" : decision,
    latency_ms: latencyMs,
  };

  try {
    await fs.mkdir(path.dirname(auditPath), { recursive: true });
    await fs.appendFile(auditPath, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    console.error("Failed to write audit log:", e);
  }
}
