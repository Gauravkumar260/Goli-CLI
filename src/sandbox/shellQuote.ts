// src/sandbox/shellQuote.ts
import { parse } from "shell-quote";
import type { ParseEntry } from "shell-quote";

export type SafetyVerdict = "SAFE" | "REQUIRES_REVIEW" | "DENY";

const DENIED_COMMANDS = new Set([
	"rm",
	"rmdir",
	"shred",
	"truncate",
	"mkfs",
	"dd",
	"fdisk",
	"parted",
	"sudo",
	"su",
	"doas",
	"chroot",
	"printenv",
	"env",
	"eval",
	"exec",
	"shutdown",
	"reboot",
	"halt",
	"poweroff",
	"nc",
	"ncat",
	"socat",
	"passwd",
	"useradd",
	"usermod",
	"systemctl",
	"service",
	"crontab",
]);

const PATTERNS_DENY = [
	/\$\(/,
	/`[^`]+`/,
	/\|\s*(bash|sh|zsh|dash|ksh|fish)\b/,
	/<\(|\>\(/,
	/\$\(\(/,
	/\$IFS|\$\{IFS\}/,
	/cat\s+.*\.env/, // Root Fix: block cat on .env files
];

const PATTERNS_REVIEW = [
	/(?:>>?)\s*(\/(?:etc|var|root|home|proc|sys|boot)\/)/,
	/<<\s*[-']?\w+/,
];

/**
 * AST-aware shell safety classifier (V2).
 */
export function classifyShellCommand(command: string): SafetyVerdict {
	if (!command?.trim()) return "REQUIRES_REVIEW";

	for (const p of PATTERNS_DENY) {
		if (p.test(command)) return "DENY";
	}
	for (const p of PATTERNS_REVIEW) {
		if (p.test(command)) return "REQUIRES_REVIEW";
	}

	let tokens: ParseEntry[];
	try {
		tokens = parse(command);
	} catch {
		return "DENY";
	}

	const commandNames: string[] = [];
	let nextIsCommandName = true;

	for (const token of tokens) {
		if (typeof token === "string") {
			if (nextIsCommandName) {
				const tail = token.split("/").pop();
				if (tail) commandNames.push(tail.toLowerCase());
				nextIsCommandName = false;
			}
		} else if (typeof token === "object" && "op" in token) {
			if (["|", "||", "&&", ";", "&"].includes(token.op)) {
				nextIsCommandName = true;
			}
		} else {
			return "REQUIRES_REVIEW";
		}
	}

	for (const name of commandNames) {
		if (DENIED_COMMANDS.has(name)) return "DENY";
	}

	return "SAFE";
}
