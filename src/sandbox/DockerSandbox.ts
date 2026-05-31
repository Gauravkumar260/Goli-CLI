import { Sandbox } from "./Sandbox";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import { execHost } from "./hostExec";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from 'os';

const execAsync = promisify(exec);

export class DockerSandbox implements Sandbox {
  private containerName: string;
  private image: string;
  private projectRoot: string;

  constructor(projectRoot: string, image: string = "apex-sandbox:v1") {
    this.containerName = `apex-sandbox-${Math.random().toString(36).substring(7)}`;
    this.image = image;
    this.projectRoot = projectRoot;
  }

  async init() {
    const runCmd = `wsl docker run -d --name ${this.containerName} ` +
                `--network none --memory 2g --cpus 1.0 ` +
                `-w /workspace ${this.image} tail -f /dev/null`;
    
    try {
      await execAsync(runCmd);
    } catch (e: any) {
      if (e.message.includes("not found")) {
         console.log(`Image ${this.image} not found. Please build it using the Dockerfile.`);
         throw e;
      } else {
        throw e;
      }
    }

    console.log("Staging ephemeral clone in sandbox...");
    try {
      const wslProjectPath = (await execAsync(`wsl wslpath '${this.projectRoot.replace(/\\/g, '/')}'`)).stdout.trim();
      
      // Ensure workspace exists and is empty
      await this.execute("rm -rf /workspace/*");
      
      // Pipe git archive to docker cp
      const archiveCmd = `wsl sh -c "git -C \\"${wslProjectPath}\\" archive HEAD | docker cp - ${this.containerName}:/"`;
      await execAsync(archiveCmd);
      
      // Verification
      const files = await this.execute("ls -R /workspace | head -n 5");
      console.log(`Sandbox files staged: ${files.substring(0, 50)}...`);

      await this.execute("git config --global user.email 'apex@local.host' && git config --global user.name 'APEX Agent'");
      await this.execute("cd /workspace && git init && git add . && git commit -m 'apex: baseline'");
    } catch (e) {
      console.error("Failed to stage project in sandbox:", e);
      throw e;
    }
  }

  async execute(command: string): Promise<string> {
    const cmd = `wsl docker exec ${this.containerName} /bin/sh -c "${command.replace(/"/g, '\\"')}"`;
    try {
      const { stdout, stderr } = await execAsync(cmd);
      return stdout + (stderr ? `\nErrors:\n${stderr}` : "");
    } catch (e: any) {
      return `Command failed: ${e.message}\nOutput: ${e.stdout}\nErrors: ${e.stderr}`;
    }
  }

  async readFile(relativePath: string): Promise<string> {
    return this.execute(`cat "/workspace/${relativePath}"`);
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const escapedContent = content.replace(/'/g, "'\\''");
    await this.execute(`mkdir -p "$(dirname "/workspace/${relativePath}")" && echo '${escapedContent}' > "/workspace/${relativePath}"`);
  }

  async destroy(): Promise<void> {
    try {
      await execAsync(`wsl docker rm -f ${this.containerName}`);
    } catch (e) {}
  }

  async extractDiff(): Promise<string> {
    return this.execute("cd /workspace && git diff HEAD");
  }

  async applyDiffToHost(diff: string): Promise<void> {
    if (!diff || diff.trim() === "(no changes)") return;

    const tmpFile = path.join(os.tmpdir(), `apex-${Date.now()}.patch`);
    await fs.writeFile(tmpFile, diff, "utf8");
    
    try {
      const wslTmpPath = (await execAsync(`wsl wslpath '${tmpFile.replace(/\\/g, '/')}'`)).stdout.trim();
      const wslProjectPath = (await execAsync(`wsl wslpath '${this.projectRoot.replace(/\\/g, '/')}'`)).stdout.trim();
      
      await execHost(`wsl sh -c "cd '${wslProjectPath}' && git apply '${wslTmpPath}'"`);
    } finally {
      await fs.unlink(tmpFile);
    }
  }
}
