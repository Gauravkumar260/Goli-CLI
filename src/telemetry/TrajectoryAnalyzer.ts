import { Database } from 'bun:sqlite';
import * as path from 'path';
import * as os from 'os';

const GOLI_CLI_HOME = process.env.GOLI_CLI_HOME || path.join(os.homedir(), '.goli_cli');

export interface TrajectoryMetrics {
  totalSessions: number;
  successRate: number;
  avgTurnsToSuccess: number;
  avgCostPerSession: number;
  avgLatencyMs: number;
  safetyFiringRate: number; // % of turns that hit safety denials
  toolEfficiency: Record<string, number>; // success rate per tool usage
}

export class TrajectoryAnalyzer {
  private db: Database;

  constructor() {
    const dbPath = path.join(GOLI_CLI_HOME, 'telemetry.sqlite');
    this.db = new Database(dbPath);
  }

  getMetrics(): TrajectoryMetrics {
    const totalSessions = (this.db.prepare("SELECT COUNT(DISTINCT session_id) FROM turns").get() as any)["COUNT(DISTINCT session_id)"];
    
    const successSessions = (this.db.prepare("SELECT COUNT(DISTINCT session_id) FROM turns WHERE event_type = 'stop' AND response = 'DONE'").get() as any)["COUNT(DISTINCT session_id)"];
    
    const avgTurns = (this.db.prepare(`
        SELECT AVG(turn_count) FROM (
            SELECT session_id, COUNT(*) as turn_count 
            FROM turns 
            WHERE session_id IN (SELECT session_id FROM turns WHERE event_type = 'stop')
            GROUP BY session_id
        )
    `).get() as any)["AVG(turn_count)"] || 0;

    const avgCost = (this.db.prepare("SELECT AVG(total_cost) FROM (SELECT session_id, SUM(cost_usd) as total_cost FROM turns GROUP BY session_id)").get() as any)["AVG(total_cost)"] || 0;
    
    const avgLatency = (this.db.prepare("SELECT AVG(latency_ms) FROM turns WHERE latency_ms > 0").get() as any)["AVG(latency_ms)"] || 0;

    const totalTurns = (this.db.prepare("SELECT COUNT(*) FROM turns").get() as any)["COUNT(*)"];
    const safetyTurns = (this.db.prepare("SELECT COUNT(*) FROM turns WHERE event_type = 'failure' AND response LIKE 'safety_denial%'").get() as any)["COUNT(*)"];

    return {
      totalSessions,
      successRate: totalSessions > 0 ? successSessions / totalSessions : 0,
      avgTurnsToSuccess: avgTurns,
      avgCostPerSession: avgCost,
      avgLatencyMs: avgLatency,
      safetyFiringRate: totalTurns > 0 ? safetyTurns / totalTurns : 0,
      toolEfficiency: {} // Complexity deferred
    };
  }

  close() {
    this.db.close();
  }
}
