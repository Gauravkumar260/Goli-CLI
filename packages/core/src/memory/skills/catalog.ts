/**
 * Skill catalog — index of all skills on disk.
 *
 * Reads SKILL.md frontmatter to build an in-memory index. Supports:
 *   - `list()`     — non-archived skills (L1 disclosure set)
 *   - `listAll()`  — including archived (for admin UI)
 *   - `get(name)`  — full skill (metadata + body)
 *   - `getMetadata(name)` — L1 only
 *   - `search(q)`  — name/description/trigger substring match
 *   - `findByTriggers(keywords)` — set-intersection match
 *   - `delete(name)` — remove a skill
 *
 * @module skills/catalog
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { listSkillDirs } from './writer.js';

import type { Skill, SkillCatalogOptions, SkillCategory, SkillMetadata } from './types.js';

/**
 * SkillCatalog — read-only index over the skills directory.
 */
export class SkillCatalog {
  private readonly skillsDir: string;

  constructor(opts: SkillCatalogOptions) {
    this.skillsDir = opts.skillsDir;
  }

  /** Number of non-archived skills. */
  get count(): number {
    return this.list().length;
  }

  /** List non-archived skill metadata (L1 set). */
  list(): SkillMetadata[] {
    return this.listAll().filter((m) => !m.archived);
  }

  /** List all skill metadata, including archived. */
  listAll(): SkillMetadata[] {
    const out: SkillMetadata[] = [];
    for (const name of listSkillDirs(this.skillsDir)) {
      const meta = this.parseFrontmatter(name);
      if (meta) out.push(meta);
    }
    return out;
  }

  /** Get the full skill (metadata + body) by name, or null. */
  get(name: string): Skill | null {
    const meta = this.getMetadata(name);
    if (!meta) return null;
    const body = this.readBody(name);
    return { metadata: meta, body };
  }

  /** Get the L1 metadata only, or null. */
  getMetadata(name: string): SkillMetadata | null {
    return this.parseFrontmatter(name);
  }

  /** Substring search across name, description, and triggers. */
  search(query: string): SkillMetadata[] {
    const q = query.toLowerCase();
    return this.list().filter((m) => {
      if (m.name.toLowerCase().includes(q)) return true;
      if (m.description.toLowerCase().includes(q)) return true;
      if (m.trigger.some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  /** Skills whose trigger set intersects the given keywords. */
  findByTriggers(keywords: string[]): SkillMetadata[] {
    const kw = new Set(keywords.map((k) => k.toLowerCase()));
    return this.list().filter((m) => m.trigger.some((t) => kw.has(t.toLowerCase())));
  }

  /** Delete a skill directory. Returns true if deleted, false if not found. */
  delete(name: string): boolean {
    const skillDir = join(this.skillsDir, name);
    if (!existsSync(skillDir)) return false;
    try {
      rmSync(skillDir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Internals ───────────────────────────────────────────────

  private parseFrontmatter(name: string): SkillMetadata | null {
    const file = join(this.skillsDir, name, 'SKILL.md');
    if (!existsSync(file)) return null;
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      return null;
    }
    return parseFrontmatterString(content, name);
  }

  private readBody(name: string): string {
    const file = join(this.skillsDir, name, 'SKILL.md');
    try {
      const content = readFileSync(file, 'utf-8');
      // Strip frontmatter (between leading --- and next ---)
      const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      return match?.[2] ?? content;
    } catch {
      return '';
    }
  }
}

/**
 * Parse YAML-like frontmatter into a SkillMetadata object.
 * This is a minimal parser — supports only the keys we write.
 * Exported for reuse by {@link SkillLoader}.
 */
export function parseFrontmatterString(content: string, fallbackName: string): SkillMetadata | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1] ?? '';

  const get = (key: string): string | null => {
    const m = yaml.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?$`, 'm'));
    return m?.[1] ?? null;
  };

  const getList = (key: string): string[] => {
    const m = yaml.match(new RegExp(`^${key}:\\s*\\[([\\s\\S]*?)\\]$`, 'm'));
    if (!m) return [];
    const inner = m[1] ?? '';
    return inner
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  };

  const name = get('name')?.replace(/^"|"$/g, '') ?? fallbackName;
  const description = get('description')?.replace(/^"|"$/g, '') ?? '';
  const category = (get('category')?.replace(/^"|"$/g, '') ?? 'general') as SkillCategory;
  const trigger = getList('trigger');
  const version = get('version')?.replace(/^"|"$/g, '') ?? '1.0.0';
  const authorRaw = get('author')?.replace(/^"|"$/g, '');
  const author: SkillMetadata['author'] = authorRaw === 'human' ? 'human' : 'agent';
  const lastImproved = get('lastImproved')?.replace(/^"|"$/g, '') ?? new Date().toISOString();
  const archivedRaw = get('archived');
  const archived = archivedRaw === 'true';

  return {
    name,
    description,
    category,
    trigger,
    version,
    author,
    lastImproved,
    archived,
  };
}
