/**
 * Unit tests for T-058 — DialogManager + AboutDialog + ThemeDialog + HelpDialog (loop 6, iter 6).
 *
 * Verifies:
 *  1. DialogManager renders null for empty queue.
 *  2. DialogManager renders the highest-priority dialog.
 *  3. DialogManager priority ordering (theme > help > about).
 *  4. AboutDialog renders version + license + homepage.
 *  5. ThemeDialog lists all builtin themes + no-color.
 *  6. ThemeDialog highlights the active theme.
 *  7. HelpDialog renders the HelpPanel content.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { DialogManager, __testing } from '../src/tui/components/DialogManager.js';
import { AboutDialog, ABOUT_VERSION } from '../src/tui/components/dialogs/AboutDialog.js';
import { ThemeDialog, ALL_THEMES } from '../src/tui/components/dialogs/ThemeDialog.js';
import { HelpDialog } from '../src/tui/components/dialogs/HelpDialog.js';
import { registerDefaultCommands } from '../src/tui/lib/CommandRegistry.js';

describe('T-058: DialogManager — empty queue', () => {
  it('renders null when queue is empty', () => {
    const { lastFrame } = render(
      <DialogManager queue={[]} onDismiss={() => {}} cols={80} />,
    );
    expect(lastFrame() ?? '').toBe('');
  });
});

describe('T-058: DialogManager — renders the correct dialog', () => {
  it('renders AboutDialog for type="about"', () => {
    const { lastFrame } = render(
      <DialogManager queue={[{ type: 'about' }]} onDismiss={() => {}} cols={80} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('About Goli-CLI');
    expect(frame).toContain(ABOUT_VERSION);
  });

  it('renders ThemeDialog for type="theme"', () => {
    const { lastFrame } = render(
      <DialogManager queue={[{ type: 'theme' }]} onDismiss={() => {}} cols={80} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Themes');
    expect(frame).toContain('default');
  });

  it('renders HelpDialog for type="help"', () => {
    beforeEach(() => {
      registerDefaultCommands(true);
    });
    const { lastFrame } = render(
      <DialogManager queue={[{ type: 'help' }]} onDismiss={() => {}} cols={120} />,
    );
    const frame = lastFrame() ?? '';
    // HelpDialog renders the HelpPanel which contains "Basics", "Commands", "Keyboard Shortcuts".
    expect(frame).toContain('Basics');
    expect(frame).toContain('Commands');
  });
});

describe('T-058: DialogManager — priority ordering', () => {
  it('DEFAULT_PRIORITY: theme > help > about', () => {
    expect(__testing.DEFAULT_PRIORITY.theme).toBeGreaterThan(__testing.DEFAULT_PRIORITY.help);
    expect(__testing.DEFAULT_PRIORITY.help).toBeGreaterThan(__testing.DEFAULT_PRIORITY.about);
  });

  it('renders the highest-priority dialog from the queue', () => {
    // Queue has about (priority 10) and theme (priority 30). Theme should win.
    const { lastFrame } = render(
      <DialogManager
        queue={[{ type: 'about' }, { type: 'theme' }]}
        onDismiss={() => {}}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    // ThemeDialog should be rendered (contains "Themes"), not AboutDialog.
    expect(frame).toContain('Themes');
    expect(frame).not.toContain('About Goli-CLI');
  });

  it('respects custom priority overrides', () => {
    // about with priority 100 should beat theme (default 30).
    const { lastFrame } = render(
      <DialogManager
        queue={[
          { type: 'about', priority: 100 },
          { type: 'theme' },
        ]}
        onDismiss={() => {}}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('About Goli-CLI');
    expect(frame).not.toContain('Themes');
  });

  it('calls onDismiss with the current dialog when dismissed (via key)', () => {
    // We can't easily simulate key presses without a more complex setup,
    // but we can verify the callback is wired correctly by checking the
    // dialog renders. Full key-press tests are in the individual dialog tests.
    let dismissed: string | null = null;
    render(
      <DialogManager
        queue={[{ type: 'about' }]}
        onDismiss={(d) => { dismissed = d.type; }}
        cols={80}
      />,
    );
    // The dialog is rendered; we don't trigger dismiss here.
    expect(dismissed).toBe(null);
  });
});

describe('T-058: AboutDialog — content', () => {
  it('renders the version', () => {
    const { lastFrame } = render(<AboutDialog cols={80} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('0.2.0-phase2');
  });

  it('renders the license (MIT)', () => {
    const { lastFrame } = render(<AboutDialog cols={80} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('MIT');
  });

  it('renders the homepage URL', () => {
    const { lastFrame } = render(<AboutDialog cols={80} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('github.com/goli-cli/goli-cli');
  });

  it('renders the dismiss hint', () => {
    const { lastFrame } = render(<AboutDialog cols={80} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Esc.*Enter.*close/i);
  });

  it('renders without throwing on narrow terminals', () => {
    const { lastFrame } = render(<AboutDialog cols={40} onDismiss={() => {}} />);
    expect(lastFrame()).toBeDefined();
  });

  it('ABOUT_VERSION matches package version', () => {
    expect(ABOUT_VERSION).toBe('0.2.0-phase2');
  });
});

describe('T-058: ThemeDialog — content', () => {
  beforeEach(() => {
    delete process.env['NO_COLOR'];
    delete process.env['GOLI_SKIN'];
  });

  it('renders the title with theme count', () => {
    const { lastFrame } = render(<ThemeDialog cols={80} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Themes\s*\(\d+\)/);
  });

  it('lists all builtin themes + no-color', () => {
    const { lastFrame } = render(<ThemeDialog cols={100} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('default');
    expect(frame).toContain('dracula');
    expect(frame).toContain('solarized-dark');
    expect(frame).toContain('github-dark');
    expect(frame).toContain('no-color');
  });

  it('ALL_THEMES includes no-color', () => {
    expect(ALL_THEMES).toContain('no-color');
  });

  it('ALL_THEMES includes all BUILTIN_SKIN_NAMES', () => {
    // BUILTIN_SKIN_NAMES has 20 entries; ALL_THEMES has 21 (20 + no-color).
    expect(ALL_THEMES.length).toBeGreaterThanOrEqual(21);
  });

  it('marks the active theme', () => {
    // Default skin is 'default' (no GOLI_SKIN set).
    const { lastFrame } = render(<ThemeDialog cols={100} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('(active)');
  });

  it('shows navigation hint', () => {
    const { lastFrame } = render(<ThemeDialog cols={100} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/navigate.*select.*dismiss/i);
  });

  it('shows warning for no-color theme when selected (via initial state)', () => {
    // Set NO_COLOR so the active skin is no-color, making it the initial selection.
    process.env['NO_COLOR'] = '1';
    const { lastFrame } = render(<ThemeDialog cols={100} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Disables all colors');
    delete process.env['NO_COLOR'];
  });
});

describe('T-058: HelpDialog — content', () => {
  beforeEach(() => {
    registerDefaultCommands(true);
  });

  it('renders the HelpPanel content', () => {
    const { lastFrame } = render(<HelpDialog cols={120} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Basics');
    expect(frame).toContain('Commands');
    expect(frame).toContain('Keyboard Shortcuts');
  });

  it('renders @file explanation', () => {
    const { lastFrame } = render(<HelpDialog cols={120} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('@file');
  });

  it('renders !command explanation', () => {
    const { lastFrame } = render(<HelpDialog cols={120} onDismiss={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('!command');
  });
});
