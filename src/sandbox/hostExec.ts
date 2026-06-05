import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ExecHostOptions {
	timeoutMs?: number;
	cwd?: string;
}

/**
 * Runs a command on the host machine (outside any container).
 * Handles both WSL2 and native Windows/Linux environments.
 */
export async function execHost(
	command: string,
	opts: ExecHostOptions = {},
): Promise<{ stdout: string; stderr: string }> {
	const timeout = opts.timeoutMs ?? 30_000;
	try {
		const result = await execAsync(command, {
			timeout,
			cwd: opts.cwd,
			env: { ...process.env },
			maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
		});
		return { stdout: result.stdout, stderr: result.stderr };
	} catch (error: any) {
		// Preserve stdout/stderr even on error for debugging
		throw new Error(
			`Host command failed: ${error.message}\n` +
				`STDOUT: ${error.stdout}\nSTDERR: ${error.stderr}`,
		);
	}
}
