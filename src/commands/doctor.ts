import * as os from "node:os";
import { execHost } from "../sandbox/hostExec.js";

export async function runDoctor(): Promise<void> {
	console.log("\n🛡️  Goli-CLI System Health Check");
	console.log("──────────────────────────────────────────────────────────");

	const platform = os.platform();
	const isWindows = platform === "win32";
	// Root Fix: use the same socket logic that Dockerode needs for Windows
	const dockerCmd = isWindows ? "docker" : "docker";

	const checks: Array<{
		name: string;
		check: () => Promise<boolean>;
		hint: string;
	}> = [
		{
			name: "Bun Runtime",
			check: async () => {
				try {
					const { stdout } = await execHost("bun --version");
					return stdout.trim().length > 0;
				} catch {
					return false;
				}
			},
			hint: "Install Bun: curl -fsSL https://bun.sh/install | bash",
		},
		{
			name: "Docker Daemon",
			check: async () => {
				try {
					// Fallback to checking wsl docker if native fails, but try native first
					let out = "";
					try {
						const res = await execHost("docker info");
						out = res.stdout;
					} catch {
						if (isWindows) {
							const res = await execHost("wsl docker info");
							out = res.stdout;
						}
					}
					return (
						out.toLowerCase().includes("id:") ||
						out.toLowerCase().includes("server version:")
					);
				} catch (e: any) {
					return false;
				}
			},
			hint: isWindows
				? "Ensure Docker Desktop is running with WSL2 integration enabled."
				: "Docker Engine must be running.",
		},
		{
			name: "Docker Access (hello-world)",
			check: async () => {
				try {
					let out = "";
					try {
						const res = await execHost("docker run --rm hello-world", {
							timeoutMs: 30000,
						});
						out = res.stdout;
					} catch {
						if (isWindows) {
							const res = await execHost("wsl docker run --rm hello-world", {
								timeoutMs: 30000,
							});
							out = res.stdout;
						}
					}
					return out.toLowerCase().includes("hello from docker!");
				} catch (e: any) {
					return false;
				}
			},
			hint: "Ensure your user has permissions to run Docker.",
		},
		{
			name: "WSL2 Kernel (>= 5.15)",
			check: async () => {
				if (!isWindows) return true;
				try {
					const { stdout } = await execHost("wsl uname -r");
					const match = stdout.match(/^(\d+)\.(\d+)/);
					if (!match) return false;
					const major = Number.parseInt(match[1] || "0", 10);
					const minor = Number.parseInt(match[2] || "0", 10);
					return major > 5 || (major === 5 && minor >= 15);
				} catch {
					return false;
				}
			},
			hint: "Update WSL: wsl --update",
		},
		{
			name: "Goli-CLI Sandbox Image",
			check: async () => {
				try {
					let out = "";
					try {
						const res = await execHost(
							"docker image inspect goli_cli-sandbox:v1",
						);
						out = res.stdout;
					} catch {
						if (isWindows) {
							const res = await execHost(
								"wsl docker image inspect goli_cli-sandbox:v1",
							);
							out = res.stdout;
						}
					}
					return (
						out.includes('"Id": "sha256:') || out.includes('Id": "sha256:')
					);
				} catch {
					return false;
				}
			},
			hint: "Build the sandbox image: bun run build-sandbox",
		},
		{
			name: "API Configuration",
			check: async () => {
				return !!(
					process.env.GEMINI_API_KEY ||
					process.env.ANTHROPIC_API_KEY ||
					process.env.OLLAMA_API_KEY
				);
			},
			hint: "Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_API_KEY in your .env",
		},
	];

	let allPassed = true;
	for (const { name, check, hint } of checks) {
		const passed = await check().catch(() => false);
		const icon = passed ? "✅" : "❌";
		console.log(`${icon} ${name.padEnd(30)}`);
		if (!passed) {
			console.log(`   └─ ${hint}`);
			allPassed = false;
		}
	}

	if (allPassed) {
		console.log("\n✨ ALL SYSTEMS GO: Goli-CLI is ready to code.");
	} else {
		console.log("\n⚠️  ISSUES FOUND: Please resolve the hints above.\n");
		process.exitCode = 1;
	}
}
