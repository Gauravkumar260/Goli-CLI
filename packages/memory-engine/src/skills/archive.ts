/**
 * SkillArchiver — auto-archives skills not improved in N days (ADR-0026).
 *
 * Archived skills are excluded from `SkillCatalog.list()` but remain
 * on disk (flagged via `archived: true` in the frontmatter). They can
 * be unarchived or deleted manually.
 *
 * @module memory/skills/archive
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SkillCatalog } from './catalog.js';

import type { SkillArchiverOptions } from './types.js';

/** Default archive threshold: 90 days. */
export const AUTO_ARCHIVE_DAYS = 90;

/** Milliseconds per day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * SkillArchiver handles auto-archival of stale skills.
 */
export class SkillArchiver {
  private readonly skillsDir: string;
  private readonly archiveAfterDays: number;
  private readonly catalog: SkillCatalog;

  constructor(opts: SkillArchiverOptions) {
    this.skillsDir = opts.skillsDir;
    this.archiveAfterDays = opts.archiveAfterDays ?? AUTO_ARCHIVE_DAYS;
    this.catalog = new SkillCatalog({ skillsDir: this.skillsDir });
  }

  /**
   * Archive all skills whose `lastImproved` date is older than the
   * threshold. Returns the number of skills archived.
   */
  archiveStale(): number {
    const now = Date.now();
    const threshold = this.archiveAfterDays * MS_PER_DAY;
    let count = 0;

    for (const skill of this.catalog.listAll()) {
      const lastImproved = new Date(skill.metadata.lastImproved).getTime();
      if (isNaN(lastImproved)) {
        continue;
      }
      if (now - lastImproved > threshold && !skill.metadata.archived) {
        if (this.setArchivedFlag(skill.metadata.name, true)) {
          count++;
        }
      }
    }
    return count;
  }

  /** Manually archive a skill. Returns true on success. */
  archiveSkill(name: string): boolean {
    return this.setArchivedFlag(name, true);
  }

  /** Unarchive a skill. Returns true on success. */
  unarchiveSkill(name: string): boolean {
    return this.setArchivedFlag(name, false);
  }

  /** Set or clear the `archived` flag in the SKILL.md frontmatter. */
  private setArchivedFlag(name: string, archived: boolean): boolean {
    const skillFile = join(this.skillsDir, name, 'SKILL.md');
    if (!existsSync(skillFile)) {
      return false;
    }
    try {
      const content = readFileSync(skillFile, 'utf-8');
      const updated = content.replace(
        /^archived:\s*(true|false)/m,
        `archived: ${archived}`,
      );
      if (updated === content) {
        // No archived field yet — inject it before the closing ---
        return this.injectArchivedField(skillFile, content, archived);
      }
      writeFileSync(skillFile, updated, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  /** Inject the `archived` field into frontmatter that doesn't have it. */
  private injectArchivedField(path: string, content: string, archived: boolean): boolean {
    const lines = content.split('\n');
    let lastFrontmatterLine = -1;
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() === '---') {
        count++;
        if (count === 2) {
          lastFrontmatterLine = i;
          break;
        }
      }
    }
    if (lastFrontmatterLine < 0) {
      return false;
    }
    lines.splice(lastFrontmatterLine, 0, `archived: ${archived}`);
    writeFileSync(path, lines.join('\n'), 'utf-8');
    return true;
  }
}
