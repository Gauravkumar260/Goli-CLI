import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { execHost } from "../sandbox/hostExec";
import { collectTrainingExample } from "../telemetry/TrainingDataCollector";

export async function commit(projectRoot: string): Promise<void> {
	const patchPath = path.join(projectRoot, ".goli_cli", "latest.patch");
	const metaPath = path.join(projectRoot, ".goli_cli", "session-meta.json");

	try {
		const patch = await fs.readFile(patchPath, "utf8");
		if (!patch || patch.trim() === "" || patch.trim() === "(no changes)") {
			console.log("No staged changes found in .goli_cli/latest.patch");
			return;
		}

		let meta: any = {};
		try {
			const metaContent = await fs.readFile(metaPath, "utf8");
			meta = JSON.parse(metaContent);
		} catch {
			// meta remains empty
		}

		console.log("\n📦 Goli-CLI - Commit Request");
		console.log("──────────────────────────────────────────────────────────");
		console.log("The following changes will be applied to your host machine.");
		console.log("──────────────────────────────────────────────────────────");

		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		const answer = await rl.question("\nApply these changes now? [y/N] ");
		rl.close();

		if (
			answer.trim().toLowerCase() === "y" ||
			answer.trim().toLowerCase() === "yes"
		) {
			console.log("Applying patch...");

			// Root fix: pass `cwd: projectRoot` and let `hostExec` resolve the
			// `git` binary on the host natively. The previous `toWslPathIfNeeded`
			// helper hand-translated Windows backslashes to forward slashes on
			// the assumption that the call would always go through WSL — but the
			// rest of the codebase already abstracts host-vs-WSL through
			// `execHost`. The helper was a premature optimization that diverged
			// from `DockerSandbox.applyDiffToHost` and could fail on Windows
			// when `git` was on the user's PATH but the shell context didn't
			// pick it up. Now we use the same `cwd` mechanism everywhere.
			const { stderr } = await execHost(
				`git apply --whitespace=nowarn "${patchPath}"`,
				{ cwd: projectRoot, timeoutMs: 30000 },
			);

			if (stderr && !stderr.includes("warning:")) {
				console.error(`Error applying changes: ${stderr}`);
				process.exitCode = 1;
			} else {
				console.log("✅ Changes applied successfully.");
				console.log("You can now run 'git commit' to finalize.");

				await collectTrainingExample(meta, patch, true);

				// Clean up staged patch and metadata
				await fs.unlink(patchPath).catch(() => {});
				await fs.unlink(metaPath).catch(() => {});
			}
		} else {
			console.log("Commit aborted.");
		}
	} catch (err: any) {
		if (err.code === "ENOENT") {
			console.log("No staged changes found.");
		} else {
			console.error(`Error during commit: ${err.message}`);
			process.exitCode = 1;
		}
	}
}
