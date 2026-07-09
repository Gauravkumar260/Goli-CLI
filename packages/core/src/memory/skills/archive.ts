/**
 * Skill archiver — auto-archive skills that haven't been improved in N days.
 *
 * Archived skills:
 *   - Are excluded from `SkillCatalog.list()` (L1 disclosure set).
 *   - Are still present on disk (not deleted).
 *   - Can be unarchived.
 *
 * Default stale threshold: 90 days (per ADR-0027).
 *
 * @module skills/archive
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SkillCatalog } from './catalog.js';

import type { SkillArchiverOptions } from './types.js';

/** Default days of inactivity before a skill is archived. */
export const AUTO_ARCHIVE_DAYS = 90;

/**
 * SkillArchiver — manages skill archival lifecycle.
 */
export class SkillArchiver {
  private readonly skillsDir: string;
  private readonly staleDays: number;
  private readonly catalog: SkillCatalog;

  constructor(opts: SkillArchiverOptions) {
    this.skillsDir = opts.skillsDir;
    this.staleDays = opts.staleDays ?? AUTO_ARCHIVE_DAYS;
    this.catalog = new SkillCatalog({ skillsDir: this.skillsDir });
  }

  /** Archive all skills older than `staleDays`. Returns count archived. */
  archiveStale(): number {
    const cutoff = Date.now() - this.staleDays * 24 * 60 * 60 * 1000;
    let count = 0;
    for (const meta of this.catalog.listAll()) {
      if (meta.archived) continue;
      const improved = Date.parse(meta.lastImproved);
      if (Number.isNaN(improved)) continue;
      if (improved < cutoff) {
        if (this.setArchivedFlag(meta.name, true)) count++;
      }
    }
    return count;
  }

  /** Manually archive a single skill by name. */
  archiveSkill(name: string): boolean {
    return this.setArchivedFlag(name, true);
  }

  /** Restore an archived skill. */
  unarchiveSkill(name: string): boolean {
    return this.setArchivedFlag(name, false);
  }

  // ─── Internals ───────────────────────────────────────────────

  private setArchivedFlag(name: string, archived: true): boolean;
  private setArchivedFlag(name: string, archived: false): boolean;
  private setArchivedFlag(name: string, archived: boolean): boolean {
    const file = join(this.skillsDir, name, 'SKILL.md');
    if (!existsSync(file)) return false;
    try {
      const content = readFileSync(file, 'utf-8');
      let updated: string;
      if (archived) {
        // Add `archived: true` after the opening frontmatter or before the closing
        if (/^archived:\s*true/m.test(content)) return true; // already archived
        if (/^archived:\s*false/m.test(content)) {
          updated = content.replace(/^archived:\s*false$/m, 'archived: true');
        } else {
          // Insert before closing ---
          updated = content.replace(/^(---)$/, `archived: true\n$1`);
          if (updated === content) {
            // Fallback: insert right after the opening ---
            updated = content.replace(/^---\n/, '---\narchived: true\n');
          }
        }
      } else {
        if (!/^archived:\s*true/m.test(content)) return true; // already not archived
        updated = content.replace(/^archived:\s*true$/m, 'archived: false');
      }
      writeFileSync(file, updated, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }
}
