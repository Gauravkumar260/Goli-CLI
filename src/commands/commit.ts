import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline/promises";
import { execHost } from "../sandbox/hostExec";
import { collectTrainingExample } from "../telemetry/TrainingDataCollector";

export async function commit(projectRoot: string) {
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
    } catch (e) {}

    console.log("\n📦 Goli-CLI - Commit Request");
    console.log("──────────────────────────────────────────────────────────");
    console.log("The following changes will be applied to your host machine.");
    console.log("──────────────────────────────────────────────────────────");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("\nApply these changes now? [y/N] ");
    rl.close();

    if (answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes') {
        console.log("Applying patch...");

        const { stdout: wslPatchPath } = await execHost(`wsl wslpath '${patchPath.replace(/\\/g, '/')}'`);
        const { stdout: wslProjectPath } = await execHost(`wsl wslpath '${projectRoot.replace(/\\/g, '/')}'`);

        const cmd = `wsl sh -c "cd '${wslProjectPath.trim()}' && git apply '${wslPatchPath.trim()}'"`;
        const { stdout, stderr } = await execHost(cmd);

        if (stderr) {
            console.error(`Error applying changes: ${stderr}`);
        } else {
            console.log("✅ Changes applied successfully.");
            console.log("You can now run 'git commit' to finalize.");
            
            // Root Fix: Collect training data on successful host application
            await collectTrainingExample(meta, patch, true);

            // Clear the patch and meta
            await fs.unlink(patchPath);
            try { await fs.unlink(metaPath); } catch (e) {}
        }
    } else {
        console.log("Commit aborted.");
    }
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      console.log("No staged changes found.");
    } else {
      console.error(`Error during commit: ${e.message}`);
    }
  }
}
