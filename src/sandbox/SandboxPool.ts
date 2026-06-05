import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as os from "node:os";
import { hasHeadroom } from "../agent/TeamRunner.js";
// src/sandbox/SandboxPool.ts
import { DockerSandbox } from "./DockerSandbox.js";
import type { Sandbox } from "./Sandbox.js";

const isWindows = os.platform() === "win32";

/**
 * SandboxPool (V2 - CLI based)
 *
 * Manages a pool of pre-warmed Docker sandboxes using the CLI for maximum
 * compatibility with Bun on Windows.
 */
export class SandboxPool {
	private warmPool: Array<{ sandbox: DockerSandbox; id: string }> = [];
	private poolSize: number;
	private image: string;
	private projectRoot: string;

	constructor(
		projectRoot: string,
		image = "goli_cli-sandbox:v1",
		poolSize = 1,
	) {
		this.poolSize = poolSize;
		this.image = image;
		this.projectRoot = projectRoot;
	}

	async initialize(): Promise<void> {
		const prefix = isWindows ? "wsl docker" : "docker";
		try {
			execSync(`${prefix} pull ${this.image}`, { stdio: "ignore" });
		} catch {
			// ignore
		}

		for (let i = 0; i < this.poolSize; i++) {
			if (hasHeadroom(1600)) {
				await this.replenishOne();
			}
		}
	}

	async acquire(): Promise<Sandbox> {
		if (this.warmPool.length > 0) {
			const entry = this.warmPool.pop()!;
			setImmediate(() => this.replenishOne());
			return entry.sandbox;
		}

		const sandbox = new DockerSandbox(this.projectRoot, this.image);
		await sandbox.init();
		return sandbox;
	}

	private async replenishOne(): Promise<void> {
		if (!hasHeadroom(1600)) return;

		try {
			const sandbox = new DockerSandbox(this.projectRoot, this.image);
			await sandbox.init();
			this.warmPool.push({ sandbox, id: randomUUID() });
		} catch {
			// ignore
		}
	}

	async close(): Promise<void> {
		const all = [...this.warmPool];
		this.warmPool = [];
		await Promise.all(all.map((e) => e.sandbox.destroy().catch(() => {})));
	}
}
