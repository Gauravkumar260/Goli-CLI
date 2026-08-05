/**
 * SkillCatalog — indexes skills on disk and provides query APIs.
 *
 * Phase 9, ADR-0026.
 *
 * The catalog reads `<skillsDir>/<name>/SKILL.md` files, parses the
 * YAML frontmatter into `SkillMetadata`, and exposes list / get /
 * search / findByTriggers / delete operations.
 *
 * @module memory/skills/catalog
 */

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { SkillMetadataSchema } from './types.js';

import type { Skill, SkillMetadata, SkillCatalogOptions } from './types.js';

/**
 * SkillCatalog indexes skills on disk.
 */
export class SkillCatalog {
  private readonly skillsDir: string;

  constructor(opts: SkillCatalogOptions) {
    this.skillsDir = opts.skillsDir;
  }

  /** Number of active (non-archived) skills. */
  get count(): number {
    return this.list().length;
  }

  /** List all active (non-archived) skills. */
  list(): Skill[] {
    return this.listAll().filter((s) => !s.metadata.archived);
  }

  /** List all skills including archived ones. */
  listAll(): Skill[] {
    if (!existsSync(this.skillsDir)) {
      return [];
    }
    const entries = readdirSync(this.skillsDir, { withFileTypes: true });
    const skills: Skill[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skill = this.loadSkill(entry.name);
      if (skill) {
        skills.push(skill);
      }
    }
    return skills;
  }

  /** Get a skill by name (active or archived). Returns null if not found. */
  get(name: string): Skill | null {
    return this.loadSkill(name);
  }

  /** Get only the metadata for a skill. Returns null if not found. */
  getMetadata(name: string): SkillMetadata | null {
    const skill = this.loadSkill(name);
    return skill?.metadata ?? null;
  }

  /**
   * Search skills by query string. Matches against name, description,
   * and trigger keywords.
   */
  search(query: string): SkillMetadata[] {
    const q = query.toLowerCase();
    return this.list()
      .map((s) => s.metadata)
      .filter((m) => {
        return (
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.trigger.some((t) => t.toLowerCase().includes(q))
        );
      });
  }

  /**
   * Find skills whose trigger keywords match any of the provided keywords.
   * Case-insensitive substring match.
   */
  findByTriggers(keywords: string[]): SkillMetadata[] {
    const lower = keywords.map((k) => k.toLowerCase());
    return this.list()
      .map((s) => s.metadata)
      .filter((m) =>
        m.trigger.some((t) => lower.some((k) => t.toLowerCase().includes(k) || k.includes(t.toLowerCase()))),
      );
  }

  /** Delete a skill directory. Returns true if deleted, false if not found. */
  delete(name: string): boolean {
    const skillDir = join(this.skillsDir, name);
    if (!existsSync(skillDir)) {
      return false;
    }
    rmSync(skillDir, { recursive: true, force: true });
    return true;
  }

  /** Load and parse a skill from disk. Returns null if not found or invalid. */
  private loadSkill(name: string): Skill | null {
    const skillFile = join(this.skillsDir, name, 'SKILL.md');
    if (!existsSync(skillFile)) {
      return null;
    }
    try {
      const content = readFileSync(skillFile, 'utf-8');
      const metadata = this.parseFrontmatter(content, name);
      // P1-15 fix: validate the parsed metadata against the Zod
      // schema. Returns null if invalid (errors are logged). This
      // catches malformed YAML before it reaches the catalog.
      const validated = this.validateMetadata(metadata);
      if (validated === null) {
        return null;
      }
      const body = this.extractBody(content);
      return { metadata: validated, body };
    } catch {
      return null;
    }
  }

  /** Parse YAML frontmatter into SkillMetadata. */
  private parseFrontmatter(content: string, fallbackName: string): SkillMetadata {
    const lines = content.split('\n');
    const meta: Partial<SkillMetadata> = {
      name: fallbackName,
      description: '',
      trigger: [],
      category: 'implementation',
      version: '1.0.0',
      author: 'agent',
      lastImproved: new Date().toISOString(),
      archived: false,
    };

    let inFrontmatter = false;
    for (const line of lines) {
      if (line.trim() === '---') {
        if (!inFrontmatter) {
          inFrontmatter = true;
          continue;
        } else {
          break; // end of frontmatter
        }
      }
      if (!inFrontmatter) continue;

      const match = line.match(/^(\w+):\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;

      switch (key) {
        case 'name':
          meta.name = this.parseString(rawValue);
          break;
        case 'description':
          meta.description = this.parseString(rawValue);
          break;
        case 'trigger':
          meta.trigger = this.parseArray(rawValue);
          break;
        case 'category':
          meta.category = this.parseString(rawValue) as SkillMetadata['category'];
          break;
        case 'version':
          meta.version = this.parseString(rawValue);
          break;
        case 'author':
          meta.author = this.parseString(rawValue) as 'human' | 'agent';
          break;
        case 'lastImproved':
          meta.lastImproved = this.parseString(rawValue);
          break;
        case 'archived':
          meta.archived = this.parseBoolean(rawValue);
          break;
      }
    }

    return meta as SkillMetadata;
  }

  /**
   * P1-15 fix (remediation plan Phase 15): validate a parsed
   * `SkillMetadata` against the Zod `SkillMetadataSchema`. Returns
   * the validated metadata (with defaults applied) on success, or
   * `null` on failure with the reason logged.
   *
   * Called from `loadSkill()` after `parseFrontmatter()` to catch
   * malformed YAML before it pollutes the catalog. This is the
   * runtime side of the Zod migration — the TS type guarantees
   * compile-time safety; the Zod schema guarantees runtime safety
   * against hand-edited or LLM-generated SKILL.md files.
   */
  private validateMetadata(meta: SkillMetadata): SkillMetadata | null {
    const result = SkillMetadataSchema.safeParse(meta);
    if (result.success) {
      return result.data as SkillMetadata;
    }
    // Log the validation errors so the user can fix the SKILL.md file.
    // We don't throw — one bad skill shouldn't prevent the catalog from
    // loading the rest. SkillCatalog doesn't have a Logger field today
    // (Phase 9 didn't wire one), so we use console.warn directly. A
    // future enhancement could plumb a Logger through
    // SkillCatalogOptions.
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.warn(
      `[goli-core] Skill "${meta.name}" failed validation — skipping:\n${issues}`,
    );
    return null;
  }

  private parseString(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1).replace(/\\"/g, '"');
    }
    return trimmed;
  }

  private parseArray(raw: string): string[] {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1);
      return inner
        .split(',')
        .map((s) => this.parseString(s.trim()))
        .filter((s) => s.length > 0);
    }
    return [];
  }

  private parseBoolean(raw: string): boolean {
    return raw.trim().toLowerCase() === 'true';
  }

  private extractBody(content: string): string {
    const lines = content.split('\n');
    let endOfFrontmatter = -1;
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() === '---') {
        count++;
        if (count === 2) {
          endOfFrontmatter = i;
          break;
        }
      }
    }
    if (endOfFrontmatter < 0) {
      return content;
    }
    return lines.slice(endOfFrontmatter + 1).join('\n').trimStart();
  }
}
