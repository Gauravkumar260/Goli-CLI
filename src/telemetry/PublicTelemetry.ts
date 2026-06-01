import { PostHog } from 'posthog-node';
import { ConfigManager } from '../config/features';

const POSTHOG_TOKEN = 'phc_REPLACE_WITH_REAL_TOKEN_ONCE_READY'; // Setup instruction in Section 9

export class PublicTelemetry {
  private client: PostHog | null = null;
  private config: ConfigManager;

  constructor() {
    this.config = new ConfigManager();
  }

  async init() {
    await this.config.load();
    if (this.config.getFeature('enable_telemetry') && POSTHOG_TOKEN.startsWith('phc_')) {
      this.client = new PostHog(POSTHOG_TOKEN, {
        host: 'https://app.posthog.com'
      });
    }
  }

  track(event: string, properties: any = {}) {
    if (this.client) {
      this.client.capture({
        distinctId: this.config.getUserId(),
        event: event,
        properties: {
            ...properties,
            platform: process.platform,
            arch: process.arch,
            version: '0.1.0'
        }
      });
    }
  }

  async shutdown() {
    if (this.client) {
      await this.client.shutdown();
    }
  }
}
