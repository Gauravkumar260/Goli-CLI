/**
 * Unit tests for T-059 — ApprovalModeIndicator + ContextSummaryDisplay (loop 6, iter 7).
 *
 * Verifies:
 *  1. ApprovalModeIndicator renders the correct label for each mode.
 *  2. ApprovalModeIndicator shows keybind hint on wide terminals.
 *  3. ApprovalModeIndicator hides keybind hint on narrow terminals.
 *  4. ApprovalModeIndicator godMode overrides mode.
 *  5. ContextSummaryDisplay renders counts.
 *  6. ContextSummaryDisplay hides zero counts on narrow terminals.
 *  7. ContextSummaryDisplay shows all counts on wide terminals.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import {
  ApprovalModeIndicator,
  __testing as amiTesting,
} from '../../apps/cli/src/tui/components/ApprovalModeIndicator.js';
import {
  ContextSummaryDisplay,
} from '../../apps/cli/src/tui/components/ContextSummaryDisplay.js';
import { resetCapabilitiesCache } from '../../apps/cli/src/tui/lib/capabilities.js';

describe('T-059: ApprovalModeIndicator — mode labels', () => {
  it('renders BUILD for default mode', () => {
    const { lastFrame } = render(<ApprovalModeIndicator mode="default" cols={80} />);
    expect(lastFrame() ?? '').toContain('BUILD');
  });

  it('renders PLAN for plan mode', () => {
    const { lastFrame } = render(<ApprovalModeIndicator mode="plan" cols={80} />);
    expect(lastFrame() ?? '').toContain('PLAN');
  });

  it('renders SAFE for safe mode', () => {
    const { lastFrame } = render(<ApprovalModeIndicator mode="safe" cols={80} />);
    expect(lastFrame() ?? '').toContain('SAFE');
  });

  it('renders GOD for god mode', () => {
    const { lastFrame } = render(<ApprovalModeIndicator mode="god" cols={80} />);
    expect(lastFrame() ?? '').toContain('GOD');
  });

  it('MODE_CONFIG has 4 modes', () => {
    expect(Object.keys(amiTesting.MODE_CONFIG)).toHaveLength(4);
  });

  it('MODE_CONFIG each mode has label + color + description', () => {
    for (const [mode, config] of Object.entries(amiTesting.MODE_CONFIG)) {
      expect(config.label).toBeDefined();
      expect(config.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(config.description.length).toBeGreaterThan(0);
    }
  });
});

describe('T-059: ApprovalModeIndicator — keybind hint', () => {
  it('shows keybind hint on wide terminals (>=60 cols)', () => {
    const { lastFrame } = render(<ApprovalModeIndicator mode="default" cols={80} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Shift+Tab');
    expect(frame).toMatch(/cycle/i);
  });

  it('hides keybind hint on narrow terminals (<60 cols)', () => {
    const { lastFrame } = render(<ApprovalModeIndicator mode="default" cols={40} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Shift+Tab');
  });

  it('showHint=true overrides narrow terminal', () => {
    const { lastFrame } = render(
      <ApprovalModeIndicator mode="default" cols={40} showHint={true} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Shift+Tab');
  });

  it('showHint=false overrides wide terminal', () => {
    const { lastFrame } = render(
      <ApprovalModeIndicator mode="default" cols={80} showHint={false} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Shift+Tab');
  });
});

describe('T-059: ApprovalModeIndicator — godMode override', () => {
  it('godMode=true overrides mode="default" to show GOD', () => {
    const { lastFrame } = render(
      <ApprovalModeIndicator mode="default" godMode={true} cols={80} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('GOD');
    expect(frame).not.toContain('BUILD');
  });

  it('godMode=false uses the specified mode', () => {
    const { lastFrame } = render(
      <ApprovalModeIndicator mode="plan" godMode={false} cols={80} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('PLAN');
  });
});

describe('T-059: ContextSummaryDisplay — counts', () => {
  beforeEach(() => {
    delete process.env['NO_COLOR'];
    delete process.env['GOLI_CLI_ACCESSIBILITY'];
    resetCapabilitiesCache();
  });

  it('renders all counts on wide terminals', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay
        agentsMdCount={2}
        mcpServerCount={3}
        skillCount={5}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('2');
    expect(frame).toContain('3');
    expect(frame).toContain('5');
  });

  it('renders without throwing for all-zero counts', () => {
    const { lastFrame } = render(<ContextSummaryDisplay cols={80} />);
    expect(lastFrame()).toBeDefined();
  });

  it('shows AGENTS.md count', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay agentsMdCount={3} cols={80} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('3');
  });

  it('shows MCP count', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay mcpServerCount={4} cols={80} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('4');
  });

  it('shows skill count', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay skillCount={7} cols={80} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('7');
  });

  it('shows separator (·) between items', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay
        agentsMdCount={1}
        mcpServerCount={2}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('·');
  });
});

describe('T-059: ContextSummaryDisplay — narrow mode', () => {
  beforeEach(() => {
    delete process.env['NO_COLOR'];
    delete process.env['GOLI_CLI_ACCESSIBILITY'];
    resetCapabilitiesCache();
  });

  it('hides zero counts on narrow terminals (<60 cols)', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay
        agentsMdCount={2}
        mcpServerCount={0}
        skillCount={0}
        cols={40}
      />,
    );
    const frame = lastFrame() ?? '';
    // agentsMdCount=2 should be shown.
    expect(frame).toContain('2');
    // mcpServerCount=0 and skillCount=0 should NOT add extra items
    // (but the number 0 might appear in other contexts; we just check
    // the frame doesn't have more than one visible item).
    // Count the number of "·" separators — should be 0 for a single item.
    const sepCount = (frame.match(/·/g) || []).length;
    expect(sepCount).toBe(0);
  });

  it('renders without throwing on very narrow terminals', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay agentsMdCount={1} cols={20} />,
    );
    expect(lastFrame()).toBeDefined();
  });
});

describe('T-059: ContextSummaryDisplay — screen-reader mode', () => {
  beforeEach(() => {
    process.env['NO_COLOR'] = '1';
    process.env['GOLI_CLI_ACCESSIBILITY'] = '1';
    resetCapabilitiesCache();
  });

  afterEach(() => {
    delete process.env['NO_COLOR'];
    delete process.env['GOLI_CLI_ACCESSIBILITY'];
    resetCapabilitiesCache();
  });

  it('renders plain text labels in SR mode', () => {
    const { lastFrame } = render(
      <ContextSummaryDisplay
        agentsMdCount={2}
        mcpServerCount={3}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    // SR mode uses "AGENTS.md:" and "MCP:" labels.
    expect(frame).toContain('AGENTS.md');
    expect(frame).toContain('MCP');
  });
});
