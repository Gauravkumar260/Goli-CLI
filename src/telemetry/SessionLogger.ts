import { Database } from 'bun:sqlite';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { createHash } from 'crypto';

const GOLI_CLI_HOME = process.env.GOLI_CLI_HOME || path.join(os.homedir(), '.goli_cli');

const CREATE_TURNS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS turns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT    NOT NULL,
  trace_id        TEXT    NOT NULL,
  turn_number     INTEGER NOT NULL,
  ts              TEXT    NOT NULL,
  event_type      TEXT    NOT NULL,
  model           TEXT,
  tool_name       TEXT,
  tool_input_hash TEXT,
  tool_success    INTEGER,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cache_tokens    INTEGER,
  cost_usd        REAL,
  latency_ms      INTEGER,
  safety_fired    INTEGER DEFAULT 0,
  hitl_decision   TEXT,
  response        TEXT
);
CREATE INDEX IF NOT EXISTS idx_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_ts ON turns(ts);
`;

export interface TurnEvent {
  turn: number;
  type: 'tool_call' | 'model_response' | 'hitl' | 'compaction' | 'stop' | 'failure' | 'start';
  model?: string;
  toolName?: string;
  toolInput?: any;
  toolSuccess?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  safetyFired?: boolean;
  hitlDecision?: string;
  response?: string;
}

export class SessionLogger {
  private db: Database;
  private traceId: string;

  constructor(private sessionId: string) {
    this.traceId = createHash('sha256').update(Date.now().toString()).digest('hex').substring(0, 16);
    const dbPath = path.join(GOLI_CLI_HOME, 'telemetry.sqlite');

    const dir = path.dirname(dbPath);
    if (!require('fs').existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    
    // Add column if it doesn't exist (incremental fix)
    try {
        this.db.exec(CREATE_TURNS_TABLE_SQL);
        this.db.exec("ALTER TABLE turns ADD COLUMN response TEXT;");
    } catch (e) {}
  }

  log(event: TurnEvent) {
    const toolInputHash = event.toolInput
      ? createHash('sha256').update(JSON.stringify(event.toolInput)).digest('hex')
      : null;

    const query = this.db.prepare(`
      INSERT INTO turns
        (session_id, trace_id, turn_number, ts, event_type, model, tool_name,
         tool_input_hash, tool_success, input_tokens, output_tokens, cache_tokens,
         cost_usd, latency_ms, safety_fired, hitl_decision, response)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    query.run(
      this.sessionId,
      this.traceId,
      event.turn,
      new Date().toISOString(),
      event.type,
      event.model || null,
      event.toolName || null,
      toolInputHash,
      event.toolSuccess === undefined ? null : (event.toolSuccess ? 1 : 0),
      event.inputTokens || null,
      event.outputTokens || null,
      event.cacheTokens || null,
      event.costUsd || null,
      event.latencyMs || null,
      event.safetyFired ? 1 : 0,
      event.hitlDecision || null,
      event.response || null
    );

    this.writeSessionLog(event);
  }

  private async writeSessionLog(event: TurnEvent) {
    const sessionLogPath = path.join(GOLI_CLI_HOME, 'sessions', `${this.sessionId}.jsonl`);
    try {
      const dir = path.dirname(sessionLogPath);
      if (!require('fs').existsSync(dir)) {
        require('fs').mkdirSync(dir, { recursive: true });
      }
      await fs.appendFile(sessionLogPath, JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n', 'utf8');
    } catch (e) {
      console.error('Failed to write session log:', e);
    }
  }

  static getRecentSessions(limit: number = 3): any[] {
    const dbPath = path.join(GOLI_CLI_HOME, 'telemetry.sqlite');
    if (!require('fs').existsSync(dbPath)) return [];

    const db = new Database(dbPath);
    const sessions = db.prepare(`
      SELECT DISTINCT session_id, MAX(ts) as last_active
      FROM turns
      GROUP BY session_id
      ORDER BY last_active DESC
      LIMIT ?
    `).all(limit);
    db.close();
    return sessions;
  }

  close() {
    this.db.close();
  }
}
