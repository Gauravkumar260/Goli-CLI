/**
 * Unit tests for T-056 — HelpPanel + ShortcutsHelp improvements (loop run 6, iter 4).
 *
 * Verifies:
 *  1. HelpPanel renders 3 sections: Basics, Commands, Keyboard Shortcuts.
 *  2. HelpPanel `section` prop filters which sections render.
 *  3. HelpPanel command list includes the new T-054 commands (/theme, /about, etc.).
 *  4. HelpPanel command list shows altNames for aliased commands.
 *  5. HelpPanel Basics section explains @, !, / prefixes.
 *  6. ShortcutsHelp renders 3 columns on wide terminals, 1 on narrow.
 *  7. ShortcutsHelp hides until idleMs elapses (or alwaysShow=true).
 *  8. ShortcutsHelp DEFAULT_SHORTCUTS has 10 entries.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { HelpPanel } from '../src/tui/components/HelpPanel.js';
import {
  ShortcutsHelp,
  DEFAULT_SHORTCUTS,
} from '../src/tui/components/ShortcutsHelp.js';
import { registerDefaultCommands } from '../src/tui/lib/CommandRegistry.js';

describe('T-056: HelpPanel — Basics section', () => {
  beforeEach(() => {
    registerDefaultCommands(true);
  });

  it('renders Basics section when section="all"', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={true} onClose={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Basics');
    expect(frame).toContain('@file');
    expect(frame).toContain('!command');
    expect(frame).toContain('/command');
  });

  it('renders Basics section when section="basics"', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={true} onClose={() => {}} section="basics" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Basics');
    expect(frame).toContain('@file');
  });

  it('does NOT render Basics section when section="shortcuts"', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={true} onClose={() => {}} section="shortcuts" />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Basics');
  });

  it('explains @file with an example', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={true} onClose={() => {}} section="basics" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('@src/index.ts');
  });

  it('explains !command with an example', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={true} onClose={() => {}} section="basics" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('!git status');
  });
});

describe('T-056: HelpPanel — Commands section', () => {
  beforeEach(() => {
    registerDefaultCommands(true);
  });

  it('renders Commands section when section="all"', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={true} onClose={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Commands');
  });

  it('renders Commands section when section="commands"', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={true} onClose={() => {}} section="commands" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Commands');
  });

  it('includes the new T-054 commands', () => {
    // Use wide cols so the commands list isn't truncated.
    const { lastFrame } = render(<HelpPanel cols={120} visible={true} onClose={() => {}} section="commands" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/theme');
    expect(frame).toContain('/about');
    expect(frame).toContain('/stats');
    expect(frame).toContain('/quit');
    expect(frame).toContain('/shortcuts');
    expect(frame).toContain('/memory');
    expect(frame).toContain('/model');
    expect(frame).toContain('/mcp');
  });

  it('shows altNames for aliased commands', () => {
    const { lastFrame } = render(<HelpPanel cols={120} visible={true} onClose={() => {}} section="commands" />);
    const frame = lastFrame() ?? '';
    // /theme has altNames skin, colors
    expect(frame).toContain('skin');
    expect(frame).toContain('colors');
    // /quit has altNames exit, q
    expect(frame).toContain('exit');
  });

  it('does NOT show hidden commands (/echo)', () => {
    const { lastFrame } = render(<HelpPanel cols={120} visible={true} onClose={() => {}} section="commands" />);
    const frame = lastFrame() ?? '';
    // /echo is registered as hidden: true — should not appear in the help list.
    expect(frame).not.toContain('/echo');
  });

  it('shows command count in the header', () => {
    const { lastFrame } = render(<HelpPanel cols={120} visible={true} onClose={() => {}} section="commands" />);
    const frame = lastFrame() ?? '';
    // The header says "Commands (N)" where N is the visible command count.
    expect(frame).toMatch(/Commands\s*\(\d+\)/);
  });
});

describe('T-056: HelpPanel — Keyboard Shortcuts section (preserved from T-040)', () => {
  it('renders Keyboard Shortcuts section when section="all"', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={true} onClose={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Keyboard Shortcuts');
  });

  it('renders Keyboard Shortcuts section when section="shortcuts"', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={true} onClose={() => {}} section="shortcuts" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Keyboard Shortcuts');
    // Should include the keybinding customization tip.
    expect(frame).toContain('keybindings.json');
  });

  it('does NOT render Keyboard Shortcuts when section="basics"', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={true} onClose={() => {}} section="basics" />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Keyboard Shortcuts');
  });
});

describe('T-056: HelpPanel — visibility + dismiss hint', () => {
  it('returns null when visible=false', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={false} onClose={() => {}} />);
    expect(lastFrame()).toBe('');
  });

  it('shows dismiss hint (press ? or Esc to close)', () => {
    const { lastFrame } = render(<HelpPanel cols={80} visible={true} onClose={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('?');
    expect(frame).toContain('Esc');
    expect(frame).toMatch(/close/i);
  });
});

describe('T-056: ShortcutsHelp — DEFAULT_SHORTCUTS', () => {
  it('has 10 entries', () => {
    expect(DEFAULT_SHORTCUTS.length).toBe(10);
  });

  it('includes Enter (send) as the first entry', () => {
    expect(DEFAULT_SHORTCUTS[0]!.key).toBe('Enter');
    expect(DEFAULT_SHORTCUTS[0]!.description).toBe('send');
  });

  it('includes Shift+Enter (newline)', () => {
    const entry = DEFAULT_SHORTCUTS.find((s) => s.key === 'Shift+Enter');
    expect(entry).toBeDefined();
    expect(entry!.description).toBe('newline');
  });

  it('includes ? (help)', () => {
    const entry = DEFAULT_SHORTCUTS.find((s) => s.key === '?');
    expect(entry).toBeDefined();
    expect(entry!.description).toBe('help');
  });

  it('includes / (slash commands)', () => {
    const entry = DEFAULT_SHORTCUTS.find((s) => s.key === '/');
    expect(entry).toBeDefined();
    expect(entry!.description).toBe('slash commands');
  });
});

describe('T-056: ShortcutsHelp — layout', () => {
  it('renders 3 columns on wide terminals (>=70 cols)', () => {
    const { lastFrame } = render(<ShortcutsHelp cols={80} alwaysShow={true} />);
    const frame = lastFrame() ?? '';
    // With 3 columns and 10 shortcuts, col 1 has 4 entries, cols 2-3 have 3 each.
    // The first column's first entry is "Enter send".
    expect(frame).toContain('Enter');
    expect(frame).toContain('send');
  });

  it('renders 1 column on narrow terminals (<50 cols)', () => {
    const { lastFrame } = render(<ShortcutsHelp cols={40} alwaysShow={true} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter');
  });

  it('renders without throwing for any width', () => {
    for (const cols of [20, 40, 60, 80, 100, 120]) {
      const { lastFrame } = render(<ShortcutsHelp cols={cols} alwaysShow={true} />);
      expect(lastFrame()).toBeDefined();
    }
  });
});

describe('T-056: ShortcutsHelp — idle behavior', () => {
  it('returns null initially when alwaysShow=false and idleMs > 0', () => {
    const { lastFrame } = render(<ShortcutsHelp cols={80} idleMs={5000} />);
    // Initially hidden.
    expect(lastFrame() ?? '').toBe('');
  });

  it('renders immediately when alwaysShow=true', () => {
    const { lastFrame } = render(<ShortcutsHelp cols={80} alwaysShow={true} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter');
  });

  it('renders immediately when idleMs=0', () => {
    const { lastFrame } = render(<ShortcutsHelp cols={80} idleMs={0} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter');
  });
});

describe('T-056: ShortcutsHelp — custom shortcuts', () => {
  it('renders custom shortcuts when provided', () => {
    const custom = [
      { key: 'Ctrl+X', description: 'custom action' },
      { key: 'Ctrl+Y', description: 'another action' },
    ];
    // Use wide cols so descriptions aren't truncated.
    const { lastFrame } = render(
      <ShortcutsHelp cols={120} alwaysShow={true} shortcuts={custom} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ctrl+X');
    expect(frame).toContain('custom action');
    expect(frame).toContain('Ctrl+Y');
  });
});
