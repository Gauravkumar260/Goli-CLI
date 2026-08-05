/**
 * JSONL session store with resume and branching (H16).
 *
 * Persists agent conversations to disk as JSONL (one JSON object per
 * line) so they can be resumed or branched in a later session.
 *
 * ## Storage layout
 *
 *   ~/.goli-cli/sessions/
 *     <session-id>.meta.json   — metadata (id, createdAt, parentId, prompt, ...)
 *     <session-id>.jsonl       — full message transcript (one Message per line)
 *
 * ## Resume vs branch
 *
 * - **Resume**: load a session by ID, restore its messages into a new
 *   `ConversationState`, continue the conversation.
 * - **Branch**: load a session by ID, copy its messages into a NEW
 *   session (with a new ID and `parentId` pointing at the original),
 *   optionally truncated to a specific message index.
 *
 * ## Why JSONL (not a single JSON blob)?
 *
 * - Append-only writes are O(1) — no need to read+rewrite the whole
 *   file on every message.
 * - A corrupted line affects only that message, not the whole session.
 * - Easy to tail/grep for debugging.
 *
 * ## Crash safety
 *
 * Each `appendMessage` call opens the file in append mode, writes one
 * line, and closes. A crash mid-write loses at most the in-flight line.
 *
 * @module memory/session/jsonl-store
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  rmSync,
  renameSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Message, AgentRole } from '@goli-cli/shared';

/**
 * Metadata for a saved session.
 *
 * Stored as `<id>.meta.json` alongside the `<id>.jsonl` transcript.
 */
export interface SessionMetadata {
  /** Unique session ID (UUID). */
  id: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
  /** Parent session ID (set when this session was branched from another). */
  parentId?: string;
  /** The first user prompt (used as a summary in `listSessions`). */
  prompt: string;
  /** The agent role. */
  role: AgentRole;
  /** Number of messages in the transcript. */
  messageCount: number;
  /** Total tokens consumed (input + output + thinking). */
  totalTokens: number;
  /** Number of loop iterations completed. */
  iterations: number;
  /** Tags (user-settable, for organization). */
  tags: string[];
  /** The workspace root at the time of the session. */
  workspaceRoot: string;
  /** The git branch at the time of the session (for context). */
  branch?: string;
}

/**
 * A loaded session (metadata + messages).
 */
export interface LoadedSession {
  metadata: SessionMetadata;
  messages: Message[];
}

/**
 * Options for constructing a {@link JsonlSessionStore}.
 */
export interface JsonlSessionStoreOptions {
  /** The directory for session files (default: ~/.goli-cli/sessions/). */
  sessionsDir?: string;
}

/**
 * JSONL-backed session store.
 *
 * Usage:
 * ```ts
 * const store = new JsonlSessionStore();
 * const session = store.createSession({ prompt: 'Fix the bug', role: 'orchestrator', workspaceRoot: process.cwd() });
 * store.appendMessage(session.metadata.id, userMessage);
 * // ... later ...
 * const loaded = store.resume(session.metadata.id);
 * const branched = store.branch(session.metadata.id);
 * ```
 */
export class JsonlSessionStore {
  private readonly sessionsDir: string;

