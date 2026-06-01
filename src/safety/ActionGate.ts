import type { ToolCall } from "../tools/ToolRegistry";
import { isPermanentlyDenied } from "./denyList";
import { TranscriptClassifier, type Classification } from "./TranscriptClassifier";
import type { Session } from "../agent/AgentLoop";

export interface GateResult {
  denied: boolean;
  reason?: string;
  requiresHITL: boolean;
  classification?: Classification;
}

/**
 * Three-Tier Action Gate
 * 
 * TIER 1: Safe - Execute immediately.
 * TIER 2: Risky - Run classifier.
 * TIER 3: Destructive - Classifier + mandatory HITL.
 */
export class ActionGate {
  private classifier: TranscriptClassifier;

  constructor(session: Session) {
    this.classifier = new TranscriptClassifier(session.compactModel);
  }

  async check(task: string, toolCall: ToolCall, session: Session): Promise<GateResult> {
    // 1. Gate 0: Permanent Deny List
    const command = toolCall.input?.command || "";
    if (isPermanentlyDenied(command) || isPermanentlyDenied(toolCall.name)) {
      return { denied: true, reason: "Command or tool matches permanent deny-list pattern.", requiresHITL: false };
    }

    const toolName = toolCall.name;

    // 2. Tier 1: Safe Tools
    const safeTools = ["read_file", "list_directory", "search_code", "git_diff", "git_status", "read_file_lines"];
    if (safeTools.includes(toolName)) {
      return { denied: false, requiresHITL: false };
    }

    // 3. Tier 2 & 3: Risky/Destructive
    const classification = await this.classifier.classify(task, toolCall);

    if (classification.verdict === "UNSAFE") {
      return { denied: true, reason: `Classifier flagged as UNSAFE: ${classification.reason}`, requiresHITL: false, classification };
    }

    const destructiveTools = ["delete_file", "git_commit", "git_create_branch"];
    const requiresHITL = destructiveTools.includes(toolName) || classification.verdict === "UNCERTAIN";

    return { 
      denied: false, 
      requiresHITL, 
      classification 
    };
  }
}
