import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

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
  enable_telemetry: false, // Privacy first
  use_pro_grader: false,
  aggressive_compaction: true,
  experimental_parallel_execution: false,
  verbose_logging: false,
};

export class ConfigManager {
  private config: any = {};

  async load() {
    try {
        const content = await fs.readFile(CONFIG_PATH, "utf8");
        this.config = JSON.parse(content);
    } catch {
        this.config = { features: { ...DEFAULT_FLAGS } };
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

  listFeatures() {
    return { ...DEFAULT_FLAGS, ...(this.config.features || {}) };
  }
}

export async function runFeatureCommand(args: string[]) {
    const manager = new ConfigManager();
    await manager.load();

    const sub = args[0];
    if (sub === 'list' || !sub) {
        console.log("\n🚩 Goli_CLI Feature Flags");
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
