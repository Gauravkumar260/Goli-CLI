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

    console.log("\n📝 Staged Changes (Goli-CLI Staging Area):");
    console.log("──────────────────────────────────────────────────────────");
    console.log(patch);
    console.log("──────────────────────────────────────────────────────────");
    console.log("Run 'goli-cli commit' to apply these changes to your host machine.");

  } catch (e: any) {
    if (e.code === 'ENOENT') {
      console.log("No staged changes found.");
    } else {
      console.error(`Error reading diff: ${e.message}`);
    }
  }
}
