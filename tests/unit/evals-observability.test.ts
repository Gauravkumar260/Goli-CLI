/**
 * Unit tests for the evals & observability system.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { generateRedteamConfig, configToYaml, evaluateRedteamResults } from '../../packages/core/src/evals/redteam/promptfoo.js';
import { RegressionGate } from '../../packages/core/src/evals/regression/gate.js';
import { SemanticErrorEvaluator } from '../../packages/core/src/evals/semantic-check/evaluator.js';
import { SWEBenchHarness, generateStubInstances } from '../../packages/core/src/evals/swebench/harness.js';
import { DEFAULT_QUALITY_THRESHOLDS } from '../../packages/core/src/evals/types.js';
import { AlertManager } from '../../packages/observability/src/alerts/manager.js';
import { LangfuseClient } from '../../packages/observability/src/langfuse/client.js';
import { OtelTracer } from '../../packages/observability/src/tracing/otel.js';

import type { BenchmarkEvaluation } from '../../packages/core/src/evals/types.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'goli-evals-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeBenchmarkEval(overrides: Partial<BenchmarkEvaluation> = {}): BenchmarkEvaluation {
  return {
    benchmark: 'swe-bench-verified-50',
    instanceCount: 50,
    resolvedCount: 25,
    resolutionRate: 0.5,
    semanticErrorRate: 0.15,
    results: [],
    totalTokens: 50000,
    totalCostUsd: 0.25,
    durationMs: 30000,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('SWEBenchHarness', () => {
  it('generates stub instances', () => {
    const instances = generateStubInstances(10);
    expect(instances).toHaveLength(10);
    expect(instances[0]!.instanceId).toBeDefined();
    expect(instances[0]!.failToPass).toHaveLength(1);
    expect(instances[0]!.passToPass).toHaveLength(2);
  });

  it('evaluates a subset of instances', async () => {
    const harness = new SWEBenchHarness({ subsetSize: 5, sampleSemanticErrors: false });
    const instances = generateStubInstances(10);
    const evaluation = await harness.evaluate(instances, 5);

    expect(evaluation.instanceCount).toBe(5);
    expect(evaluation.resolvedCount).toBeLessThanOrEqual(5);
    expect(evaluation.resolutionRate).toBeGreaterThanOrEqual(0);
    expect(evaluation.resolutionRate).toBeLessThanOrEqual(1);
    expect(evaluation.timestamp).toBeDefined();
  });

  it('uses custom runAgent function when provided', async () => {
    const harness = new SWEBenchHarness({
      subsetSize: 3,
      sampleSemanticErrors: false,
      runAgent: async (instance) => ({
        resolved: true,
        testsPass: [...instance.failToPass, ...instance.passToPass],
        testsFail: [],
        regressions: [],
        totalTokens: 1000,
        totalCostUsd: 0.01,
        durationMs: 5000,
      }),
    });
    const instances = generateStubInstances(10);
    const evaluation = await harness.evaluate(instances, 3);

    expect(evaluation.resolvedCount).toBe(3);
    expect(evaluation.resolutionRate).toBe(1);
  });
});

describe('SemanticErrorEvaluator', () => {
  it('returns false for non-resolved instances', async () => {
    const evaluator = new SemanticErrorEvaluator();
    const result = await evaluator.check(
      generateStubInstances(1)[0]!,
      {
        instanceId: 'test',
        resolved: false,
        failToPassPassed: false,
        passToPassPassed: false,
        testsPass: [],
        testsFail: ['test_edge_case_0'],
        regressions: [],
        totalTokens: 1000,
        totalCostUsd: 0.01,
        durationMs: 5000,
        semanticError: false,
      },
    );
    expect(result).toBe(false);
  });

  it('returns true for resolved instances with no regressions (heuristic)', async () => {
    const evaluator = new SemanticErrorEvaluator();
    const instance = generateStubInstances(1)[0]!;
    const result = await evaluator.check(instance, {
      instanceId: instance.instanceId,
      resolved: true,
      failToPassPassed: true,
      passToPassPassed: true,
      testsPass: [...instance.failToPass, ...instance.passToPass],
      testsFail: [],
      regressions: [],
      totalTokens: 1000,
      totalCostUsd: 0.01,
      durationMs: 5000,
      semanticError: false,
    });
    expect(result).toBe(true);
  });

  it('returns false when there are regressions (heuristic)', async () => {
    const evaluator = new SemanticErrorEvaluator();
    const instance = generateStubInstances(1)[0]!;
    const result = await evaluator.check(instance, {
      instanceId: instance.instanceId,
      resolved: true,
      failToPassPassed: true,
      passToPassPassed: false,
      testsPass: instance.failToPass,
      testsFail: instance.passToPass,
      regressions: instance.passToPass,
      totalTokens: 1000,
      totalCostUsd: 0.01,
      durationMs: 5000,
      semanticError: false,
    });
    expect(result).toBe(false);
  });
});

describe('RegressionGate', () => {
  it('passes when above absolute floor and no regression', () => {
    const gate = new RegressionGate({ baselineRate: 0.50, absoluteThreshold: 0.40 });
    const result = gate.check(makeBenchmarkEval({ resolutionRate: 0.55 }));
    expect(result.passed).toBe(true);
    expect(result.decision).toBe('PASS');
  });

  it('blocks when below absolute floor', () => {
    const gate = new RegressionGate({ baselineRate: 0.50, absoluteThreshold: 0.40 });
    const result = gate.check(makeBenchmarkEval({ resolutionRate: 0.35 }));
    expect(result.passed).toBe(false);
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toContain('Absolute floor');
  });

  it('blocks when relative regression exceeds threshold', () => {
    const gate = new RegressionGate({ baselineRate: 0.50, absoluteThreshold: 0.40, relativeRegression: 0.02 });
    const result = gate.check(makeBenchmarkEval({ resolutionRate: 0.45 }));
    // 0.45 - 0.50 = -0.05, which is beyond -0.02 threshold
    expect(result.passed).toBe(false);
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toContain('Relative regression');
  });

  it('warns on minor regression within threshold', () => {
    const gate = new RegressionGate({ baselineRate: 0.50, absoluteThreshold: 0.40, relativeRegression: 0.05 });
    const result = gate.check(makeBenchmarkEval({ resolutionRate: 0.48 }));
    // 0.48 - 0.50 = -0.02, within -0.05 threshold → WARN
    expect(result.passed).toBe(true);
    expect(result.decision).toBe('WARN');
  });

  it('setBaseline updates the baseline', () => {
    const gate = new RegressionGate({ baselineRate: 0.40 });
    gate.setBaseline(0.55);
    const result = gate.check(makeBenchmarkEval({ resolutionRate: 0.50 }));
    // 0.50 - 0.55 = -0.05, which is beyond -0.02 default threshold
    expect(result.passed).toBe(false);
  });
});

describe('Promptfoo red-team', () => {
  it('generateRedteamConfig produces a valid config', () => {
    const config = generateRedteamConfig();
    expect(config.description).toContain('OWASP');
    expect(config.prompts).toHaveLength(1);
    expect(config.providers).toHaveLength(1);
    expect(config.redteam.plugins).toContain('owasp:llm01');
    expect(config.redteam.plugins).toContain('agentic:asi01');
    expect(config.redteam.plugins).toContain('coding:repo_injection');
    expect(config.redteam.strategies.length).toBeGreaterThan(0);
  });

  it('configToYaml produces valid YAML', () => {
    const config = generateRedteamConfig();
    const yaml = configToYaml(config);
    expect(yaml).toContain('description:');
    expect(yaml).toContain('prompts:');
    expect(yaml).toContain('providers:');
    expect(yaml).toContain('redteam:');
    expect(yaml).toContain('plugins:');
    expect(yaml).toContain('owasp:llm01');
  });

  it('evaluateRedteamResults blocks on critical findings', () => {
    const result = evaluateRedteamResults({ critical: 2, high: 1, medium: 3 });
    expect(result.passed).toBe(false);
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toContain('critical');
  });

  it('evaluateRedteamResults blocks on high findings', () => {
    const result = evaluateRedteamResults({ critical: 0, high: 2, medium: 3 });
    expect(result.passed).toBe(false);
    expect(result.decision).toBe('BLOCK');
  });

  it('evaluateRedteamResults passes with only medium findings', () => {
    const result = evaluateRedteamResults({ critical: 0, high: 0, medium: 5 });
    expect(result.passed).toBe(true);
    expect(result.decision).toBe('PASS');
  });
});

describe('OtelTracer', () => {
  it('creates spans with parent-child relationships', () => {
    const tracer = new OtelTracer();
    const parent = tracer.startSpan('agent.iteration', 'INTERNAL', { iter: 1 });
    const child = tracer.startSpan('chat llm', 'CLIENT');

    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.traceId).toBe(parent.traceId);
    expect(parent.children).toHaveLength(1);

    tracer.endSpan(child);
    tracer.endSpan(parent);
    expect(child.endTime).toBeDefined();
    expect(parent.endTime).toBeDefined();
  });

  it('records chat usage attributes', () => {
    const tracer = new OtelTracer();
    const span = tracer.startSpan('chat');
    tracer.recordChatUsage(span, 500, 200, 100, 'stop');
    expect(span.attributes['gen_ai.usage.input_tokens']).toBe(500);
    expect(span.attributes['gen_ai.usage.output_tokens']).toBe(200);
    expect(span.attributes['gen_ai.usage.thinking_tokens']).toBe(100);
    expect(span.attributes['gen_ai.response.finish_reason']).toBe('stop');
    tracer.endSpan(span);
  });

  it('exports spans as JSON', () => {
    const tracer = new OtelTracer();
    const span = tracer.startSpan('test');
    tracer.endSpan(span);
    const exported = tracer.export();
    expect(exported).toContain('service.name');
    expect(exported).toContain('spans');
  });
});

describe('LangfuseClient', () => {
  it('exports to file in offline mode', async () => {
    const client = new LangfuseClient({
      fileExport: true,
      filePath: join(testDir, 'traces.jsonl'),
    });
    const tracer = new OtelTracer();
    const span = tracer.startSpan('test');
    tracer.endSpan(span);

    await client.export([span]);
    // File should contain the span
    const { readFileSync, existsSync } = await import('node:fs');
    expect(existsSync(join(testDir, 'traces.jsonl'))).toBe(true);
    const content = readFileSync(join(testDir, 'traces.jsonl'), 'utf-8');
    expect(content).toContain('test');
  });

  it('getDeployInstructions returns deployment guide', () => {
    const instructions = LangfuseClient.getDeployInstructions();
    expect(instructions).toContain('docker-compose');
    expect(instructions).toContain('self-hosted');
  });
});

describe('AlertManager', () => {
  it('detects stuck loops', () => {
    const manager = new AlertManager();
    const alert = manager.checkStuckLoop(25, 0);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('stuck_loop');
    expect(alert!.action).toBe('hard_stop');
  });

  it('detects identical call stalls', () => {
    const manager = new AlertManager();
    const alert = manager.checkStuckLoop(5, 4);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('stuck_loop');
  });

  it('detects session budget exceeded', () => {
    const manager = new AlertManager({ thresholds: { sessionBudgetUsd: 5.0 } });
    const alert = manager.checkSessionBudget(6.0);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('budget_exceeded');
    expect(alert!.action).toBe('hard_stop');
  });

  it('detects daily budget exceeded', () => {
    const manager = new AlertManager({ thresholds: { dailyBudgetUsd: 10.0, hardStopOnDailyExceed: true } });
    manager.checkDailyBudget(5.0);
    const alert = manager.checkDailyBudget(6.0);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('daily_cost');
    expect(alert!.action).toBe('hard_stop');
  });

  it('detects high error rate', () => {
    const manager = new AlertManager({ thresholds: { errorRateThreshold: 0.15 } });
    const alert = manager.checkErrorRate(8, 50); // 16% > 15%
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('error_rate');
  });

  it('detects wall-clock exceeded', () => {
    const manager = new AlertManager({ thresholds: { wallclockThresholdS: 1800 } });
    const alert = manager.checkLatency(2000);
    expect(alert).not.toBeNull();
    // The alert type is `wallclock_exceeded` (not `latency_p99`) because
    // `checkLatency` checks a single session's wall-clock duration, not
    // a statistical P99 percentile. The previous name was misleading.
    expect(alert!.type).toBe('wallclock_exceeded');
  });

  it('calls onAlert callback when triggered', () => {
    const alerts: unknown[] = [];
    const manager = new AlertManager({
      thresholds: { sessionBudgetUsd: 5.0 },
      onAlert: (alert) => alerts.push(alert),
    });
    manager.checkSessionBudget(6.0);
    expect(alerts).toHaveLength(1);
  });
});
