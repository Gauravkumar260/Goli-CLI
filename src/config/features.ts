import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

const GOLI_CLI_HOME = process.env.GOLI_CLI_HOME || path.join(os.homedir(), '.goli_cli');
const CONFIG_PATH = path.join(GOLI_CLI_HOME, 'config.json');

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
      api_keys: {}
  };

  async load() {
    try {
        const content = await fs.readFile(CONFIG_PATH, "utf8");
        this.config = JSON.parse(content);
        if (!this.config.anonymousUserId) {
            this.config.anonymousUserId = randomUUID();
            await this.save();
        }
        if (!this.config.api_keys) this.config.api_keys = {};
    } catch {
        this.config = { 
            anonymousUserId: randomUUID(),
            features: { ...DEFAULT_FLAGS },
            api_keys: {},
            telemetry_prompt_shown: false
        };
        await this.save();
    }
  }

  async save() {
    const dir = path.dirname(CONFIG_PATH);
    const fssync = require('fs');
    if (!fssync.existsSync(dir)) fssync.mkdirSync(dir, { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(this.config, null, 2), "utf8");
  }

  getFeature(name: keyof FeatureFlags): boolean {
    return this.config.features?.[name] ?? DEFAULT_FLAGS[name];
  }

  setFeature(name: keyof FeatureFlags, value: boolean) {
    if (!this.config.features) this.config.features = { ...DEFAULT_FLAGS };
    this.config.features[name] = value;
  }

  getApiKey(provider: 'gemini' | 'anthropic' | 'ollama_cloud'): string | undefined {
      return this.config.api_keys?.[provider] || process.env[`${provider.toUpperCase()}_API_KEY`];
  }

  setApiKey(provider: 'gemini' | 'anthropic' | 'ollama_cloud', key: string) {
      if (!this.config.api_keys) this.config.api_keys = {};
      this.config.api_keys[provider] = key;
  }

  getUserId(): string {
      return this.config.anonymousUserId;
  }

  isTelemetryPromptShown(): boolean {
      return !!this.config.telemetry_prompt_shown;
  }

  setTelemetryPromptShown(value: boolean) {
      this.config.telemetry_prompt_shown = value;
  }

  listFeatures() {
    return { ...DEFAULT_FLAGS, ...(this.config.features || {}) };
  }
}

export async function runFeatureCommand(args: string[]) {
    const manager = new ConfigManager();
    await manager.load();

    const sub = args[0];
    if (sub === 'list' || !sub) {
        console.log("\n🚩 Goli-CLI Feature Flags");
        const features = manager.listFeatures();
        Object.entries(features).forEach(([k, v]) => {
            console.log(`- ${k.padEnd(30)} : ${v ? '🟢 ON' : '⚪ OFF'}`);
        });
        console.log("");
    } else if (sub === 'enable' || sub === 'disable') {
        const name = args[1] as keyof FeatureFlags;
        if (!DEFAULT_FLAGS.hasOwnProperty(name)) {
            console.error(`Unknown feature: ${name}`);
            return;
        }
        manager.setFeature(name, sub === 'enable');
        await manager.save();
        console.log(`Feature ${name} ${sub}d.`);
    }
}

export async function runConfigCommand(args: string[]) {
    const manager = new ConfigManager();
    await manager.load();

    const sub = args[0];
    if (sub === 'set') {
        const provider = args[1] as any;
        const key = args[2] || ""; // Root Fix: handle undefined key
        if (!['gemini', 'anthropic', 'ollama_cloud'].includes(provider)) {
            console.error("Invalid provider. Use: gemini, anthropic, or ollama_cloud");
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
