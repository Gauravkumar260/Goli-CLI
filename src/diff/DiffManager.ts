import * as fs from "fs/promises";
import * as path from "path";   

export interface PendingChange {
  file: string;
  originalContent: string;      
  newContent: string;
}

export class DiffManager {      
  private changes: Map<string, PendingChange> = new Map();
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  async recordWrite(relativePath: string, newContent: string) {
    const fullPath = path.resolve(this.projectRoot, relativePath);

    if (this.changes.has(relativePath)) {
      const existing = this.changes.get(relativePath)!;
      this.changes.set(relativePath, {
        ...existing,
        newContent
      });
    } else {
      let originalContent = "";
      try {
        originalContent = await fs.readFile(fullPath, "utf-8");
      } catch (e) {
        // New file
      }
      this.changes.set(relativePath, {
        file: relativePath,
        originalContent,
        newContent
      });
    }
  }

  getChanges(): PendingChange[] {
    return Array.from(this.changes.values());
  }

  async applyAll() {
    for (const change of this.changes.values()) {
      const fullPath = path.resolve(this.projectRoot, change.file);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, change.newContent, "utf-8");
    }
    this.changes.clear();
  }

  clear() {
    this.changes.clear();
  }
}
