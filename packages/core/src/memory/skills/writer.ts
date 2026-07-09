/**
 * Skill writer — extracts a reusable skill from a successful trajectory.
 *
 * Trajectories with 5+ tool calls that succeeded become skills. The writer:
 *   1. Generates a kebab-case name from the task description.
 *   2. Categorizes by keywords (refactor/test/debug/etc.).
 *   3. Extracts trigger keywords from the task and tool args.
 *   4. Renders the SKILL.md (YAML frontmatter + Markdown body).
 *   5. Increments version if the skill already exists (improvement).
 *
 * @module skills/writer
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  Skill,
  SkillCategory,
  SkillMetadata,
  SkillWriterOptions,
  TrajectoryEntry,
} from './types.js';

/** Default minimum tool calls to write a skill. */
export const DEFAULT_MIN_TOOL_CALLS = 5;

/**
 * SkillWriter — creates and improves skills from trajectories.
 */
export class SkillWriter {
  private readonly skillsDir: string;
  private readonly minToolCalls: number;

  constructor(opts: SkillWriterOptions) {
    this.skillsDir = opts.skillsDir;
    this.minToolCalls = opts.minToolCalls ?? DEFAULT_MIN_TOOL_CALLS;
  }

  /**
   * Decide whether a trajectory merits a skill.
   *   - Task must have succeeded.
   *   - At least `minToolCalls` tool invocations.
   */
  shouldCreateSkill(traj: TrajectoryEntry): boolean {
    if (!traj.ok) return false;
    if (!traj.steps || traj.steps.length < this.minToolCalls) return false;
    return true;
  }

  /**
   * Create a skill from a trajectory. Returns null if the trajectory
   * does not meet the threshold ({@link shouldCreateSkill}).
   *
   * If a skill with the same name already exists, the version is
   * incremented (patch-level) and `lastImproved` is updated.
   */
  createSkill(traj: TrajectoryEntry): Skill | null {
    if (!this.shouldCreateSkill(traj)) return null;

    const name = this.deriveName(traj.task);
    const category = this.categorize(traj.task);
    const trigger = this.extractTriggers(traj);
    const existingVersion = this.readExistingVersion(name);
    const version = this.bumpVersion(existingVersion);
    const now = new Date().toISOString();

    const metadata: SkillMetadata = {
      name,
      description: traj.task.slice(0, 120),
      category,
      trigger,
      version,
      author: 'agent',
      lastImproved: now,
      archived: false,
    };

    const body = this.renderBody(traj, metadata);
    this.persist(metadata, body);

    return { metadata, body };
  }

  // ─── Internals ───────────────────────────────────────────────

  private deriveName(task: string): string {
    const stopwords = new Set([
      'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with',
      'module', 'flow', 'system', 'that', 'this', 'is', 'was', 'use', 'using',
    ]);
    const words = task
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopwords.has(w));
    const picked = words.slice(0, 4).join('-');
    return picked || 'unnamed-skill';
  }

  private categorize(task: string): SkillCategory {
    const t = task.toLowerCase();
    if (/\brefactor\b/.test(t)) return 'refactoring';
    if (/\b(test|tests|testing|unit test|spec)\b/.test(t)) return 'testing';
    if (/\b(fix|debug|crash|bug|error|fail)\b/.test(t)) return 'debugging';
    if (/\b(review|lint|audit)\b/.test(t)) return 'code-review';
    if (/\b(doc|document|readme|comment)\b/.test(t)) return 'documentation';
    if (/\b(perf|optim|fast|slow|benchmark)\b/.test(t)) return 'performance';
    if (/\b(security|vuln|cve|secret)\b/.test(t)) return 'security';
    if (/\b(deploy|release|ship|ci|cd)\b/.test(t)) return 'deployment';
    if (/\b(workflow|pipeline|automate)\b/.test(t)) return 'workflow';
    return 'general';
  }

  private extractTriggers(traj: TrajectoryEntry): string[] {
    const triggers = new Set<string>();
    const t = traj.task.toLowerCase();
    const words = t
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    for (const w of words.slice(0, 6)) triggers.add(w);
    // Also include any tool names that recur
    const toolCounts = new Map<string, number>();
    for (const step of traj.steps) {
      toolCounts.set(step.tool, (toolCounts.get(step.tool) ?? 0) + 1);
    }
    for (const [tool, count] of toolCounts) {
      if (count >= 2) triggers.add(tool);
    }
    return Array.from(triggers).slice(0, 10);
  }

  private readExistingVersion(name: string): string | null {
    const skillDir = join(this.skillsDir, name, 'SKILL.md');
    if (!existsSync(skillDir)) return null;
    try {
      const content = readFileSync(skillDir, 'utf-8');
      const match = content.match(/^version:\s*"?([^"\n]+)"?$/m);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  private bumpVersion(existing: string | null): string {
    if (!existing) return '1.0.0';
    const parts = existing.split('.');
    if (parts.length !== 3) return '1.0.0';
    const patch = parseInt(parts[2] ?? '0', 10) + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }

  private renderBody(traj: TrajectoryEntry, meta: SkillMetadata): string {
    const lines: string[] = [];
    lines.push(`# ${meta.name}`);
    lines.push('');
    lines.push(meta.description);
    lines.push('');
    lines.push('## Steps');
    lines.push('');
    traj.steps.forEach((step, i) => {
      lines.push(`${i + 1}. **${step.tool}** — \`${JSON.stringify(step.args).slice(0, 80)}\``);
      const result = typeof step.result === 'string' ? step.result : JSON.stringify(step.result);
      lines.push(`   - Result: ${result.slice(0, 120)}`);
    });
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    lines.push(`- Tokens used: ${traj.tokensUsed}`);
    lines.push(`- Duration: ${traj.durationMs}ms`);
    lines.push(`- Category: ${meta.category}`);
    return lines.join('\n');
  }

  private persist(meta: SkillMetadata, body: string): void {
    const skillDir = join(this.skillsDir, meta.name);
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });

    const frontmatter: string[] = ['---'];
    frontmatter.push(`name: "${meta.name}"`);
    frontmatter.push(`description: "${meta.description.replace(/"/g, '\\"')}"`);
    frontmatter.push(`category: "${meta.category}"`);
    frontmatter.push(`trigger: [${meta.trigger.map((t) => `"${t}"`).join(', ')}]`);
    frontmatter.push(`version: "${meta.version}"`);
    frontmatter.push(`author: "${meta.author}"`);
    frontmatter.push(`lastImproved: "${meta.lastImproved}"`);
    if (meta.archived) frontmatter.push(`archived: true`);
    frontmatter.push('---');
    frontmatter.push('');

    writeFileSync(join(skillDir, 'SKILL.md'), frontmatter.join('\n') + body, 'utf-8');
  }
}

/**
 * Convenience helper: list skill subdirectories under a directory.
 * Exported for {@link SkillCatalog} / {@link SkillLoader}.
 */
export function listSkillDirs(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}
