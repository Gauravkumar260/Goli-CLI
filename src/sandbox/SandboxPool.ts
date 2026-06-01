import { type Sandbox } from "./Sandbox";
import { DockerSandbox } from "./DockerSandbox";

export class SandboxPool {
  private projectRoot: string;
  private warmPool: Sandbox[] = [];
  private image: string;

  constructor(projectRoot: string, image: string = "node:20-slim") {
    this.projectRoot = projectRoot;
    this.image = image;
  }

  async initialize(size: number = 1) {
    for (let i = 0; i < size; i++) {
      const sandbox = new DockerSandbox(this.projectRoot, this.image);
      await sandbox.init();
      this.warmPool.push(sandbox);
    }
  }

  async acquire(): Promise<Sandbox> {
    if (this.warmPool.length > 0) {
      const sandbox = this.warmPool.pop()!;
      this.replenish();
      return sandbox;
    }
    const sandbox = new DockerSandbox(this.projectRoot, this.image);
    await sandbox.init();
    return sandbox;
  }

  private async replenish() {
    const sandbox = new DockerSandbox(this.projectRoot, this.image);
    try {
      await sandbox.init();
      this.warmPool.push(sandbox);
    } catch (e) {
      console.error("Failed to replenish sandbox pool:", e);
    }
  }

  async cleanup() {
    for (const sandbox of this.warmPool) {
      await sandbox.destroy();
    }
    this.warmPool = [];
  }
}
