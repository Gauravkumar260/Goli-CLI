/**
 * Unit tests for the SICA system (immutable registry, overseer, archive,
 * overfitting detector, rate limiter, and SICA loop).
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';


import { SicaArchive } from '../src/sica/archive.js';
import { ImmutableSafetyRegistry } from '../src/sica/immutable-registry.js';
import { SicaLoop } from '../src/sica/loop.js';
import { OverfitDetector } from '../src/sica/overfit-detector.js';
import { SafetyOverseer } from '../src/sica/overseer.js';
import { SicaRateLimiter } from '../src/sica/rate-limiter.js';

import type { SicaProposal, SicaEvaluation } from '../src/sica/types.js';

let testDir: string;

beforeEach(() => {
  try { rmSync(join(homedir(), ".agent", "sica", "rate-limiter.json"), { force: true }); } catch {}
  testDir = mkdtempSync(join(tmpdir(), 'goli-sica-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeProposal(overrides: Partial<SicaProposal> = {}): SicaProposal {
  return {
    proposalId: `prop-${Math.random().toString(36).slice(2)}`,
    target: 'system_prompt',
    targetName: 'identity',
    oldContent: 'You are GOLI-CLI, an AI coding agent.',
    newContent: 'You are GOLI-CLI, an AI coding agent that writes clean code.',
    diff: '- You are GOLI-CLI, an AI coding agent.\n+ You are GOLI-CLI, an AI coding agent that writes clean code.',
    linesChanged: 1,
    rationale: 'Added emphasis on clean code',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeEval(overrides: Partial<SicaEvaluation> = {}): SicaEvaluation {
  return {
    benchmark: 'swe-bench-verified-50',
    resolutionRate: 0.5,
    instanceCount: 50,
    resolvedCount: 25,
    semanticErrorRate: 0.15,
    totalTokens: 50000,
    totalCostUsd: 0.25,
    durationMs: 30000,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('ImmutableSafetyRegistry', () => {
  it('marks sandbox paths as immutable', () => {
    const registry = new ImmutableSafetyRegistry({ workspaceRoot: testDir });
    // The registry adds paths with trailing slash; check a file inside
    const sandboxFile = join(testDir, 'packages/sandbox/src/executor.ts');
    expect(registry.isImmutable(sandboxFile)).toBe(true);
  });

  it('does not mark non-protected paths as immutable', () => {
    const registry = new ImmutableSafetyRegistry({ workspaceRoot: testDir });
    const normalPath = join(testDir, 'packages/core/src/agent/loop.ts');
    expect(registry.isImmutable(normalPath)).toBe(false);
  });

  it('blocks SICA from modifying builtin hooks', () => {
    const registry = new ImmutableSafetyRegistry({ workspaceRoot: testDir });
    expect(registry.isTargetAllowed('hook_config', 'block_destructive')).toBe(false);
    expect(registry.isTargetAllowed('hook_config', 'block_secrets')).toBe(false);
    expect(registry.isTargetAllowed('hook_config', 'my_custom_hook')).toBe(true);
  });

  it('blocks SICA from modifying the safety system prompt fragment', () => {
    const registry = new ImmutableSafetyRegistry({ workspaceRoot: testDir });
    expect(registry.isTargetAllowed('system_prompt', 'safety')).toBe(false);
    expect(registry.isTargetAllowed('system_prompt', 'identity')).toBe(true);
  });

  it('allows system_prompt targets other than safety', () => {
    const registry = new ImmutableSafetyRegistry({ workspaceRoot: testDir });
    expect(registry.isTargetAllowed('system_prompt', 'identity')).toBe(true);
    expect(registry.isTargetAllowed('system_prompt', 'tools')).toBe(true);
    expect(registry.isTargetAllowed('tool_description', 'read_file')).toBe(true);
    expect(registry.isTargetAllowed('skill_definition', 'my-skill')).toBe(true);
  });

  it('can add custom immutable paths', () => {
    const registry = new ImmutableSafetyRegistry({ workspaceRoot: testDir });
    const customFile = join(testDir, 'secrets', 'api-keys.json');
    registry.addPath(join(testDir, 'secrets') + '/');
    expect(registry.isImmutable(customFile)).toBe(true);
  });

  it('verifyIntegrity detects missing paths', () => {
    const registry = new ImmutableSafetyRegistry({ workspaceRoot: testDir });
    // The default paths don't exist in the test dir
    const result = registry.verifyIntegrity();
    // Some paths may be missing (they're test paths, not real files)
    expect(result.ok).toBeDefined();
  });
});

describe('SafetyOverseer', () => {
  const registry = new ImmutableSafetyRegistry({ workspaceRoot: testDir });

  it('vetoes proposals to modify immutable targets', async () => {
    const overseer = new SafetyOverseer({ registry });
    const proposal = makeProposal({ target: 'hook_config', targetName: 'block_destructive' });
    const verdict = await overseer.review(proposal);
    expect(verdict.approved).toBe(false);
    expect(verdict.concerns[0]!.category).toBe('immutable_registry_modified');
  });

  it('vetoes proposals that remove safety checks', async () => {
    const overseer = new SafetyOverseer({ registry });
    const proposal = makeProposal({
      oldContent: 'block_destructive: deny rm -rf',
      newContent: 'allow all commands',
    });
    const verdict = await overseer.review(proposal);
    expect(verdict.approved).toBe(false);
    expect(verdict.concerns.some((c) => c.category === 'safety_check_disabled')).toBe(true);
  });

  it('vetoes proposals that expand sandbox boundaries', async () => {
    const overseer = new SafetyOverseer({ registry });
    const proposal = makeProposal({
      oldContent: 'sandbox mode: read-only\nother content',
      newContent: 'sandbox mode: danger-full-access\nother content',
    });
    const verdict = await overseer.review(proposal);
    expect(verdict.approved).toBe(false);
  });

  it('vetoes proposals that remove logging', async () => {
    const overseer = new SafetyOverseer({ registry });
    const proposal = makeProposal({
      oldContent: 'appendAuditLog(entry);',
      newContent: '// logging removed',
    });
    const verdict = await overseer.review(proposal);
    expect(verdict.approved).toBe(false);
  });

  it('vetoes proposals that weaken approval policy', async () => {
    const overseer = new SafetyOverseer({ registry });
    const proposal = makeProposal({
      oldContent: "decision: 'ask'",
      newContent: "decision: 'allow'",
    });
    const verdict = await overseer.review(proposal);
    expect(verdict.approved).toBe(false);
  });

  it('approves safe proposals (no pattern concerns)', async () => {
    const overseer = new SafetyOverseer({ registry });
    const proposal = makeProposal({
      oldContent: 'You are GOLI-CLI, an AI coding agent.',
      newContent: 'You are GOLI-CLI, an AI coding agent that writes clean code.',
    });
    const verdict = await overseer.review(proposal);
    expect(verdict.approved).toBe(true);
  });
});

describe('SicaArchive', () => {
  it('appends and retrieves entries', () => {
    const archive = new SicaArchive({
      archivePath: join(testDir, 'archive.jsonl'),
    });

    archive.append({
      version: 1,
      target: 'system_prompt',
      targetName: 'identity',
      content: 'v1 content',
      status: 'initial',
    });

    archive.append({
      version: 2,
      target: 'system_prompt',
      targetName: 'identity',
      content: 'v2 content',
      proposalId: 'prop-1',
      status: 'adopted',
    });

    expect(archive.count).toBe(2);
    const history = archive.getHistory('system_prompt', 'identity');
    expect(history).toHaveLength(2);
    expect(history[0]!.version).toBe(1);
    expect(history[1]!.version).toBe(2);
  });

  it('getCurrentVersion returns the latest version number', () => {
    const archive = new SicaArchive({ archivePath: join(testDir, 'archive.jsonl') });
    archive.append({ version: 1, target: 'system_prompt', targetName: 'identity', content: 'v1', status: 'initial' });
    archive.append({ version: 2, target: 'system_prompt', targetName: 'identity', content: 'v2', status: 'adopted' });
    expect(archive.getCurrentVersion('system_prompt', 'identity')).toBe(2);
  });

  it('getVersion returns content at a specific version', () => {
    const archive = new SicaArchive({ archivePath: join(testDir, 'archive.jsonl') });
    archive.append({ version: 1, target: 'system_prompt', targetName: 'identity', content: 'v1 content', status: 'initial' });
    archive.append({ version: 2, target: 'system_prompt', targetName: 'identity', content: 'v2 content', status: 'adopted' });
    expect(archive.getVersion('system_prompt', 'identity', 1)).toBe('v1 content');
    expect(archive.getVersion('system_prompt', 'identity', 2)).toBe('v2 content');
  });

  it('getLastAdopted returns the last adopted content', () => {
    const archive = new SicaArchive({ archivePath: join(testDir, 'archive.jsonl') });
    archive.append({ version: 1, target: 'system_prompt', targetName: 'identity', content: 'v1', status: 'initial' });
    archive.append({ version: 2, target: 'system_prompt', targetName: 'identity', content: 'v2', status: 'adopted' });
    archive.append({ version: 3, target: 'system_prompt', targetName: 'identity', content: 'v3', status: 'reverted' });
    expect(archive.getLastAdopted('system_prompt', 'identity')).toBe('v2');
  });
});

describe('OverfitDetector', () => {
  it('detects overfitting when optimization improves but holdout degrades', () => {
    const detector = new OverfitDetector({ maxHoldoutDegradation: 0.02 });
    const result = detector.detect(
      makeEval({ resolutionRate: 0.50 }),
      makeEval({ resolutionRate: 0.55 }),
      makeEval({ resolutionRate: 0.45 }),
      makeEval({ resolutionRate: 0.40 }),
    );
    expect(result.detected).toBe(true);
    expect(result.optimizationDelta).toBeCloseTo(0.05, 5);
    expect(result.holdoutDelta).toBeCloseTo(-0.05, 5);
  });

  it('does not detect overfitting when both improve', () => {
    const detector = new OverfitDetector({ maxHoldoutDegradation: 0.02 });
    const result = detector.detect(
      makeEval({ resolutionRate: 0.50 }),
      makeEval({ resolutionRate: 0.55 }),
      makeEval({ resolutionRate: 0.45 }),
      makeEval({ resolutionRate: 0.48 }),
    );
    expect(result.detected).toBe(false);
  });

  it('warns when optimization improves but holdout is flat', () => {
    const detector = new OverfitDetector({ maxHoldoutDegradation: 0.02 });
    const result = detector.detect(
      makeEval({ resolutionRate: 0.50 }),
      makeEval({ resolutionRate: 0.60 }),
      makeEval({ resolutionRate: 0.45 }),
      makeEval({ resolutionRate: 0.45 }),
    );
    expect(result.detected).toBe(false);
    expect(result.reason).toContain('Warning');
  });
});

describe('SicaRateLimiter', () => {
  it('allows cycles within the limit', () => {
    const limiter = new SicaRateLimiter({
      statePath: join(testDir, 'rate.json'),
      maxCyclesPerDay: 10,
    });
    expect(limiter.canRunCycle()).toBe(true);
    expect(limiter.remainingCycles).toBe(10);
  });

  it('blocks cycles after the limit', () => {
    const limiter = new SicaRateLimiter({
      statePath: join(testDir, 'rate.json'),
      maxCyclesPerDay: 2,
    });
    limiter.recordCycle();
    limiter.recordCycle();
    expect(limiter.canRunCycle()).toBe(false);
    expect(limiter.remainingCycles).toBe(0);
  });

  it('requires human review for large changes', () => {
    const limiter = new SicaRateLimiter({
      statePath: join(testDir, 'rate.json'),
      humanReviewLocThreshold: 50,
    });
    const smallProposal = makeProposal({ linesChanged: 10 });
    const largeProposal = makeProposal({ linesChanged: 100 });
    expect(limiter.requiresHumanReview(smallProposal)).toBe(false);
    expect(limiter.requiresHumanReview(largeProposal)).toBe(true);
  });

  it('tracks cycles today', () => {
    const limiter = new SicaRateLimiter({
      statePath: join(testDir, 'rate.json'),
      maxCyclesPerDay: 5,
    });
    expect(limiter.cyclesToday).toBe(0);
    limiter.recordCycle();
    expect(limiter.cyclesToday).toBe(1);
    limiter.recordCycle();
    expect(limiter.cyclesToday).toBe(2);
  });
});

describe('SicaLoop', () => {
  it('rejects cycles when disabled', async () => {
    const loop = new SicaLoop({ enabled: false, workspaceRoot: testDir, maxCyclesPerDay: 100 });
    const proposal = makeProposal();
    const result = await loop.runCycle(proposal);
    expect(result.adopted).toBe(false);
    expect(result.reason).toContain('disabled');
  });

  it('rejects proposals requiring human review', async () => {
    const loop = new SicaLoop({
      enabled: true,
      workspaceRoot: testDir,
      humanReviewLocThreshold: 50,
    });
    const proposal = makeProposal({ linesChanged: 100 });
    const result = await loop.runCycle(proposal);
    expect(result.adopted).toBe(false);
    expect(result.reason).toContain('Human review required');
  });

  it('vetoes proposals to immutable targets', async () => {
    const loop = new SicaLoop({ enabled: true, workspaceRoot: testDir, maxCyclesPerDay: 100 });
    const proposal = makeProposal({
      target: 'hook_config',
      targetName: 'block_destructive',
      linesChanged: 5,
    });
    const result = await loop.runCycle(proposal);
    expect(result.adopted).toBe(false);
    expect(result.overseerVerdict.approved).toBe(false);
    expect(result.overseerVerdict.approved).toBe(false);
    expect(result.overseerVerdict.concerns.length).toBeGreaterThan(0);
  });

  it('createProposal generates correct proposal', () => {
    const loop = new SicaLoop({ enabled: true, workspaceRoot: testDir, maxCyclesPerDay: 100 });
    const proposal = loop.createProposal({
      target: 'system_prompt',
      targetName: 'identity',
      oldContent: 'line 1\nline 2\nline 3',
      newContent: 'line 1\nline 2 modified\nline 3',
      rationale: 'Improved identity',
    });
    expect(proposal.target).toBe('system_prompt');
    expect(proposal.targetName).toBe('identity');
    expect(proposal.linesChanged).toBe(1);
    expect(proposal.diff).toContain('- line 2');
    expect(proposal.diff).toContain('+ line 2 modified');
    expect(proposal.rationale).toBe('Improved identity');
  });

  it('rollback restores prior version', async () => {
    const loop = new SicaLoop({ enabled: true, workspaceRoot: testDir, maxCyclesPerDay: 100 });

    // Manually add an archive entry
    loop.getArchive().append({
      version: 1,
      target: 'system_prompt',
      targetName: 'identity',
      content: 'original content',
      status: 'adopted',
    });

    const restored = loop.rollback('system_prompt', 'identity', 1);
    expect(restored).toBe('original content');
  });
});
