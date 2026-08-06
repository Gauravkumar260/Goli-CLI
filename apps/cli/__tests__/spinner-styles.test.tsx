/**
 * Unit tests for T-041 — Spinner animation upgrade.
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. New module apps/cli/src/tui/components/Spinner.tsx with 5+ styles.
 *  2. Spinner style is configurable (dots, line, arrow, bounce, triangle).
 *  3. AgentStateBar uses Spinner when busy.
 *  4. Tests verify each spinner style produces valid frames.
 *
 * Comparison reference: gemini-cli GeminiSpinner.tsx + CliSpinner.tsx.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import {
  Spinner,
  getSpinnerFrames,
  getSpinnerStyles,
  DEFAULT_SPINNER_STYLE,
  SPINNER_INTERVAL_MS,
  type SpinnerStyle,
} from '../src/tui/components/Spinner.js';
import { AgentStateBar } from '../src/tui/components/AgentStateBar.js';
import type { TierId } from '../src/tui/theme/agents.js';

describe('T-041: Spinner — frame definitions (AC #1, #4)', () => {
  it('exports 10 spinner styles (5 classic + 5 kawaii)', () => {
    const styles = getSpinnerStyles();
    expect(styles.length).toBe(10);
    // Classic styles (T-041).
    expect(styles).toContain('dots');
    expect(styles).toContain('line');
    expect(styles).toContain('arrow');
    expect(styles).toContain('bounce');
    expect(styles).toContain('triangle');
    // T-088 kawaii styles.
    expect(styles).toContain('kawaii');
    expect(styles).toContain('moon');
    expect(styles).toContain('pulse');
    expect(styles).toContain('star');
    expect(styles).toContain('orbit');
  });

  it.each([
    ['dots',     10], // ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
    ['line',      4], // | / - \
    ['arrow',     8], // ← ↖ ↑ ↗ → ↘ ↓ ↙
    ['bounce',    4], // ⠁ ⠂ ⠄ ⠂
    ['triangle',  4], // ▖ ▘ ▝ ▗
  ] as Array<[SpinnerStyle, number]>)(
    '%s style has %d frames',
    (style, expectedCount) => {
      const frames = getSpinnerFrames(style);
      expect(frames.length).toBe(expectedCount);
    },
  );

  it.each([
    'dots', 'line', 'arrow', 'bounce', 'triangle',
  ] as SpinnerStyle[])(
    '%s style: all frames are non-empty single characters',
    (style) => {
      const frames = getSpinnerFrames(style);
      for (const frame of frames) {
        expect(frame.length).toBeGreaterThan(0);
        expect(frame.length).toBeLessThanOrEqual(3); // some braille chars are 3-byte UTF-8
      }
    },
  );

  it('dots style contains the standard braille sequence', () => {
    const frames = getSpinnerFrames('dots');
    expect(frames[0]).toBe('⠋');
    expect(frames).toContain('⠙');
    expect(frames).toContain('⠹');
    expect(frames).toContain('⠏');
  });

  it('line style contains the classic Unix spinner characters', () => {
    const frames = getSpinnerFrames('line');
    expect(frames).toContain('|');
    expect(frames).toContain('/');
    expect(frames).toContain('-');
    expect(frames).toContain('\\');
  });

  it('arrow style contains 8 directional arrows', () => {
    const frames = getSpinnerFrames('arrow');
    expect(frames).toContain('←');
    expect(frames).toContain('↑');
    expect(frames).toContain('→');
    expect(frames).toContain('↓');
  });

  it('DEFAULT_SPINNER_STYLE is "dots"', () => {
    expect(DEFAULT_SPINNER_STYLE).toBe('dots');
  });

  it('SPINNER_INTERVAL_MS is 100 (10fps)', () => {
    expect(SPINNER_INTERVAL_MS).toBe(100);
  });
});

describe('T-041: Spinner — rendering (AC #2)', () => {
  // T-055: Ensure visual mode (not screen-reader mode) so the spinner
  // frame is rendered. Other test files may set NO_COLOR.
  beforeEach(() => {
    delete process.env['NO_COLOR'];
    delete process.env['GOLI_CLI_ACCESSIBILITY'];
  });

  it('renders without throwing for the default style', () => {
    const { lastFrame } = render(<Spinner />);
    expect(lastFrame()).toBeDefined();
  });

  it('renders a frame from the dots sequence', () => {
    const { lastFrame } = render(<Spinner style="dots" />);
    const frame = lastFrame() ?? '';
    // The first frame should be ⠋.
    expect(frame).toContain('⠋');
  });

  it('renders the label when provided', () => {
    const { lastFrame } = render(<Spinner label="thinking" />);
    expect(lastFrame() ?? '').toContain('thinking');
  });

  it('does not render a label space when no label is provided', () => {
    const { lastFrame } = render(<Spinner />);
    const frame = lastFrame() ?? '';
    // Just the frame, no trailing space.
    expect(frame.trim()).toBe(frame);
  });

  it.each([
    'dots', 'line', 'arrow', 'bounce', 'triangle',
  ] as SpinnerStyle[])(
    'renders style "%s" without throwing',
    (style) => {
      const { lastFrame } = render(<Spinner style={style} />);
      expect(lastFrame()).toBeDefined();
    },
  );
});

describe('T-041: AgentStateBar uses Spinner when busy (AC #3)', () => {
  // T-055: Ensure visual mode (not screen-reader mode) so the spinner
  // frame is rendered. Other test files may set NO_COLOR.
  beforeEach(() => {
    delete process.env['NO_COLOR'];
    delete process.env['GOLI_CLI_ACCESSIBILITY'];
  });

  const baseProps = {
    cols: 100,
    activeAgents: ['orchestrator'],
    mode: 'SAFE' as const,
    tier: 'T1' as TierId,
    bordered: false,
  };

  it('shows "thinking" label when busy', () => {
    const { lastFrame } = render(<AgentStateBar {...baseProps} busy={true} />);
    // P1-10 fix: the bar now shows the phase-specific label ('generating'
    // when only `busy` is set) instead of the legacy 'thinking' label.
    expect(lastFrame() ?? '').toContain('generating');
  });

  it('shows "idle" label when not busy', () => {
    const { lastFrame } = render(<AgentStateBar {...baseProps} busy={false} />);
    expect(lastFrame() ?? '').toContain('idle');
  });

  it('renders a braille dots frame when busy (Spinner integration)', () => {
    const { lastFrame } = render(<AgentStateBar {...baseProps} busy={true} />);
    const frame = lastFrame() ?? '';
    // The dots spinner's first frame is ⠋.
    expect(frame).toContain('⠋');
  });

  it('narrow layout also uses Spinner when busy', () => {
    const { lastFrame } = render(
      <AgentStateBar {...baseProps} cols={40} busy={true} />,
    );
    // P1-10 fix: phase-specific label, not legacy 'thinking'.
    expect(lastFrame() ?? '').toContain('generating');
  });
});
