import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function diff(projectRoot: string): Promise<void> {
	const patchPath = path.join(projectRoot, ".goli_cli", "latest.patch");

	try {
		const patch = await fs.readFile(patchPath, "utf8");
		if (!patch || patch.trim() === "" || patch.trim() === "(no changes)") {
			console.log("No staged changes found in .goli_cli/latest.patch");
			return;
		}

		console.log("\n📝 Staged Changes (Goli-CLI Staging Area):");
		console.log("──────────────────────────────────────────────────────────");
		console.log(patch);
		console.log("──────────────────────────────────────────────────────────");
		console.log(
			"Run 'goli commit' to apply these changes to your host machine.",
		);
	} catch (err: any) {
		if (err.code === "ENOENT") {
			console.log("No staged changes found.");
		} else {
			console.error(`Error reading diff: ${err.message}`);
			process.exitCode = 1;
		}
	}
}
