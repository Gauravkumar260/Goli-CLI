import { Database } from 'bun:sqlite';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { createHash } from 'crypto';

const APEX_HOME = process.env.APEX_HOME || path.join(os.homedir(), '.apex');

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
  hitl_decision   TEXT
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
    const dbPath = path.join(APEX_HOME, 'telemetry.sqlite');
    
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    // Use fs.mkdirSync for initialization
    const fssync = require('fs');
    if (!fssync.existsSync(dir)) {
      fssync.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(CREATE_TURNS_TABLE_SQL);
  }

  log(event: TurnEvent) {
    const toolInputHash = event.toolInput 
      ? createHash('sha256').update(JSON.stringify(event.toolInput)).digest('hex')
      : null;

    const query = this.db.prepare(`
      INSERT INTO turns
        (session_id, trace_id, turn_number, ts, event_type, model, tool_name,
         tool_input_hash, tool_success, input_tokens, output_tokens, cache_tokens,
         cost_usd, latency_ms, safety_fired, hitl_decision)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
      event.hitlDecision || null
    );

    this.writeSessionLog(event);
  }

  private async writeSessionLog(event: TurnEvent) {
    const sessionLogPath = path.join(APEX_HOME, 'sessions', `${this.sessionId}.jsonl`);
    try {
      const dir = path.dirname(sessionLogPath);
      const fssync = require('fs');
      if (!fssync.existsSync(dir)) {
        fssync.mkdirSync(dir, { recursive: true });
      }
      await fs.appendFile(sessionLogPath, JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n', 'utf8');
    } catch (e) {
      console.error('Failed to write session log:', e);
    }
  }

  static getRecentSessions(limit: number = 3): any[] {
    const dbPath = path.join(APEX_HOME, 'telemetry.sqlite');
    const fssync = require('fs');
    if (!fssync.existsSync(dbPath)) return [];
    
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
