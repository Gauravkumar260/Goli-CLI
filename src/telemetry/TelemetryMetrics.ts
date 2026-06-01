import { Database } from 'bun:sqlite';
import * as path from 'path';
import * as os from 'os';

const GOLI_CLI_HOME = process.env.GOLI_CLI_HOME || path.join(os.homedir(), '.goli_cli');

export class TelemetryMetrics {
  private db: Database;

  constructor() {
    const dbPath = path.join(GOLI_CLI_HOME, 'telemetry.sqlite');
    this.db = new Database(dbPath);
  }

  getOverview() {
    const stats = this.db.prepare(`
      SELECT 
        COUNT(DISTINCT session_id) as total_sessions,
        SUM(cost_usd) as total_cost,
        AVG(latency_ms) as avg_latency
      FROM turns
    `).get() as any;

    const completion = this.db.prepare(`
      SELECT 
        COUNT(CASE WHEN event_type = 'stop' THEN 1 END) as completed,
        COUNT(CASE WHEN event_type = 'failure' THEN 1 END) as failed
      FROM turns
      WHERE event_type IN ('stop', 'failure')
    `).get() as any;

    return { ...stats, ...completion };
  }

  getUsageByModel() {
    return this.db.prepare(`
      SELECT 
        model,
        COUNT(*) as turns,
        SUM(cost_usd) as cost,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens
      FROM turns
      WHERE model IS NOT NULL
      GROUP BY model
    `).all() as any[];
  }

  getSessionEvents(sessionId: string) {
    return this.db.prepare(`
      SELECT * FROM turns 
      WHERE session_id = ? 
      ORDER BY turn_number ASC, ts ASC
    `).all(sessionId);
  }

  close() {
    this.db.close();
  }
}
