import { type Sandbox } from "./Sandbox";
import { exec } from "child_process";
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

  constructor(projectRoot: string, image: string = "goli_cli-sandbox:v1") {
    this.containerName = `goli_cli-sandbox-${Math.random().toString(36).substring(7)}`;
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
         throw new Error(`Image ${this.image} not found. Please build it using the Dockerfile.`);
      } else {
        throw e;
      }
    }

    try {
      const wslProjectPath = (await execAsync(`wsl wslpath '${this.projectRoot.replace(/\\/g, '/')}'`)).stdout.trim();
      
      await this.execute("mkdir -p /workspace && rm -rf /workspace/*");
      
      const archiveCmd = `wsl sh -c "git -C \\"${wslProjectPath}\\" archive HEAD | docker cp - ${this.containerName}:/workspace"`;
      await execAsync(archiveCmd);
      
      await this.execute("git config --global user.email 'goli_cli@local.host' && git config --global user.name 'Goli_CLI Agent'");
      await this.execute("cd /workspace && git init && git add -A && git commit -m 'goli_cli: baseline'");
    } catch (e) {
      console.error("Failed to stage project in sandbox:", e);
      throw e;
    }
  }

  async execute(command: string): Promise<string> {
    const b64Command = Buffer.from(command).toString('base64');
    const cmd = `wsl docker exec ${this.containerName} bash -c "echo ${b64Command} | base64 -d | bash"`;
    try {
      const { stdout, stderr } = await execAsync(cmd);
      return stdout + (stderr ? `\nErrors:\n${stderr}` : "");
    } catch (e: any) {
      return `Command failed: ${e.message}\nOutput: ${e.stdout}\nErrors: ${e.stderr}`;
    }
  }

  async readFile(relativePath: string): Promise<string> {
    const cleanPath = relativePath.replace(/^\//, '');
    return this.execute(`cat "/workspace/${cleanPath}"`);
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const cleanPath = relativePath.replace(/^\//, '');
    const b64Content = Buffer.from(content).toString('base64');
    const writeCmd = `mkdir -p "$(dirname "/workspace/${cleanPath}")" && echo ${b64Content} | base64 -d > "/workspace/${cleanPath}"`;
    await this.execute(writeCmd);
  }

  async destroy(): Promise<void> {
    try {
      await execAsync(`wsl docker rm -f ${this.containerName}`);
    } catch (e) {}
  }

  async extractDiff(): Promise<string> {
    await this.execute("cd /workspace && git add -A");
    return this.execute("cd /workspace && git diff --cached HEAD");
  }

  async applyDiffToHost(diff: string): Promise<void> {
    if (!diff || diff.trim() === "(no changes)" || diff.trim() === "") return;

    const tmpFile = path.join(os.tmpdir(), `goli_cli-${Date.now()}.patch`);
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
