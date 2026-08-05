/**
 * Tests for the Footprint Ladder decision framework (T-027).
 *
 * @module tests/unit/footprint-ladder.test
 */

import { describe, it, expect } from 'vitest';

import {
  FOOTPRINT_LADDER_RUNGS,
  RUNG_DESCRIPTIONS,
  describeRung,
  recommendRung,
  TOOL_CLASSIFICATIONS,
  classifyAllTools,
} from '../src/footprint-ladder.js';

describe('Footprint Ladder — rungs', () => {
  it('exports 6 rungs in order from lowest to highest footprint', () => {
    expect(FOOTPRINT_LADDER_RUNGS).toEqual([
      'extend',
      'cli_skill',
      'service_gated_tool',
      'plugin',
      'mcp_server',
      'core_tool',
    ]);
  });

  it('each rung has a description', () => {
    for (const rung of FOOTPRINT_LADDER_RUNGS) {
      expect(RUNG_DESCRIPTIONS[rung]).toBeTruthy();
      expect(RUNG_DESCRIPTIONS[rung].length).toBeGreaterThan(10);
    }
  });

  it('describeRung returns the description for each rung', () => {
    expect(describeRung('extend')).toContain('EXTEND');
    expect(describeRung('core_tool').toLowerCase()).toContain('always-available');
    expect(describeRung('service_gated_tool')).toContain('check_fn');
  });
});

describe('Footprint Ladder — recommendRung', () => {
  it('recommends extend when canExtendExistingTool is true', () => {
    expect(recommendRung({ canExtendExistingTool: true })).toBe('extend');
  });

  it('recommends cli_skill when isWorkflow is true', () => {
    expect(recommendRung({ isWorkflow: true })).toBe('cli_skill');
  });

  it('recommends service_gated_tool when needsExternalService is true', () => {
    expect(recommendRung({ needsExternalService: true })).toBe('service_gated_tool');
  });

  it('recommends plugin when isUserSpecific is true', () => {
    expect(recommendRung({ isUserSpecific: true })).toBe('plugin');
  });

  it('recommends mcp_server when needsSeparateRuntime is true', () => {
    expect(recommendRung({ needsSeparateRuntime: true })).toBe('mcp_server');
  });

  it('recommends core_tool when universallyNeeded is true', () => {
    expect(recommendRung({ universallyNeeded: true })).toBe('core_tool');
  });

  it('defaults to extend when no options provided', () => {
    expect(recommendRung({})).toBe('extend');
  });

  it('respects priority order (extend > cli_skill > service_gated > plugin > mcp > core)', () => {
    // If multiple are true, the lowest rung wins.
    expect(
      recommendRung({
        canExtendExistingTool: true,
        isWorkflow: true,
        universallyNeeded: true,
      }),
    ).toBe('extend');
    expect(
      recommendRung({
        isWorkflow: true,
        universallyNeeded: true,
      }),
    ).toBe('cli_skill');
    expect(
      recommendRung({
        needsExternalService: true,
        universallyNeeded: true,
      }),
    ).toBe('service_gated_tool');
  });
});

