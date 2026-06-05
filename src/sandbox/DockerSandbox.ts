// src/sandbox/DockerSandbox.ts
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join }                from "node:path";
import { execHost }              from "./hostExec.js";
import { classifyShellCommand }  from "./shellQuote.js";

const isWindows = os.platform() === "win32";

/**
 * DockerSandbox (V2 - Cross-Platform)
 * 
 * Uses CLI wrapper for Docker to ensure 100% reliability in Bun on Windows/WSL2.
 */
export class DockerSandbox {
	private containerId: string | null = null;
	private sessionId: string;
	private projectRoot: string;
	private image: string;

	constructor(
		projectRoot: string,
		image = "goli_cli-sandbox:v1",
		sessionId?: string,
	) {
		this.sessionId = sessionId ?? randomUUID();
		this.projectRoot = projectRoot;
		this.image = image;
	}

	private async dockerExec(cmd: string): Promise<string> {
		const prefix = isWindows ? "wsl docker" : "docker";
		const { stdout } = await execHost(`${prefix} ${cmd}`);
		return stdout.trim();
	}

	async init(): Promise<void> {
		const name = `goli-${this.sessionId}`;

		// 1. Create and start container
		const id = await this.dockerExec(
			`run -d --name ${name} --user root --workdir /workspace --label goli-session=${this.sessionId} --network none --memory 1500m --cpu-quota 75000 ${this.image} tail -f /dev/null`,
		);
		this.containerId = id.trim().substring(0, 12);

		// 2. Provision code via git archive
		const tarPath = join(os.tmpdir(), `goli-${this.sessionId}.tar`);
		try {
		    execSync(`git -C "${this.projectRoot}" archive -o "${tarPath}" HEAD`);
		    
		    if (isWindows) {
		        const { stdout: wslTarPath } = await execHost(`wsl wslpath '${tarPath.replace(/\\/g, "/")}'`);
		        await execHost(`wsl docker cp "${wslTarPath.trim()}" ${this.containerId}:/repo.tar`);
		        await this.executeRaw("mkdir -p /workspace && tar -xf /repo.tar -C /workspace");
		    } else {
		        execSync(`docker cp "${tarPath}" ${this.containerId}:/repo.tar`);
		        await this.executeRaw("tar -xf /repo.tar -C /workspace");
		    }
		} finally {
		    if (existsSync(tarPath)) rmSync(tarPath);
		}

		await this.executeRaw("chown -R goli:goli /workspace && chmod -R 755 /workspace");
		
		// Initialize git in container
		await this.execute("git config --global --add safe.directory /workspace");
		await this.execute("git config --global user.email 'goli@local' && git config --global user.name 'goli' && git init && git add -A && git commit -m 'baseline'");
	}

	async execute(command: string, timeoutMs = 30_000): Promise<string> {
		if (!this.containerId) throw new Error("Sandbox not initialized");

		const safety = classifyShellCommand(command);
		if (safety === "DENY") {
			return `[goli] Blocked: command failed safety check — ${command.slice(0, 80)}`;
		}

		try {
			const prefix = isWindows ? "wsl docker" : "docker";
			const fullCmd = `${prefix} exec --user goli --workdir /workspace ${this.containerId} bash -c ${JSON.stringify(command)}`;
			const { stdout, stderr } = await execHost(fullCmd, { timeoutMs });
			return (stdout || stderr || "").trim();
		} catch (e: any) {
			if (e.message.includes("ETIMEDOUT"))
				return `[goli] Timeout after ${timeoutMs}ms`;
			return `[goli] Error: ${e.message}`;
		}
	}

	private async executeRaw(command: string, timeoutMs = 10_000): Promise<string> {
		if (!this.containerId) throw new Error("Sandbox not initialized");
		const prefix = isWindows ? "wsl docker" : "docker";
		const fullCmd = `${prefix} exec --user root --workdir /workspace ${this.containerId} bash -c ${JSON.stringify(command)}`;
		const { stdout, stderr } = await execHost(fullCmd, { timeoutMs });
		return (stdout || stderr || "").trim();
	}

	async readFile(relativePath: string): Promise<string> {
		return this.execute(`cat "/workspace/${relativePath.replace(/^\/+/, "")}"`);
	}

	async writeFile(relativePath: string, content: string): Promise<void> {
		const encoded = Buffer.from(content).toString("base64");
		const path = `/workspace/${relativePath.replace(/^\/+/, "")}`;
		await this.execute(
			`mkdir -p "$(dirname "${path}")" && echo "${encoded}" | base64 -d > "${path}"`);
	}

	async deleteFile(relativePath: string): Promise<void> {
	    const path = `/workspace/${relativePath.replace(/^\/+/, "")}`;
	    await this.execute(`rm -f "${path}"`);
	}

	async destroy(): Promise<void> {
		if (this.containerId) {
			await this.dockerExec(`stop ${this.containerId}`).catch(() => {});
			await this.dockerExec(`rm ${this.containerId}`).catch(() => {});
			this.containerId = null;
		}
	}

	async extractDiff(): Promise<string> {
		await this.execute("git add -A");
		return this.execute("git diff --cached HEAD");
	}

	async applyDiffToHost(diff: string): Promise<void> {
		if (!diff || diff.trim().length === 0) return;
		const tmpFile = join(os.tmpdir(), `goli-${Date.now()}.patch`);
		writeFileSync(tmpFile, diff);
		try {
			if (isWindows) {
				const { stdout: wslPatchPath } = await execHost(
					`wsl wslpath '${tmpFile.replace(/\\/g, "/")}'`,
				);
				const { stdout: wslProjectPath } = await execHost(
					`wsl wslpath '${this.projectRoot.replace(/\\/g, "/")}'`,
				);
				await execHost(
					`wsl sh -c "cd '${wslProjectPath.trim()}' && git apply '${wslPatchPath.trim()}'"`,
				);
			} else {
				execSync(`git -C "${this.projectRoot}" apply "${tmpFile}"`);
			}
		} finally {
			rmSync(tmpFile, { force: true });
		}
	}

	static async isAvailable(): Promise<boolean> {
		try {
			const prefix = isWindows ? "wsl docker" : "docker";
			execSync(`${prefix} ps`, { stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	}
}
