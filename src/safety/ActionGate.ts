import type { AgentSession as Session } from "../config/types.js";
import { classifyShellCommand } from "../sandbox/shellQuote.js";
import type { ToolCall } from "../tools/ToolRegistry.js";
import { AuditLog } from "./AuditLog.js";
import type { BlastRadiusTracker } from "./BlastRadiusTracker.js";
import { isPermanentlyDenied } from "./denyList.js";
import {
	type Classification,
	TranscriptClassifier,
} from "./TranscriptClassifier.js";

export type GateDecision = "PROCEED" | "REQUIRE_HITL" | "ESCALATE" | "DENY";

export interface GateResult {
	decision: GateDecision;
	reason?: string;
	classification?: Classification;
}

const TIER_1_TOOLS = new Set([
	"read_file",
	"read_file_lines",
	"list_directory",
	"search_code",
	"git_diff",
	"git_status",
	"list_files",
	"get_context",
]);

const TIER_3_TOOLS = new Set(["git_commit", "delete_file", "shell_exec"]);

const TIER_2_TOOLS = new Set([
	"write_file",
	"edit_file",
	"run_tests",
	"git_create_branch",
	"create_dir",
]);

const PROTECTED_PATHS = [
	/^\.github\/workflows\//,
	/^deploy\//,
	/^evals\//,
	/^docs\/adr\//,
	/\.env($|\.)/,
	/\.(pem|key|p12|pfx|crt)$/,
	/^\.git\//,
];

export class ActionGate {
	private readonly classifier: TranscriptClassifier;
	private readonly auditLog: AuditLog;

	constructor(session: Session) {
		this.classifier = new TranscriptClassifier(session.compactModel);
		this.auditLog = new AuditLog();
	}

	async check(
		task: string,
		toolCall: ToolCall,
		session: Session,
		blastRadius: BlastRadiusTracker,
	): Promise<GateResult> {
		const { name, input } = toolCall;
		const t0 = Date.now();

		const finalize = async (
			decision: GateDecision,
			reason?: string,
			classification?: Classification,
		): Promise<GateResult> => {
			const latencyMs = Date.now() - t0;
			await this.auditLog.log(
				session.sessionId,
				"gate_check",
				name,
				{ input, classification },
				decision,
				latencyMs,
			);
			const res: GateResult = { decision };
			if (reason) res.reason = reason;
			if (classification) res.classification = classification;
			return res;
		};

		const targetPath = (input as { path?: string }).path;
		if (targetPath && PROTECTED_PATHS.some((p) => p.test(targetPath))) {
			return finalize("DENY", `Protected path access: ${targetPath}`);
		}

		const blastStatus = blastRadius.checkLimits();
		if (blastStatus.breached) {
			return finalize(
				"REQUIRE_HITL",
				`Blast radius reached: ${blastStatus.reason}`,
			);
		}

		const command = (input as any)?.command || "";
		if (isPermanentlyDenied(String(command)) || isPermanentlyDenied(name)) {
			return finalize("DENY", "Command or tool matches permanent deny-list.");
		}

		if (TIER_1_TOOLS.has(name)) {
			return finalize("PROCEED");
		}

		if (name === "shell_exec") {
			const verdict = classifyShellCommand(String(command));
			if (verdict === "DENY") {
				return finalize("DENY", "Shell command blocked by AST security.");
			}
			return finalize(
				"REQUIRE_HITL",
				"Shell execution requires manual approval.",
			);
		}

		if (TIER_3_TOOLS.has(name)) {
			return finalize(
				"REQUIRE_HITL",
				"Destructive action requires manual approval.",
			);
		}

		if (TIER_2_TOOLS.has(name)) {
			const classification = await this.classifier.classify(task, toolCall);
			if (classification.verdict === "UNSAFE") {
				return finalize(
					"DENY",
					`Action flagged as UNSAFE: ${classification.reason}`,
					classification,
				);
			}
			if (classification.verdict === "UNCERTAIN") {
				return finalize(
					"REQUIRE_HITL",
					`Action flagged as UNCERTAIN: ${classification.reason}`,
					classification,
				);
			}
			return finalize("PROCEED", undefined, classification);
		}

		return finalize("REQUIRE_HITL", "Unknown tool requires manual approval.");
	}
}
