import * as fs from "fs/promises";
import * as path from "path";

export async function diff(projectRoot: string) {
  const patchPath = path.join(projectRoot, ".goli_cli", "latest.patch");
  
  try {
    const patch = await fs.readFile(patchPath, "utf8");
    if (!patch || patch.trim() === "" || patch.trim() === "(no changes)") {
      console.log("No staged changes found in .goli_cli/latest.patch");
      return;
    }

    console.log("\n📝 Staged Changes (Ephemeral Sandbox):");
    console.log("──────────────────────────────────────────────────────────");
    console.log(patch);
    console.log("──────────────────────────────────────────────────────────");
    console.log("Run 'goli_cli commit' to apply these changes to your host machine.");
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      console.log("No staged changes found. Run 'goli_cli run' first.");
    } else {
      console.error(`Error reading staged changes: ${e.message}`);
    }
  }
}
