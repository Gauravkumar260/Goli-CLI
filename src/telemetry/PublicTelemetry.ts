import { PostHog } from "posthog-node";
import { ConfigManager } from "../config/features";

// Token should be replaced at build time or via environment
const POSTHOG_TOKEN =
	process.env.POSTHOG_TOKEN || "phc_REPLACE_WITH_REAL_TOKEN_ONCE_READY";

export class PublicTelemetry {
	private client: PostHog | null = null;
	private config: ConfigManager;
	private initialized = false;

	constructor() {
		this.config = new ConfigManager();
	}

	async init(): Promise<void> {
		if (this.initialized) return;
		await this.config.load();
		const enabled = this.config.getFeature("enable_telemetry");
		const hasValidToken =
			POSTHOG_TOKEN?.startsWith("phc_") &&
			POSTHOG_TOKEN !== "phc_REPLACE_WITH_REAL_TOKEN_ONCE_READY";
		if (enabled && hasValidToken) {
			try {
				this.client = new PostHog(POSTHOG_TOKEN, {
					host: "https://app.posthog.com",
					flushAt: 20,
					flushInterval: 3000,
				});
			} catch (err) {
				console.warn("Failed to initialize telemetry client:", err);
				this.client = null;
			}
		}
		this.initialized = true;
	}

	track(event: string, properties: Record<string, any> = {}): void {
		if (!this.client) return;
		try {
			this.client.capture({
				distinctId: this.config.getUserId(),
				event,
				properties: {
					...properties,
					platform: process.platform,
					arch: process.arch,
					version: "0.1.0",
				},
			});
		} catch (err) {
			// Silent fail – telemetry should never block the main flow
			if (process.env.DEBUG) console.debug("Telemetry track error:", err);
		}
	}

	async flush(): Promise<void> {
		if (this.client) {
			await this.client.flush();
		}
	}

	async shutdown(): Promise<void> {
		if (this.client) {
			await this.client.shutdown();
			this.client = null;
		}
		this.initialized = false;
	}
}