describe('Footprint Ladder — TOOL_CLASSIFICATIONS', () => {
  it('classifies at least 20 tools', () => {
    expect(TOOL_CLASSIFICATIONS.length).toBeGreaterThanOrEqual(20);
  });

  it('every tool has current, recommended, and notes', () => {
    for (const t of TOOL_CLASSIFICATIONS) {
      expect(t.name).toBeTruthy();
      expect(t.current).toBeTruthy();
      expect(t.recommended).toBeTruthy();
      expect(t.notes).toBeTruthy();
    }
  });

  it('all current rungs are core_tool (T-027 baseline audit)', () => {
    // All 22 existing tools were placed at rung 6 before the ladder was adopted.
    for (const t of TOOL_CLASSIFICATIONS) {
      expect(t.current).toBe('core_tool');
    }
  });

  it('at least 5 tools have a recommended rung lower than core_tool', () => {
    // The audit should identify tools that could be downgraded.
    const downgradable = TOOL_CLASSIFICATIONS.filter(
      (t) => t.recommended !== 'core_tool',
    );
    expect(downgradable.length).toBeGreaterThanOrEqual(5);
  });

  it('web_fetch and web_search are recommended as service_gated_tool', () => {
    const webFetch = TOOL_CLASSIFICATIONS.find((t) => t.name === 'web_fetch');
    const webSearch = TOOL_CLASSIFICATIONS.find((t) => t.name === 'web_search');
    expect(webFetch?.recommended).toBe('service_gated_tool');
    expect(webSearch?.recommended).toBe('service_gated_tool');
  });

  it('spec_* tools are recommended as cli_skill', () => {
    const specTools = TOOL_CLASSIFICATIONS.filter((t) =>
      t.name.startsWith('spec_'),
    );
    expect(specTools.length).toBeGreaterThanOrEqual(3);
    for (const t of specTools) {
      expect(t.recommended).toBe('cli_skill');
    }
  });

  it('read_file, write_file, bash, grep are recommended as core_tool (universal need)', () => {
    for (const name of ['read_file', 'write_file', 'bash', 'grep']) {
      const t = TOOL_CLASSIFICATIONS.find((tc) => tc.name === name);
      expect(t?.recommended).toBe('core_tool');
    }
  });
});

describe('Footprint Ladder — classifyAllTools summary', () => {
  it('returns current + recommended counts + total', () => {
    const summary = classifyAllTools();
    expect(summary.current).toBeDefined();
    expect(summary.recommended).toBeDefined();
    expect(summary.total).toBe(TOOL_CLASSIFICATIONS.length);
  });

  it('current count for core_tool equals total (all tools are currently core)', () => {
    const summary = classifyAllTools();
    expect(summary.current.core_tool).toBe(summary.total);
  });

  it('recommended count for core_tool is less than total (some tools downgraded)', () => {
    const summary = classifyAllTools();
    expect(summary.recommended.core_tool).toBeLessThan(summary.total);
  });

  it('recommended count for service_gated_tool is at least 4 (web_fetch, web_search, notebook_edit, lsp_tools)', () => {
    const summary = classifyAllTools();
    expect(summary.recommended.service_gated_tool).toBeGreaterThanOrEqual(4);
  });

  it('recommended count for cli_skill is at least 3 (spec_* tools)', () => {
    const summary = classifyAllTools();
    expect(summary.recommended.cli_skill).toBeGreaterThanOrEqual(3);
  });

  it('sum of all current counts equals total', () => {
    const summary = classifyAllTools();
    const sum = Object.values(summary.current).reduce((a, b) => a + b, 0);
    expect(sum).toBe(summary.total);
  });

  it('sum of all recommended counts equals total', () => {
    const summary = classifyAllTools();
    const sum = Object.values(summary.recommended).reduce((a, b) => a + b, 0);
    expect(sum).toBe(summary.total);
  });
});

describe('Footprint Ladder — Hermes-parity', () => {
  it('mirrors Hermes 6-rung ladder (extend > CLI+skill > service-gated > plugin > MCP > core)', () => {
    // Hermes AGENTS.md documents this exact ladder (source-verified).
    expect(FOOTPRINT_LADDER_RUNGS[0]).toBe('extend');
    expect(FOOTPRINT_LADDER_RUNGS[1]).toBe('cli_skill');
    expect(FOOTPRINT_LADDER_RUNGS[2]).toBe('service_gated_tool');
    expect(FOOTPRINT_LADDER_RUNGS[3]).toBe('plugin');
    expect(FOOTPRINT_LADDER_RUNGS[4]).toBe('mcp_server');
    expect(FOOTPRINT_LADDER_RUNGS[5]).toBe('core_tool');
  });

  it('documents the service_gated_tool check_fn pattern (matches Hermes)', () => {
    expect(RUNG_DESCRIPTIONS.service_gated_tool).toContain('check_fn');
  });
});
