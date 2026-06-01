import * as fs from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";

export interface AuditEntry {
  ts: string;
  session: string;
  tool: string;
  payload_hash: string;
  decision: string;
  latency_ms: number;
  prev_hash: string;
  entry_hash: string;
}

const GOLI_CLI_HOME = process.env.GOLI_CLI_HOME || path.join(require('os').homedir(), '.goli_cli');

export class AuditLog {
  static async log(session: string, tool: string, payload: any, decision: string, latency: number) {
    const auditPath = path.join(GOLI_CLI_HOME, "audit.jsonl");
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    
    let prevHash = "0".repeat(64);
    
    try {
      const dir = path.dirname(auditPath);
      const fssync = require('fs');
      if (!fssync.existsSync(dir)) {
        fssync.mkdirSync(dir, { recursive: true });
      }

      if (fssync.existsSync(auditPath)) {
        const content = await fs.readFile(auditPath, "utf8");
        const lines = content.trim().split("\n");
        const lastLine = lines[lines.length - 1];
        if (lines.length > 0 && lastLine) {
          const lastEntry = JSON.parse(lastLine) as AuditEntry;
          prevHash = lastEntry.entry_hash;
        }
      }

      const ts = new Date().toISOString();
      const entryBase = {
        ts,
        session,
        tool,
        payload_hash: payloadHash,
        decision,
        latency_ms: latency,
        prev_hash: prevHash,
      };

      const entryHash = createHash("sha256").update(JSON.stringify(entryBase)).digest("hex");
      const entry: AuditEntry = { ...entryBase, entry_hash: entryHash };

      await fs.appendFile(auditPath, JSON.stringify(entry) + "\n", "utf8");
    } catch (e) {
      console.error("Failed to write audit log:", e);
    }
  }

  static async verify(): Promise<{ valid: boolean; error?: string; count: number }> {
    const auditPath = path.join(GOLI_CLI_HOME, "audit.jsonl");
    const fssync = require('fs');
    if (!fssync.existsSync(auditPath)) {
      return { valid: true, count: 0 };
    }

    try {
      const content = await fs.readFile(auditPath, "utf8");
      const lines = content.trim().split("\n");
      let expectedPrevHash = "0".repeat(64);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const entry = JSON.parse(line) as AuditEntry;
        
        if (entry.prev_hash !== expectedPrevHash) {
          return { valid: false, error: `Hash chain broken at line ${i+1}: expected prev_hash ${expectedPrevHash}, found ${entry.prev_hash}`, count: i };
        }

        const entryBase = {
          ts: entry.ts,
          session: entry.session,
          tool: entry.tool,
          payload_hash: entry.payload_hash,
          decision: entry.decision,
          latency_ms: entry.latency_ms,
          prev_hash: entry.prev_hash,
        };
        const actualHash = createHash("sha256").update(JSON.stringify(entryBase)).digest("hex");

        if (entry.entry_hash !== actualHash) {
          return { valid: false, error: `Entry hash mismatch at line ${i+1}: expected ${actualHash}, found ${entry.entry_hash}`, count: i };
        }

        expectedPrevHash = entry.entry_hash;
      }

      return { valid: true, count: lines.length };
    } catch (e: any) {
      return { valid: false, error: `Verification failed: ${e.message}`, count: 0 };
    }
  }
}
