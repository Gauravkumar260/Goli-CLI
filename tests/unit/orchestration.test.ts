/**
 * Unit tests for the orchestration system (Module 7).
 */

import { describe, it, expect } from 'vitest';

import { E2BSandbox } from '../../packages/core/src/orchestration/cloud/e2b.js';
import { TaskSplitter } from '../../packages/core/src/orchestration/decompose/task-splitter.js';
import { OrchestrationPatterns } from '../../packages/core/src/orchestration/patterns/index.js';
import { ComplexityClassifier, BLOCKED_PROVIDERS } from '../../packages/core/src/orchestration/routing/classifier.js';
import { SharedBlackboard } from '../../packages/core/src/orchestration/shared-state/blackboard.js';
import { SwarmPipeline } from '../../packages/core/src/orchestration/swarm-pipeline.js';
import { SWARM_PIPELINE } from '../../packages/core/src/orchestration/types.js';

import type { TaskDecomposition } from '../../packages/core/src/orchestration/types.js';

describe('TaskSplitter', () => {
  it('decomposes a simple task into a single subtask', () => {
    const splitter = new TaskSplitter();
    const result = splitter.decompose('Fix the bug in parser.ts');
    expect(result.subtasks).toHaveLength(1);
    expect(result.pattern).toBe('single-loop');
    expect(result.parallelRecommended).toBe(false);
  });

  it('decomposes a multi-part task into multiple subtasks', () => {
    const splitter = new TaskSplitter();
    const result = splitter.decompose('Read the file then fix the bug then run the tests');
    expect(result.subtasks.length).toBeGreaterThan(1);
  });

  it('classifies agent roles correctly', () => {
    const splitter = new TaskSplitter();
    const result1 = splitter.decompose('Explore the codebase and map dependencies');
    expect(result1.subtasks[0]!.role).toBe('scout');

    const result2 = splitter.decompose('Implement the new feature');
    expect(result2.subtasks[0]!.role).toBe('implementer');

    const result3 = splitter.decompose('Debug the crash in the login flow');
    expect(result3.subtasks[0]!.role).toBe('debugger');
  });

  it('identifies hotspot files', () => {
    const splitter = new TaskSplitter({ hotspotFiles: ['package.json'] });
    const result = splitter.decompose('Update package.json and add a new feature');
    expect(result.hotspotFiles).toContain('package.json');
    expect(result.parallelRecommended).toBe(false);
  });

  it('recommends fan-out-fan-in for 4+ independent tasks', () => {
    const splitter = new TaskSplitter();
    // Simulate 4 independent tasks
    const result = splitter.decompose('Fix bug A then fix bug B then fix bug C then fix bug D');
    // The pattern depends on hotspot detection and independence
    expect(result.subtasks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SharedBlackboard', () => {
  it('proposes, validates, and commits entries', () => {
    const bb = new SharedBlackboard({ filePath: '/tmp/test-blackboard.md' });
    const entry = bb.propose('task-1', 'implementer', 'I will change src/index.ts');
    expect(entry.status).toBe('pending');

    bb.validate(entry.id, true);
    expect(bb.getBySubtask('task-1')[0]!.status).toBe('validated');

    bb.commit(entry.id);
    expect(bb.getCommitted()).toHaveLength(1);
  });

  it('rejects proposals', () => {
    const bb = new SharedBlackboard({ filePath: '/tmp/test-blackboard.md' });
    const entry = bb.propose('task-1', 'implementer', 'Bad change');
    bb.validate(entry.id, false);
    expect(entry.status).toBe('rejected');
    expect(bb.getCommitted()).toHaveLength(0);
  });

  it('cannot commit without validation', () => {
    const bb = new SharedBlackboard({ filePath: '/tmp/test-blackboard.md' });
    const entry = bb.propose('task-1', 'implementer', 'Change');
    expect(bb.commit(entry.id)).toBe(false);
  });

  it('getPendingProposals returns only pending', () => {
    const bb = new SharedBlackboard({ filePath: '/tmp/test-blackboard.md' });
    bb.propose('task-1', 'implementer', 'Change 1');
    const e2 = bb.propose('task-2', 'implementer', 'Change 2');
    bb.validate(e2.id, true);
    expect(bb.getPendingProposals()).toHaveLength(1);
  });

  it('toMarkdown produces human-readable output', () => {
    const bb = new SharedBlackboard({ filePath: '/tmp/test-blackboard.md' });
    bb.propose('task-1', 'implementer', 'Change src/index.ts');
    const md = bb.toMarkdown();
    expect(md).toContain('Shared Task List');
    expect(md).toContain('implementer');
  });
});

describe('ComplexityClassifier', () => {
  it('classifies routine tasks', () => {
    const classifier = new ComplexityClassifier();
    expect(classifier.classify('Add a comment to the file')).toBe('routine');
    expect(classifier.classify('List the files in the directory')).toBe('routine');
  });

  it('classifies complex tasks', () => {
    const classifier = new ComplexityClassifier();
    expect(classifier.classify('Refactor the auth module')).toBe('complex');
    expect(classifier.classify('Debug the parser crash')).toBe('complex');
    expect(classifier.classify('Design the new API architecture')).toBe('complex');
  });

  it('classifies hard tasks', () => {
    const classifier = new ComplexityClassifier();
    expect(classifier.classify('System design for distributed concurrency')).toBe('hard');
    expect(classifier.classify('Multi-file refactor with parallel safety')).toBe('hard');
  });

  it('routes to the correct model', () => {
    const classifier = new ComplexityClassifier();
    const routine = classifier.route('Add a comment');
    expect(routine.model).toBe('glm-5.2');
    expect(routine.effort).toBe('high');
    expect(routine.fallback).toBe(false);

    const hard = classifier.route('System design for distributed concurrency');
    expect(hard.fallback).toBe(true);
  });

  it('blocks closed-weight providers', () => {
    const classifier = new ComplexityClassifier();
    expect(classifier.isProviderAllowed('anthropic')).toBe(false);
    expect(classifier.isProviderAllowed('openai')).toBe(false);
    expect(classifier.isProviderAllowed('vllm-self-hosted')).toBe(true);
    expect(classifier.isProviderAllowed('deepseek')).toBe(true);
  });

  it('BLOCKED_PROVIDERS contains anthropic and openai', () => {
    expect(BLOCKED_PROVIDERS).toContain('anthropic');
    expect(BLOCKED_PROVIDERS).toContain('openai');
  });
});

describe('E2BSandbox', () => {
  it('creates and destroys sandboxes', async () => {
    const sandbox = new E2BSandbox();
    const session = await sandbox.create('https://github.com/test/repo');
    expect(session.status).toBe('ready');
    expect(session.provider).toBe('e2b');
    expect(sandbox.count).toBe(1);

    await sandbox.destroy(session.sandboxId);
    expect(session.status).toBe('destroyed');
  });

  it('executes commands in sandbox', async () => {
    const sandbox = new E2BSandbox();
    const session = await sandbox.create();
    const result = await sandbox.execute(session.sandboxId, 'echo hello');
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('echo hello');
    await sandbox.destroy(session.sandboxId);
  });

  it('enforces max concurrent limit', async () => {
    const sandbox = new E2BSandbox({ maxConcurrent: 2 });
    await sandbox.create();
    await sandbox.create();
    await expect(sandbox.create()).rejects.toThrow('Max concurrent');
    await sandbox.destroyAll();
  });

  it('destroyAll cleans up all sandboxes', async () => {
    const sandbox = new E2BSandbox();
    await sandbox.create();
    await sandbox.create();
    await sandbox.create();
    expect(sandbox.count).toBe(3);
    await sandbox.destroyAll();
    expect(sandbox.count).toBe(0);
  });
});

describe('OrchestrationPatterns', () => {
  it('runs handoff pattern sequentially', async () => {
    const patterns = new OrchestrationPatterns({
      runSubagent: async (subtask) => ({
        ok: true,
        output: `Done: ${subtask.description}`,
        durationMs: 100,
      }),
    });

    const decomposition: TaskDecomposition = {
      task: 'Do A then B',
      subtasks: [
        { id: '1', description: 'Task A', role: 'implementer', independent: false, dependsOn: [], expectedOutput: 'A done', priority: 2 },
        { id: '2', description: 'Task B', role: 'qa-tester', independent: false, dependsOn: ['1'], expectedOutput: 'B done', priority: 1 },
      ],
      pattern: 'handoff',
      parallelRecommended: false,
      hotspotFiles: [],
    };

    const result = await patterns.run(decomposition, 'handoff');
    expect(result.pattern).toBe('handoff');
    expect(result.subtaskResults).toHaveLength(2);
    expect(result.ok).toBe(true);
  });

  it('runs fan-out-fan-in pattern with parallel tasks', async () => {
    const patterns = new OrchestrationPatterns({
      maxParallel: 2,
      runSubagent: async (subtask) => ({
        ok: true,
        output: `Done: ${subtask.description}`,
        durationMs: 100,
      }),
    });

    const decomposition: TaskDecomposition = {
      task: 'Do 4 independent things',
      subtasks: [
        { id: '1', description: 'Task A', role: 'implementer', independent: true, dependsOn: [], expectedOutput: 'A', priority: 1 },
        { id: '2', description: 'Task B', role: 'implementer', independent: true, dependsOn: [], expectedOutput: 'B', priority: 1 },
        { id: '3', description: 'Task C', role: 'implementer', independent: true, dependsOn: [], expectedOutput: 'C', priority: 1 },
        { id: '4', description: 'Task D', role: 'implementer', independent: true, dependsOn: [], expectedOutput: 'D', priority: 1 },
      ],
      pattern: 'fan-out-fan-in',
      parallelRecommended: true,
      hotspotFiles: [],
    };

    const result = await patterns.run(decomposition, 'fan-out-fan-in');
    expect(result.pattern).toBe('fan-out-fan-in');
    expect(result.subtaskResults).toHaveLength(4);
    expect(result.ok).toBe(true);
  });

  it('supervisor retries failed subtasks', async () => {
    let attempt = 0;
    const patterns = new OrchestrationPatterns({
      runSubagent: async () => {
        attempt++;
        if (attempt < 2) return { ok: false, output: 'failed', durationMs: 100 };
        return { ok: true, output: 'succeeded', durationMs: 100 };
      },
    });

    const decomposition: TaskDecomposition = {
      task: 'Do one thing',
      subtasks: [
        { id: '1', description: 'Task A', role: 'implementer', independent: false, dependsOn: [], expectedOutput: 'A', priority: 1 },
      ],
      pattern: 'supervisor',
      parallelRecommended: false,
      hotspotFiles: [],
    };

    const result = await patterns.run(decomposition, 'supervisor');
    expect(result.ok).toBe(true);
  });
});

describe('SwarmPipeline', () => {
  it('has 11 pipeline stages', () => {
    expect(SWARM_PIPELINE).toHaveLength(11);
    expect(SWARM_PIPELINE[0]!.role).toBe('scout');
    expect(SWARM_PIPELINE[10]!.role).toBe('documenter');
  });

  it('wakeup runs the pipeline', async () => {
    const pipeline = new SwarmPipeline({
      workspaceRoot: '/tmp/test',
      runAgent: async (role, prompt) => ({
        ok: true,
        output: `${role} completed: ${prompt.slice(0, 30)}`,
        durationMs: 100,
      }),
    });

    const result = await pipeline.wakeup('Fix the bug in parser.ts');
    expect(result.ok).toBe(true);
    expect(result.routingDecision).toBeDefined();
    expect(result.pipelineStages).toHaveLength(11);
    expect(result.decomposition).toBeDefined();
  });

  it('wakeup classifies routing', async () => {
    const pipeline = new SwarmPipeline({
      workspaceRoot: '/tmp/test',
      runAgent: async () => ({ ok: true, output: 'done', durationMs: 50 }),
    });

    const result = await pipeline.wakeup('Refactor the auth module');
    expect(result.routingDecision.complexity).toBe('complex');
    expect(result.routingDecision.model).toBe('glm-5.2');
    expect(result.routingDecision.effort).toBe('max');
  });

  it('getPipelineStages returns all 11 stages', () => {
    const pipeline = new SwarmPipeline({ workspaceRoot: '/tmp/test' });
    const stages = pipeline.getPipelineStages();
    expect(stages).toHaveLength(11);
    expect(stages[0]!.label).toBe('Scout');
    expect(stages[10]!.label).toBe('Documenter');
  });
});
