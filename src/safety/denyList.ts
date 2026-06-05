/**
 * Permanent Deny-List (Gate 0: Regex/Keyword)
 *
 * These patterns trigger an immediate SECURITY_DENIAL without calling an LLM.
 */

export const DENY_LIST_PATTERNS: RegExp[] = [
	// 1. Host Access & Shell Escape
	/wsl\.exe/i,
	/powershell\.exe/i,
	/cmd\.exe/i,
	/ssh /i,
	/scp /i,
	/sftp /i,

	// 2. Network (Sandbox is isolated, but this blocks "blind" attempts)
	/curl /i,
	/wget /i,
	/http:/i,
	/https:/i,
	/ping /i,
	/socket /i,
	/nc /i,
	/telnet /i,

	// 3. Privilege Escalation
	/sudo /i,
	/su /i,
	/visudo/i,
	/chown /i,
	/chgrp /i,
	/chmod \+s/i,

	// 4. Credential Paths & Secrets
	/\.ssh\//i,
	/\.aws\//i,
	/config\.json/i,
	/\.env($|\.|\/)/i, // Root Fix: improved .env match
	/shadow/i,
	/passwd/i,

	// 5. System & Kernel Paths
	/\/etc\//i,
	/\/var\/run\//i,
	/\/proc\//i,
	/\/sys\//i,
	/\/dev\//i,

	// 6. Docker (Agent must not control its own sandbox)
	/docker /i,
	/docker-compose/i,
	/containerd/i,

	// 7. Process/Session Management & Bypass Attempts
	/alias /i,
	/export /i,
	/set -e/i,
	/source /i,
	/unalias /i,

	// 8. Malicious Payloads / Obfuscation
	/base64 --decode/i,
	/base64 -d/i,
	/hex /i,
	/eval /i,
	/exec /i,
];

export function isPermanentlyDenied(input: string): boolean {
	if (!input) return false;
	return DENY_LIST_PATTERNS.some((pattern) => pattern.test(input));
}
