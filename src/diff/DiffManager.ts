import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTwoFilesPatch } from "diff";

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

	async recordWrite(relativePath: string, newContent: string): Promise<void> {
		const normalizedPath = relativePath.replace(/\\/g, "/");

		if (this.changes.has(normalizedPath)) {
			const existing = this.changes.get(normalizedPath)!;
			this.changes.set(normalizedPath, {
				...existing,
				newContent,
			});
		} else {
			const fullPath = path.resolve(this.projectRoot, normalizedPath);
			let originalContent = "";
			try {
				originalContent = await fs.readFile(fullPath, "utf-8");
			} catch (err: any) {
				if (err.code !== "ENOENT") {
					console.warn(
						`Failed to read original content for ${normalizedPath}: ${err.message}`,
					);
				}
				// New file – keep empty string
			}
			this.changes.set(normalizedPath, {
				file: normalizedPath,
				originalContent,
				newContent,
			});
		}
	}

	getChanges(): PendingChange[] {
		return Array.from(this.changes.values());
	}

	getDiff(): string {
		if (this.changes.size === 0) {
			return "(no changes)";
		}
		let diff = "";
		for (const change of this.changes.values()) {
			diff += `${createTwoFilesPatch(change.file, change.file, change.originalContent, change.newContent, "", "", { context: 3 })}\n`;
		}
		return diff;
	}

	async applyAll(): Promise<void> {
		for (const change of this.changes.values()) {
			const fullPath = path.resolve(this.projectRoot, change.file);
			await fs.mkdir(path.dirname(fullPath), { recursive: true });
			await fs.writeFile(fullPath, change.newContent, "utf-8");
		}
		this.changes.clear();
	}

	clear(): void {
		this.changes.clear();
	}
}
