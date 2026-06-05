import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { Sandbox } from "./Sandbox";

const execAsync = promisify(exec);

/**
 * LocalSandbox runs commands directly on the host machine within a temporary branch.
 * WARNING: This provides NO isolation and is intended for environments without Docker.
 */
export class LocalSandbox implements Sandbox {
	private projectRoot: string;
	private originalBranch = "";
	private tempBranch: string;

	constructor(projectRoot: string) {
		this.projectRoot = projectRoot;
		this.tempBranch = `goli-local-${Date.now()}`;
	}

	async init(): Promise<void> {
		console.warn(
			"âš ï¸  WARNING: Docker not found. Falling back to Local Sandbox.",
		);
		console.warn("âš ï¸  Commands will run directly on your host machine.");

		try {
			// Get current branch
			const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
				cwd: this.projectRoot,
			});
			this.originalBranch = stdout.trim();

			// Create and switch to temp branch
			await execAsync(`git checkout -b ${this.tempBranch}`, {
				cwd: this.projectRoot,
			});
		} catch (err: any) {
			throw new Error(
				`Failed to initialize Local Sandbox (Git required): ${err.message}`,
			);
		}
	}

	async execute(command: string): Promise<string> {
		try {
			const { stdout, stderr } = await execAsync(command, {
				cwd: this.projectRoot,
				timeout: 120_000,
			});
			return stdout + (stderr ? `\n[stderr]:\n${stderr}` : "");
		} catch (err: any) {
			return `Command execution error: ${err.message}\nOutput: ${err.stdout || ""}\nError: ${err.stderr || ""}`;
		}
	}

	async readFile(relativePath: string): Promise<string> {
		const fullPath = path.resolve(this.projectRoot, relativePath);
		return await fs.readFile(fullPath, "utf-8");
	}

	async writeFile(relativePath: string, content: string): Promise<void> {
		const fullPath = path.resolve(this.projectRoot, relativePath);
		await fs.mkdir(path.dirname(fullPath), { recursive: true });
		await fs.writeFile(fullPath, content, "utf-8");
	}

	async destroy(): Promise<void> {
		try {
			// Switch back to original branch
			await execAsync(`git checkout ${this.originalBranch}`, {
				cwd: this.projectRoot,
			});
			// Root fix: only delete the temp branch if it actually carries work
			// the user has not already reviewed. In the common case where the
			// agent produced no diff, the temp branch points at the same commit
			// as the original branch and `git branch -D` is a no-op that
			// misleads the user into thinking something was discarded.
			//
			// `git rev-list --count <original>..<temp>` returns the number of
			// commits reachable from <temp> but not from <original>. Zero means
			// the branches are equivalent — leave the branch in place for the
			// user to inspect if they care.
			const { stdout: ahead } = await execAsync(
				`git rev-list --count ${this.originalBranch}..${this.tempBranch}`,
				{ cwd: this.projectRoot },
			);
			if (Number.parseInt(ahead.trim(), 10) > 0) {
				await execAsync(`git branch -D ${this.tempBranch}`, {
					cwd: this.projectRoot,
				});
			}
		} catch (err) {
			console.warn("Failed to cleanup Local Sandbox branch:", err);
		}
	}

	async extractDiff(): Promise<string> {
		try {
			const { stdout } = await execAsync("git diff HEAD", {
				cwd: this.projectRoot,
			});
			return stdout.trim() === "" ? "(no changes)" : stdout;
		} catch {
			return "(error extracting diff)";
		}
	}

	async applyDiffToHost(diff: string): Promise<void> {
		// In local sandbox, changes are already on host (in the temp branch).
		// To "apply", we would merge the temp branch into the original branch.
		try {
			await execAsync(`git checkout ${this.originalBranch}`, {
				cwd: this.projectRoot,
			});
			const tmpFile = path.join(os.tmpdir(), `goli-apply-${Date.now()}.patch`);
			await fs.writeFile(tmpFile, diff, "utf-8");
			await execAsync(`git apply "${tmpFile}"`, { cwd: this.projectRoot });
			await fs.unlink(tmpFile);
		} catch (err: any) {
			throw new Error(`Failed to apply changes to host: ${err.message}`);
		}
	}
}
