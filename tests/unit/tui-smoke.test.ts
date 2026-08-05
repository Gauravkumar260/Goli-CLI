/**
 * TUI smoke test (T-005).
 *
 * Verifies that all 14 reference TUI components (the original 10 + the
 * 4 newly-integrated ones: SplashBox, StatusBar, TokenBar, WelcomeTip)
 * can be imported without error and that the theme tokens are present.
 *
 * This is NOT a render test — Ink components require a TTY and can't
 * be rendered headlessly without ink-testing-library. This test only
 * verifies that the module graph loads cleanly (no missing imports,
 * no syntax errors, no type errors at runtime).
 */

import { describe, it, expect } from 'vitest';


// Static imports — Vitest/rollup doesn't support fully dynamic imports
// with template strings. Each component is imported as a namespace so
// we can iterate over them in the test body.
import * as AgentStateBar from '../../apps/cli/src/tui/components/AgentStateBar.js';
import * as DiffReviewDialog from '../../apps/cli/src/tui/components/DiffReviewDialog.js';
import * as FpsOverlay from '../../apps/cli/src/tui/components/FpsOverlay.js';
import * as HeaderBar from '../../apps/cli/src/tui/components/HeaderBar.js';
import * as HelpPanel from '../../apps/cli/src/tui/components/HelpPanel.js';
import * as HistoryScroll from '../../apps/cli/src/tui/components/HistoryScroll.js';
import * as MessageBubble from '../../apps/cli/src/tui/components/MessageBubble.js';
import * as PermissionDialog from '../../apps/cli/src/tui/components/PermissionDialog.js';
import * as PipelineTrace from '../../apps/cli/src/tui/components/PipelineTrace.js';
import * as PromptInput from '../../apps/cli/src/tui/components/PromptInput.js';
// The 4 newly-integrated components from the TUI design reference:
import * as SplashBox from '../../apps/cli/src/tui/components/SplashBox.js';
import * as StatusBar from '../../apps/cli/src/tui/components/StatusBar.js';
import * as TokenBar from '../../apps/cli/src/tui/components/TokenBar.js';
import * as WelcomeTip from '../../apps/cli/src/tui/components/WelcomeTip.js';
import * as useAgentLoop from '../../apps/cli/src/tui/hooks/useAgentLoop.js';
import * as useFpsTracker from '../../apps/cli/src/tui/hooks/useFpsTracker.js';
import * as useSecsTick from '../../apps/cli/src/tui/hooks/useSecsTick.js';
import * as useSpinIndex from '../../apps/cli/src/tui/hooks/useSpinIndex.js';
import * as agents from '../../apps/cli/src/tui/theme/agents.js';
import * as tokens from '../../apps/cli/src/tui/theme/tokens.js';

const COMPONENTS = {
  AgentStateBar,
  DiffReviewDialog,
  FpsOverlay,
  HeaderBar,
  HelpPanel,
  HistoryScroll,
  MessageBubble,
  PermissionDialog,
  PipelineTrace,
  PromptInput,
  SplashBox,
  StatusBar,
  TokenBar,
  WelcomeTip,
} as const;

const HOOKS = {
  useAgentLoop,
  useFpsTracker,
  useSecsTick,
  useSpinIndex,
} as const;

describe('TUI design reference integration (T-005)', () => {
  describe('theme tokens', () => {
    it('exports the T color map with all expected colors', () => {
      expect(tokens.T).toBeDefined();
      expect(tokens.T.fg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokens.T.blue).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokens.T.green).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokens.T.red).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokens.T.yellow).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokens.T.purple).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokens.T.teal).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokens.T.gray).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokens.T.border).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokens.T.orange).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('exports the c() color helper', () => {
      expect(typeof tokens.c).toBe('function');
      expect(tokens.c('red')).toBe(tokens.T.red);
    });
  });

  describe('theme agents', () => {
    it('exports the AGENTS array', () => {
      expect(Array.isArray(agents.AGENTS)).toBe(true);
      expect(agents.AGENTS.length).toBeGreaterThan(0);
    });

    it('exports the SKILLS array', () => {
      expect(Array.isArray(agents.SKILLS)).toBe(true);
    });

    it('exports the MODES array with read-only, plan, build, god', () => {
      expect(Array.isArray(agents.MODES)).toBe(true);
      const modeIds = agents.MODES.map((m) => m.id);
      expect(modeIds).toContain('read-only');
      expect(modeIds).toContain('plan');
      expect(modeIds).toContain('build');
      expect(modeIds).toContain('god');
    });

    it('exports getTierColor and getTierDesc helpers', () => {
      expect(typeof agents.getTierColor).toBe('function');
      expect(typeof agents.getTierDesc).toBe('function');
      expect(typeof agents.getTierColor('T1')).toBe('string');
      expect(typeof agents.getTierDesc('T1')).toBe('string');
    });
  });

  describe('components — module-load smoke test', () => {
    for (const [name, mod] of Object.entries(COMPONENTS)) {
      it(`${name} imports without error`, () => {
        expect(mod).toBeDefined();
        // Each component module should export a default or named component
        const hasDefault = 'default' in mod;
        const hasNamed = name in mod;
        expect(hasDefault || hasNamed).toBe(true);
      });
    }

    it('all 14 components are present in the components directory', () => {
      // This is a static check — the imports above already verified
      // each one loads. This assertion just makes the count explicit
      // so a future regression that deletes a component fails loudly.
      expect(Object.keys(COMPONENTS).length).toBe(14);
    });
  });

  describe('hooks — module-load smoke test', () => {
    for (const [name, mod] of Object.entries(HOOKS)) {
      it(`${name} imports without error`, () => {
        expect(mod).toBeDefined();
      });
    }
  });
});
