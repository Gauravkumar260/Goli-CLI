import { Database } from 'bun:sqlite';
import * as path from 'path';
import * as os from 'os';

const GOLI_CLI_HOME = process.env.GOLI_CLI_HOME || path.join(os.homedir(), '.goli_cli');

export interface AcceptanceRecord {
    session_id: string;
    task_description: string;
    acceptance: 'yes' | 'no' | 'partial';
    comment?: string;
    ts: string;
}

export class AcceptanceSignal {
  private db: Database;

  constructor() {
    const dbPath = path.join(GOLI_CLI_HOME, 'telemetry.sqlite');
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS acceptance (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id      TEXT    NOT NULL,
        task_description TEXT,
        acceptance      TEXT    NOT NULL,
        comment         TEXT,
        ts              TEXT    NOT NULL
      );
    `);
  }

  record(record: AcceptanceRecord) {
    const query = this.db.prepare(`
      INSERT INTO acceptance (session_id, task_description, acceptance, comment, ts)
      VALUES (?, ?, ?, ?, ?)
    `);
    query.run(record.session_id, record.task_description, record.acceptance, record.comment || null, record.ts);
  }

  getStats() {
      return this.db.prepare(`
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN acceptance = 'yes' THEN 1 END) as accepted,
            COUNT(CASE WHEN acceptance = 'no' THEN 1 END) as rejected
        FROM acceptance
      `).get() as any;
  }

  close() {
    this.db.close();
  }
}
