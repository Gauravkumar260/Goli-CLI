/**
 * SkillWriter — extracts a reusable skill from a successful trajectory.
 *
 * Phase 9, ADR-0026 (Agent Skills spec).
 *
 * The writer examines a completed trajectory and, if it meets the
 * quality bar (success + 5+ tool calls), generates a `SKILL.md` file
 * with YAML frontmatter + a Markdown body. On subsequent runs for the
 * same task pattern, the version is incremented (1.0.0 → 1.0.1 → ...).
 *
 * @module memory/skills/writer
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  TrajectoryEntry,
  TrajectoryStep,
  Skill,
  SkillMetadata,
  SkillCategory,
  SkillWriterOptions,
} from './types.js';

/** Default minimum tool calls to justify creating a skill. */
const DEFAULT_MIN_TOOL_CALLS = 5;

/** Category detection keywords. */
const CATEGORY_KEYWORDS: Array<{ category: SkillCategory; patterns: RegExp[] }> = [
  { category: 'refactoring', patterns: [/refactor/i, /clean up/i, /simplify/i, /extract method/i] },
  { category: 'testing', patterns: [/write test/i, /unit test/i, /add test/i, /test coverage/i] },
  { category: 'debugging', patterns: [/fix/i, /debug/i, /crash/i, /bug/i, /error/i, /fail/i] },
  { category: 'code-review', patterns: [/review/i, /audit/i, /inspect/i, /check/i] },
  { category: 'documentation', patterns: [/document/i, /README/i, /comment/i, /JSDoc/i, /TSDoc/i] },
  { category: 'workflow', patterns: [/deploy/i, /CI\/CD/i, /pipeline/i, /automate/i] },
  { category: 'implementation', patterns: [/implement/i, /create/i, /build/i, /add feature/i] },
];

/**
 * SkillWriter creates skills from successful agent trajectories.
 */
export class SkillWriter {
  private readonly skillsDir: string;
  private readonly minToolCalls: number;

  constructor(opts: SkillWriterOptions) {
    this.skillsDir = opts.skillsDir;
    this.minToolCalls = opts.minToolCalls ?? DEFAULT_MIN_TOOL_CALLS;
  }

  /**
   * Decide whether a trajectory is worth saving as a skill.
   * Returns true iff: the task succeeded AND had >= minToolCalls tool calls.
   */
  shouldCreateSkill(trajectory: TrajectoryEntry): boolean {
    return trajectory.ok && trajectory.steps.length >= this.minToolCalls;
  }

