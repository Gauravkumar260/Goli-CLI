/**
 * Blast Radius Tracker
 * 
 * Prevents runaway agent behavior by enforcing session-level caps 
 * on file modifications and shell executions.
 */

export interface BlastRadiusConfig {
  maxFilesModified: number;
  maxShellCommands: number;
}

export const DEFAULT_BLAST_RADIUS: BlastRadiusConfig = {
  maxFilesModified: 10,
  maxShellCommands: 20,
};

export class BlastRadiusTracker {
  public filesModified: Set<string> = new Set();
  public shellCommands: number = 0;

  constructor(private config: BlastRadiusConfig = DEFAULT_BLAST_RADIUS) {}

  recordFileModification(path: string) {
    this.filesModified.add(path);
  }

  recordShellExecution() {
    this.shellCommands++;
  }

  checkLimits(): { breached: boolean; reason?: string } {
    if (this.filesModified.size > this.config.maxFilesModified) {
      return { breached: true, reason: `Max files modified limit exceeded (${this.config.maxFilesModified})` };
    }
    if (this.shellCommands > this.config.maxShellCommands) {
      return { breached: true, reason: `Max shell commands limit exceeded (${this.config.maxShellCommands})` };
    }
    return { breached: false };
  }

  getSummary() {
    return {
      filesCount: this.filesModified.size,
      shellCount: this.shellCommands,
    };
  }
}
