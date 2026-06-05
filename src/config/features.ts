import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const GOLI_CLI_HOME =
	process.env.GOLI_CLI_HOME || path.join(os.homedir(), ".goli_cli");
const CONFIG_PATH = path.join(GOLI_CLI_HOME, "config.json");

export interface FeatureFlags {
	enable_telemetry: boolean;
	use_pro_grader: boolean;
	aggressive_compaction: boolean;
	experimental_parallel_execution: boolean;
	verbose_logging: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
	enable_telemetry: false,
	use_pro_grader: false,
	aggressive_compaction: true,
	experimental_parallel_execution: false,
	verbose_logging: false,
};

export interface GoliConfig {
	anonymousUserId: string;
	features: FeatureFlags;
	api_keys: {
		gemini?: string;
		anthropic?: string;
		ollama_cloud?: string;
	};
	last_run?: string;
	telemetry_prompt_shown?: boolean;
}

export class ConfigManager {
	private config: GoliConfig = {
		anonymousUserId: "",
		features: { ...DEFAULT_FLAGS },
		api_keys: {},
	};

	async load(): Promise<void> {
		try {
			const content = await fs.readFile(CONFIG_PATH, "utf8");
			this.config = JSON.parse(content);
			if (!this.config.anonymousUserId) {
				this.config.anonymousUserId = randomUUID();
				await this.save();
			}
			if (!this.config.api_keys) this.config.api_keys = {};
			if (!this.config.features) this.config.features = { ...DEFAULT_FLAGS };
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				console.warn(`Failed to load config: ${err.message}`);
			}
			this.config = {
				anonymousUserId: randomUUID(),
				features: { ...DEFAULT_FLAGS },
				api_keys: {},
				telemetry_prompt_shown: false,
			};
			await this.save();
		}
	}

	async save(): Promise<void> {
		const dir = path.dirname(CONFIG_PATH);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		await fs.writeFile(
			CONFIG_PATH,
			JSON.stringify(this.config, null, 2),
			"utf8",
		);
	}

	getFeature(name: keyof FeatureFlags): boolean {
		return this.config.features?.[name] ?? DEFAULT_FLAGS[name];
	}

	setFeature(name: keyof FeatureFlags, value: boolean): void {
		if (!this.config.features) this.config.features = { ...DEFAULT_FLAGS };
		this.config.features[name] = value;
	}

	getApiKey(
		provider: "gemini" | "anthropic" | "ollama_cloud",
	): string | undefined {
		return (
			this.config.api_keys?.[provider] ||
			process.env[`${provider.toUpperCase()}_API_KEY`]
		);
	}

	setApiKey(
		provider: "gemini" | "anthropic" | "ollama_cloud",
		key: string,
	): void {
		if (!this.config.api_keys) this.config.api_keys = {};
		this.config.api_keys[provider] = key;
	}

	getUserId(): string {
		return this.config.anonymousUserId;
	}

	isTelemetryPromptShown(): boolean {
		return !!this.config.telemetry_prompt_shown;
	}

	setTelemetryPromptShown(value: boolean): void {
		this.config.telemetry_prompt_shown = value;
	}

	listFeatures(): FeatureFlags {
		return { ...DEFAULT_FLAGS, ...(this.config.features || {}) };
	}
}

export async function runFeatureCommand(args: string[]): Promise<void> {
	const manager = new ConfigManager();
	await manager.load();

	const sub = args[0];
	if (sub === "list" || !sub) {
		console.log("\n🚩 Goli-CLI Feature Flags");
		const features = manager.listFeatures();
		for (const [k, v] of Object.entries(features)) {
			console.log(`- ${k.padEnd(30)} : ${v ? "🟢 ON" : "⚪ OFF"}`);
		}
		console.log("");
	} else if (sub === "enable" || sub === "disable") {
		const name = args[1] as keyof FeatureFlags;
		if (!Object.hasOwn(DEFAULT_FLAGS, name)) {
			console.error(`Unknown feature: ${name}`);
			return;
		}
		manager.setFeature(name, sub === "enable");
		await manager.save();
		console.log(`Feature ${name} ${sub}d.`);
	} else {
		console.log(`Unknown subcommand: ${sub}. Use list, enable, or disable.`);
	}
}

export async function runConfigCommand(args: string[]): Promise<void> {
	const manager = new ConfigManager();
	await manager.load();

	const sub = args[0];
	if (sub === "set") {
		const provider = args[1] as "gemini" | "anthropic" | "ollama_cloud";
		const key = args[2] || "";
		if (!["gemini", "anthropic", "ollama_cloud"].includes(provider)) {
			console.error(
				"Invalid provider. Use: gemini, anthropic, or ollama_cloud",
			);
			return;
		}
		if (!key) {
			console.error(
				"API key is required. Usage: goli config set <provider> <key>",
			);
			return;
		}
		manager.setApiKey(provider, key);
		await manager.save();
		console.log(`API Key for ${provider} saved globally.`);
	} else {
		console.log("\n⚙️  Goli-CLI Global Configuration");
		console.log("Usage: goli config set <provider> <key>");
		console.log("Providers: gemini, anthropic, ollama_cloud");
	}
}