  /**
   * Create a skill from a trajectory. Returns null if the trajectory
   * doesn't meet the quality bar. If a skill for the same task pattern
   * already exists, increments its version (improvement).
   *
   * P0-7 fix (remediation plan Phase 7): before overwriting an existing
   * skill, the current `SKILL.md` is archived to
   * `<skillsDir>/<name>/archive/v<version>-<timestamp>.md`. This
   * preserves the full version history so users can audit how a skill
   * evolved over time (and roll back if an agent-written improvement
   * regresses the skill).
   */
  createSkill(trajectory: TrajectoryEntry): Skill | null {
    if (!this.shouldCreateSkill(trajectory)) {
      return null;
    }

    const name = this.generateName(trajectory.task);
    const category = this.categorize(trajectory.task);
    const trigger = this.extractTriggers(trajectory.task);
    const description = this.generateDescription(trajectory.task);
    const existingVersion = this.findExistingVersion(name);

    // P0-7: archive the existing version BEFORE writing the new one.
    // The archive directory is `<skillsDir>/<name>/archive/`. Each
    // archived copy is named `v<version>-<timestamp>.md` so the
    // version number + archival time are visible at a glance.
    if (existingVersion !== null) {
      this.archiveOldVersion(name, existingVersion);
    }

    const version = this.incrementVersion(existingVersion ?? '1.0.0', existingVersion !== null);
    const lastImproved = new Date().toISOString();

    const metadata: SkillMetadata = {
      name,
      description,
      trigger,
      category,
      version,
      author: 'agent',
      lastImproved,
      archived: false,
    };

    const body = this.generateBody(trajectory);

    // Write to disk
    const skillDir = join(this.skillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    const content = this.serializeSkill(metadata, body);
    writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');

    return { metadata, body };
  }

  /**
   * P0-7 fix (remediation plan Phase 7): archive the current
   * `SKILL.md` for a skill before overwriting it with a new version.
   *
   * The archive copy is stored at
   * `<skillsDir>/<name>/archive/v<version>-<timestamp>.md`. The
   * `archive/` directory is created if it doesn't exist. Failures
   * are logged but don't block the write — the version history is a
   * best-effort audit trail, not a hard gate.
   */
  private archiveOldVersion(name: string, version: string): void {
    const skillFile = join(this.skillsDir, name, 'SKILL.md');
    if (!existsSync(skillFile)) return;
    const archiveDir = join(this.skillsDir, name, 'archive');
    try {
      mkdirSync(archiveDir, { recursive: true });
      const archivePath = join(archiveDir, `v${version}-${Date.now()}.md`);
      copyFileSync(skillFile, archivePath);
    } catch {
      // Best-effort — don't block the skill write if archiving fails.
    }
  }

  /**
   * P0-7: get the version history for a skill. Returns an array of
   * archive entries (newest first). Each entry has the version
   * number, archival timestamp, and archive file path.
   *
   * Returns an empty array when the skill has no archived versions
   * (i.e. it was only written once and never updated).
   */
  getVersionHistory(name: string): Array<{ version: string; archivedAt: number; archivePath: string }> {
    const archiveDir = join(this.skillsDir, name, 'archive');
    if (!existsSync(archiveDir)) return [];
    try {
      const files = readdirSync(archiveDir).sort().reverse(); // newest first
      const entries: Array<{ version: string; archivedAt: number; archivePath: string }> = [];
      for (const file of files) {
        const match = file.match(/^v(.+)-(\d+)\.md$/);
        if (match) {
          entries.push({
            version: match[1]!,
            archivedAt: parseInt(match[2]!, 10),
            archivePath: join(archiveDir, file),
          });
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  /** Generate a kebab-case skill name from the task description. */
  private generateName(task: string): string {
    const words = task
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .slice(0, 5);
    return words.join('-') || 'unnamed-skill';
  }

  /** Detect the skill category from the task description. */
  private categorize(task: string): SkillCategory {
    for (const { category, patterns } of CATEGORY_KEYWORDS) {
      if (patterns.some((p) => p.test(task))) {
        return category;
      }
    }
    return 'implementation';
  }

  /** Extract trigger keywords from the task description. */
  private extractTriggers(task: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'to', 'and', 'or', 'in', 'on', 'at', 'for', 'of', 'with',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
      'module', 'file', 'code', 'function', 'method',
    ]);
    const words = task
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));
    const unique = [...new Set(words)];
    return unique.slice(0, 8);
  }

  /** Generate a one-line description from the task. */
  private generateDescription(task: string): string {
    const trimmed = task.trim().replace(/\s+/g, ' ');
    return trimmed.length > 100 ? trimmed.slice(0, 97) + '...' : trimmed;
  }

  /** Find the version of an existing skill with the same name. */
  private findExistingVersion(name: string): string | null {
    const skillFile = join(this.skillsDir, name, 'SKILL.md');
    if (!existsSync(skillFile)) {
      return null;
    }
    try {
      const content = readFileSync(skillFile, 'utf-8');
      const match = content.match(/^version:\s*"?([^"\n]+)"?/m);
      return match?.[1]?.trim() ?? null;
    } catch {
      return null;
    }
  }

  /** Increment a semver patch version. */
  private incrementVersion(current: string, exists: boolean): string {
    const parts = current.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 3 || parts.some(isNaN)) {
      return '1.0.0';
    }
    if (!exists) {
      return '1.0.0';
    }
    parts[2]! += 1;
    return parts.join('.');
  }

  /** Generate the Markdown body from the trajectory steps. */
  private generateBody(trajectory: TrajectoryEntry): string {
    const lines: string[] = [
      '## Steps',
      '',
      ...trajectory.steps.map((step, i) => this.formatStep(step, i + 1)),
      '',
      '## Outcome',
      '',
      trajectory.ok ? 'Task completed successfully.' : 'Task failed.',
      '',
      `Tokens used: ${trajectory.tokensUsed.toLocaleString()}`,
      `Duration: ${(trajectory.durationMs / 1000).toFixed(1)}s`,
    ];
    return lines.join('\n');
  }

  /** Format a single trajectory step as a Markdown list item. */
  private formatStep(step: TrajectoryStep, num: number): string {
    const argsStr = Object.entries(step.args)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v).slice(0, 60)}`)
      .join(', ');
    return `${num}. **${step.tool}** \`${argsStr}\` → ${step.ok ? '✓' : '✗'} ${step.result.slice(0, 80)}`;
  }

  /** Serialize metadata + body into a SKILL.md file with YAML frontmatter. */
  private serializeSkill(metadata: SkillMetadata, body: string): string {
    const frontmatter = [
      '---',
      `name: "${metadata.name}"`,
      `description: "${metadata.description.replace(/"/g, '\\"')}"`,
      `trigger: [${metadata.trigger.map((t) => `"${t}"`).join(', ')}]`,
      `category: "${metadata.category}"`,
      `version: "${metadata.version}"`,
      `author: "${metadata.author}"`,
      `lastImproved: "${metadata.lastImproved}"`,
      `archived: ${metadata.archived}`,
      '---',
      '',
    ].join('\n');
    return frontmatter + body;
  }
}
