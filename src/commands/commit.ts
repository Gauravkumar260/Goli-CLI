import * as fs from "fs/promises";
import * as path from "path";
import { execHost } from "../sandbox/hostExec";
import * as readline from "readline/promises";

export async function commit(projectRoot: string) {
  const patchPath = path.join(projectRoot, ".apex", "latest.patch");
  
  try {
    const patch = await fs.readFile(patchPath, "utf8");
    if (!patch || patch.trim() === "" || patch.trim() === "(no changes)") {
      console.log("No staged changes to commit.");
      return;
    }

    console.log("\n⚠️  APEX - Commit Request");
    console.log("──────────────────────────────────────────────────────────");
    console.log("The following changes will be applied to your host machine.");
    console.log("──────────────────────────────────────────────────────────");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("\nApply these changes now? [y/N] ");
    rl.close();

    if (answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes') {
        console.log("Applying patch...");
        
        // Use wslpath for Windows compatibility if running from Bun on Windows
        const { stdout: wslPatchPath } = await execHost(`wsl wslpath '${patchPath.replace(/\\/g, '/')}'`);
        const { stdout: wslProjectPath } = await execHost(`wsl wslpath '${projectRoot.replace(/\\/g, '/')}'`);
        
        const cmd = `wsl sh -c "cd '${wslProjectPath.trim()}' && git apply '${wslPatchPath.trim()}'"`;
        const { stdout, stderr } = await execHost(cmd);
        
        if (stderr) {
            console.error(`Error applying changes: ${stderr}`);
        } else {
            console.log("✅ Changes applied successfully.");
            console.log("You can now run 'git commit' to finalize.");
            // Clear the patch
            await fs.unlink(patchPath);
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
