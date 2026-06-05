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

export interface BlastRadiusSummary {
	filesCount: number;
	shellCount: number;
}

export class BlastRadiusTracker {
	private filesModified: Set<string> = new Set();
	private shellCommands = 0;

	constructor(private config: BlastRadiusConfig = DEFAULT_BLAST_RADIUS) {}

	recordFileModification(filePath: string): void {
		if (filePath) this.filesModified.add(filePath);
	}

	recordShellExecution(): void {
		this.shellCommands++;
	}

	checkLimits(): { breached: boolean; reason?: string } {
		if (this.filesModified.size > this.config.maxFilesModified) {
			return {
				breached: true,
				reason: `Max files modified limit exceeded (${this.filesModified.size}/${this.config.maxFilesModified})`,
			};
		}
		if (this.shellCommands > this.config.maxShellCommands) {
			return {
				breached: true,
				reason: `Max shell commands limit exceeded (${this.shellCommands}/${this.config.maxShellCommands})`,
			};
		}
		return { breached: false };
	}

	getSummary(): BlastRadiusSummary {
		return {
			filesCount: this.filesModified.size,
			shellCount: this.shellCommands,
		};
	}

	reset(): void {
		this.filesModified.clear();
		this.shellCommands = 0;
	}
}