  constructor(opts: JsonlSessionStoreOptions = {}) {
    this.sessionsDir = opts.sessionsDir ?? this.defaultSessionsDir();
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /** Default sessions directory: ~/.goli-cli/sessions/ */
  private defaultSessionsDir(): string {
    const home = homedir();
    const goliHome = process.env['GOLI_HOME'] ?? join(home, '.goli-cli');
    return join(goliHome, 'sessions');
  }

  /**
   * Create a new session.
   *
   * @param input - The session parameters.
   * @param input.prompt
   * @param input.role
   * @param input.workspaceRoot
   * @param input.branch
   * @param input.parentId
   * @param input.tags
   * @returns The new session metadata.
   */
  createSession(input: {
    prompt: string;
    role: AgentRole;
    workspaceRoot: string;
    branch?: string;
    parentId?: string;
    tags?: string[];
  }): SessionMetadata {
    const id = randomUUID();
    const now = new Date().toISOString();
    const metadata: SessionMetadata = {
      id,
      createdAt: now,
      updatedAt: now,
      parentId: input.parentId,
      prompt: input.prompt,
      role: input.role,
      messageCount: 0,
      totalTokens: 0,
      iterations: 0,
      tags: input.tags ?? [],
      workspaceRoot: input.workspaceRoot,
      branch: input.branch,
    };
    this.writeMetadata(metadata);
    // Create an empty JSONL file.
    writeFileSync(this.messagesPath(id), '', 'utf-8');
    return metadata;
  }

  /**
   * Append a message to a session's transcript.
   *
   * @param sessionId - The session ID.
   * @param message - The message to append.
   */
  appendMessage(sessionId: string, message: Message): void {
    const line = JSON.stringify(message) + '\n';
    appendFileSync(this.messagesPath(sessionId), line, 'utf-8');
    // Update metadata messageCount + updatedAt.
    const metadata = this.readMetadata(sessionId);
    if (metadata) {
      metadata.messageCount++;
      metadata.updatedAt = new Date().toISOString();
      this.writeMetadata(metadata);
    }
  }

  /**
   * Update session metadata (e.g., after each iteration to track tokens).
   *
   * @param sessionId - The session ID.
   * @param updates - Partial metadata to merge.
   */
  updateMetadata(sessionId: string, updates: Partial<SessionMetadata>): void {
    const metadata = this.readMetadata(sessionId);
    if (!metadata) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    Object.assign(metadata, updates, { updatedAt: new Date().toISOString() });
    this.writeMetadata(metadata);
  }

  /**
   * Resume a session by ID.
   *
   * Loads the metadata + message transcript. The caller is responsible
   * for reconstructing the `ConversationState` from the messages.
   *
   * @param sessionId - The session ID.
   * @returns The loaded session, or null if not found.
   */
  resume(sessionId: string): LoadedSession | null {
    const metadata = this.readMetadata(sessionId);
    if (!metadata) return null;
    const messages = this.readMessages(sessionId);
    return { metadata, messages };
  }

  /**
   * Branch a session.
   *
   * Creates a new session with `parentId` set to the original. The
   * message transcript is copied (optionally truncated to
   * `branchPoint`).
   *
   * @param sessionId - The session to branch from.
   * @param branchPoint - Optional message index to branch at (0-based).
   *                      If omitted, copies the full transcript.
   * @returns The new (branched) session metadata.
   */
  branch(sessionId: string, branchPoint?: number): SessionMetadata {
    const original = this.resume(sessionId);
    if (!original) {
      throw new Error(`Cannot branch: session not found: ${sessionId}`);
    }
    const messages = branchPoint !== undefined
      ? original.messages.slice(0, branchPoint)
      : original.messages;
    const child = this.createSession({
      prompt: original.metadata.prompt,
      role: original.metadata.role,
      workspaceRoot: original.metadata.workspaceRoot,
      branch: original.metadata.branch,
      parentId: sessionId,
      tags: [...original.metadata.tags, 'branched'],
    });
    // Write the truncated transcript. The previous
    // implementation did `writeFileSync(...)` outside any
    // try/catch — if it failed (disk full, permissions), the
    // child session existed with empty JSONL and
    // `messageCount: 0`, but the caller expected N messages. No
    // rollback, so the orphan child session remained. We now
    // wrap in try/catch and delete the orphan child on failure.
    if (messages.length > 0) {
      try {
        const lines = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
        writeFileSync(this.messagesPath(child.id), lines, 'utf-8');
        child.messageCount = messages.length;
        this.writeMetadata(child);
      } catch (err) {
        // Rollback: delete the orphan child session (metadata
        // + empty JSONL) so the caller doesn't get a half-baked
        // branch with no transcript.
        try {
          rmSync(this.messagesPath(child.id), { force: true });
        } catch { /* ignore */ }
        try {
          rmSync(this.metadataPath(child.id), { force: true });
        } catch { /* ignore */ }
        throw new Error(`Branch failed while writing transcript: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return child;
  }

  /**
   * List all saved sessions (metadata only).
   *
   * @returns Array of session metadata, sorted by `updatedAt` descending.
   */
  listSessions(): SessionMetadata[] {
    if (!existsSync(this.sessionsDir)) return [];
    const files = readdirSync(this.sessionsDir);
    const metaFiles = files.filter((f) => f.endsWith('.meta.json'));
    const sessions: SessionMetadata[] = [];
    for (const file of metaFiles) {
      try {
        const content = readFileSync(join(this.sessionsDir, file), 'utf-8');
        sessions.push(JSON.parse(content) as SessionMetadata);
      } catch {
        // Skip corrupted metadata files.
      }
    }
    // Sort by updatedAt descending (most recent first).
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sessions;
  }

  /**
   * Delete a session (metadata + transcript).
   *
   * @param sessionId - The session ID.
   * @returns True if the session was deleted, false if not found.
   */
  deleteSession(sessionId: string): boolean {
    const metaPath = this.metadataPath(sessionId);
    const msgPath = this.messagesPath(sessionId);
    let deleted = false;
    if (existsSync(metaPath)) {
      try {
        rmSync(metaPath, { force: true });
        deleted = true;
      } catch {
        // Best-effort.
      }
    }
    if (existsSync(msgPath)) {
      try {
        rmSync(msgPath, { force: true });
        deleted = true;
      } catch {
        // Best-effort.
      }
    }
    return deleted;
  }

  // ─── Path helpers ──────────────────────────────────────────

  private metadataPath(sessionId: string): string {
    return resolve(this.sessionsDir, `${sessionId}.meta.json`);
  }

  private messagesPath(sessionId: string): string {
    return resolve(this.sessionsDir, `${sessionId}.jsonl`);
  }

  private writeMetadata(metadata: SessionMetadata): void {
    // Atomic write via tmp + rename. The previous
    // implementation used `writeFileSync(this.metadataPath(...))`
    // directly — if the process crashed mid-write, the metadata
    // JSON was truncated / partially written, and the next reader
    // got a corrupt session metadata. `rename` is atomic on POSIX
    // filesystems, so a crash before rename leaves the OLD
    // metadata intact.
    const path = this.metadataPath(metadata.id);
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(metadata, null, 2), 'utf-8');
    try {
      renameSync(tmp, path);
    } catch (err) {
      try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw err;
    }
  }

  private readMetadata(sessionId: string): SessionMetadata | null {
    const path = this.metadataPath(sessionId);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as SessionMetadata;
    } catch {
      return null;
    }
  }

  private readMessages(sessionId: string): Message[] {
    const path = this.messagesPath(sessionId);
    if (!existsSync(path)) return [];
    const content = readFileSync(path, 'utf-8');
    if (content.length === 0) return [];
    const messages: Message[] = [];
    for (const line of content.split('\n')) {
      if (line.length === 0) continue;
      try {
        messages.push(JSON.parse(line) as Message);
      } catch {
        // Skip corrupted lines (best-effort).
      }
    }
    return messages;
  }
}
