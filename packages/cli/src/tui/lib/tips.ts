/**
 * lib/tips.ts — Rotating tips for the TUI footer (T-101).
 *
 * Reference: gemini-cli's `ui/constants/tips.ts` (157 entries) +
 * `useTips` hook. Goli-CLI has a static ShortcutsHelp panel but no
 * rotating tips.
 *
 * This module provides a curated list of tips covering:
 *   - Keyboard shortcuts
 *   - Slash commands
 *   - Features
 *   - Productivity hints
 *
 * The /tips command cycles through them, and a future TipsDisplay
 * component can show a rotating tip in the footer.
 *
 * @module lib/tips
 */

/** A tip entry. */
export interface Tip {
  /** The tip text. */
  text: string;
  /** The tip category. */
  category: 'shortcut' | 'command' | 'feature' | 'productivity';
}

/**
 * Curated list of tips for Goli-CLI.
 */
export const TIPS: readonly Tip[] = [
  // ─── Keyboard shortcuts ───────────────────────────────────────────
  { text: 'Press ? to toggle the shortcuts help panel', category: 'shortcut' },
  { text: 'Ctrl+L clears the terminal screen', category: 'shortcut' },
  { text: 'Ctrl+R starts a reverse-search through prompt history', category: 'shortcut' },
  { text: 'Ctrl+P opens the command palette for fuzzy command search', category: 'shortcut' },
  { text: 'Ctrl+O opens $EDITOR for multi-line prompt editing', category: 'shortcut' },
  { text: 'Ctrl+G toggles god mode (maximum autonomy)', category: 'shortcut' },
  { text: 'Ctrl+S toggles mouse scroll mode', category: 'shortcut' },
  { text: 'Shift+Tab cycles SAFE → GOD → PLAN permission modes', category: 'shortcut' },
  { text: 'Tab while the agent is busy queues a follow-up message', category: 'shortcut' },
  { text: 'Double-Esc clears the prompt input', category: 'shortcut' },
  { text: 'Ctrl+C twice exits the CLI (once aborts the current turn)', category: 'shortcut' },
  { text: 'Ctrl+D exits when the prompt is empty', category: 'shortcut' },
  { text: 'Ctrl+Z suspends the CLI (resume with fg)', category: 'shortcut' },
  { text: 'Up/Down arrows navigate prompt history when not in suggestion mode', category: 'shortcut' },
  { text: 'Shift+Enter inserts a newline for multi-line input', category: 'shortcut' },
  { text: 'Ctrl+J inserts a newline (alternative to Shift+Enter)', category: 'shortcut' },
  { text: 'Ctrl+K fast-approves the current permission request', category: 'shortcut' },
  { text: 'In vim mode: Esc switches to NORMAL, i returns to INSERT', category: 'shortcut' },
  { text: 'In vim NORMAL mode: h/j/k/l move the cursor', category: 'shortcut' },
  { text: 'In vim NORMAL mode: dd deletes the current line', category: 'shortcut' },
  { text: 'In vim NORMAL mode: 0 jumps to start of line, $ to end', category: 'shortcut' },
  { text: 'In vim NORMAL mode: w jumps to next word, b to previous', category: 'shortcut' },
  { text: 'In vim NORMAL mode: v enters VISUAL mode for selection', category: 'shortcut' },
  { text: 'In vim NORMAL mode: o opens a new line below and enters INSERT', category: 'shortcut' },
  { text: 'In vim NORMAL mode: x deletes the character under cursor', category: 'shortcut' },

  // ─── Slash commands ───────────────────────────────────────────────
  { text: '/help shows all available commands', category: 'command' },
  { text: '/theme opens the theme picker (20+ built-in skins)', category: 'command' },
  { text: '/about shows version and license info', category: 'command' },
  { text: '/stats shows session statistics (tokens, cost, turns)', category: 'command' },
  { text: '/cost shows a detailed token/cost breakdown', category: 'command' },
  { text: '/context shows all context sources (memory, MCP, skills)', category: 'command' },
  { text: '/vim toggles vim mode (INSERT/NORMAL/VISUAL)', category: 'command' },
  { text: '/expand toggles expansion of the most recent tool call', category: 'command' },
  { text: '/allowlist views or clears the session permission allowlist', category: 'command' },
  { text: '/queue views or clears queued follow-up messages', category: 'command' },
  { text: '/bg lists background shell processes', category: 'command' },
  { text: '/compact compresses the conversation to save context', category: 'command' },
  { text: '/design toggles the design splash screen', category: 'command' },
  { text: '/tier T0|T1|T2|T3|BLK sets the tool permission tier', category: 'command' },
  { text: '/tips shows a random tip; /tips list shows all tips', category: 'command' },
  { text: '/tips shortcut shows only keyboard shortcut tips', category: 'command' },
  { text: '/tips command shows only slash command tips', category: 'command' },
  { text: '/tips feature shows only feature tips', category: 'command' },
  { text: '/tips productivity shows only productivity tips', category: 'command' },
  { text: '/memory shows memory file info (AGENTS.md, .goli/ context)', category: 'command' },
  { text: '/model shows the current AI model in use', category: 'command' },
  { text: '/mcp shows MCP server configuration locations', category: 'command' },
  { text: '/plan switches to Plan mode (read-only, no file edits)', category: 'command' },
  { text: '/build switches to Build mode (default, full permissions)', category: 'command' },
  { text: '/godmode toggles god mode (alias for /tier BLK + mode GOD)', category: 'command' },
  { text: '/safemode switches to SAFE mode (restricted autonomy)', category: 'command' },
  { text: '/shortcuts shows the keyboard shortcuts reference', category: 'command' },
  { text: '/quit or /exit exits the CLI', category: 'command' },
  { text: '/clear clears the conversation history', category: 'command' },
  { text: '/stats shows elapsed time, model, tier, mode, workspace, branch', category: 'command' },

  // ─── Features ─────────────────────────────────────────────────────
  { text: '@ prefix triggers file-path Tab completion', category: 'feature' },
  { text: '! prefix triggers shell command Tab completion (git, npm)', category: 'feature' },
  { text: 'GOLI_TUI_DENSE_TOOLS=1 enables compact 1-line tool summaries', category: 'feature' },
  { text: 'Themes switch live — no restart needed (T-076)', category: 'feature' },
  { text: 'DiffReviewDialog shows diffs before file edits are applied', category: 'feature' },
  { text: 'Failed tool calls auto-expand to show error output', category: 'feature' },
  { text: 'Tool calls show duration and cost badges when available', category: 'feature' },
  { text: 'Paste placeholders collapse large pastes ([Pasted Text: N lines])', category: 'feature' },
  { text: 'Unicode-safe cursor handles emoji and CJK correctly', category: 'feature' },
  { text: 'The 11-agent swarm routes tasks: coder, reviewer, searcher, devops', category: 'feature' },
  { text: 'MCP (Model Context Protocol) servers extend the agent with custom tools', category: 'feature' },
  { text: 'Sandbox mode isolates tool execution (docker or local)', category: 'feature' },
  { text: 'Policy engine enforces tool-tier permissions (T0-T3, BLK)', category: 'feature' },
  { text: 'Cron jobs can run scheduled agent tasks (see /cron command)', category: 'feature' },
  { text: 'Custom slash commands can be added in .goli/commands/*.md', category: 'feature' },
  { text: 'User skins can be defined in ~/.goli/skins/*.yaml', category: 'feature' },
  { text: 'Screen-reader mode: --accessibility or GOLI_CLI_ACCESSIBILITY=1', category: 'feature' },
  { text: 'NO_COLOR env var disables all colors (accessibility convention)', category: 'feature' },
  { text: 'High-contrast skin for WCAG AAA compliance', category: 'feature' },
  { text: 'Colorblind skins: github-dark-colorblind, github-light-colorblind', category: 'feature' },
  { text: 'GOLI_TUI_FPS=1 shows a live FPS counter for debugging', category: 'feature' },
  { text: 'GOLI_TUI_DEBUG=1 shows render/idle/flicker counters', category: 'feature' },
  { text: 'The prompt supports multi-line input via Shift+Enter or Ctrl+J', category: 'feature' },
  { text: 'Reverse-search (Ctrl+R) filters history as you type', category: 'feature' },
  { text: 'Command palette (Ctrl+P) fuzzy-searches all slash commands', category: 'feature' },
  { text: '20 built-in themes including Dracula, Solarized, Nord, Monokai', category: 'feature' },
  { text: 'Skin border styles change with the theme (single, double, round, bold)', category: 'feature' },
  { text: 'Token bar shows context usage with color thresholds', category: 'feature' },
  { text: 'Context compaction hint appears at 95% token usage', category: 'feature' },

  // ─── Productivity ─────────────────────────────────────────────────
  { text: 'Create AGENTS.md to give the agent persistent project context', category: 'productivity' },
  { text: 'Use /tier T0 to restrict the agent to read-only tools', category: 'productivity' },
  { text: 'Queue multiple messages with Tab to batch follow-ups', category: 'productivity' },
  { text: 'Use /context to verify what context the agent has access to', category: 'productivity' },
  { text: 'Set EDITOR env var to use your preferred editor with Ctrl+O', category: 'productivity' },
  { text: 'Use /cost to monitor token usage and cost rate', category: 'productivity' },
  { text: 'GOLI_SKIN=<name> persists your theme across launches', category: 'productivity' },
  { text: 'Use /expand to inspect collapsed tool output', category: 'productivity' },
  { text: 'Plan mode (Shift+Tab) prevents file edits — safe for review', category: 'productivity' },
  { text: 'Use /compact when context is near the limit to free up tokens', category: 'productivity' },
  { text: 'Break complex tasks into smaller, focused prompts for better results', category: 'productivity' },
  { text: 'Use @ to include specific files as context: @src/index.ts', category: 'productivity' },
  { text: 'Use ! to run shell commands inline: !npm test', category: 'productivity' },
  { text: 'Set GOLI_DEFAULT_MODEL env var to change the default AI model', category: 'productivity' },
  { text: 'Set GOLI_SANDBOX=docker for isolated tool execution', category: 'productivity' },
  { text: 'Use /allowlist clear to revoke "always" approvals mid-session', category: 'productivity' },
  { text: 'Use /queue clear to cancel all queued follow-up messages', category: 'productivity' },
  { text: 'Check /stats regularly to track cost and token usage trends', category: 'productivity' },
  { text: 'Use vim mode (/vim) for efficient text editing without arrow keys', category: 'productivity' },
  { text: 'Press ? to see all keyboard shortcuts at any time', category: 'productivity' },
  { text: 'Custom commands in .goli/commands/ can automate repetitive tasks', category: 'productivity' },
  { text: 'Use /bg to check on long-running background processes', category: 'productivity' },
  { text: 'MCP servers can add domain-specific tools (databases, APIs, etc.)', category: 'productivity' },
  { text: 'Document project conventions in AGENTS.md for better agent decisions', category: 'productivity' },
  { text: 'Use tier T1 for safe file reads, T2 for writes, T3 for shell commands', category: 'productivity' },
  { text: 'The agent remembers context within a session — no need to repeat yourself', category: 'productivity' },
  { text: 'Use /tips to discover features you might not know about', category: 'productivity' },
  { text: 'Ctrl+O in $EDITOR is great for composing long, multi-line prompts', category: 'productivity' },
  { text: 'Reverse-search (Ctrl+R) is faster than Up-arrow for old commands', category: 'productivity' },
  { text: 'Dense tool mode (GOLI_TUI_DENSE_TOOLS=1) saves screen space', category: 'productivity' },
  { text: 'Use /context before a complex task to verify the agent has the right files', category: 'productivity' },
];

/**
 * Get a random tip.
 */
export function getRandomTip(): Tip {
  return TIPS[Math.floor(Math.random() * TIPS.length)] ?? TIPS[0]!;
}

/**
 * Get a tip by index (with modulo wrapping).
 */
export function getTip(index: number): Tip {
  return TIPS[index % TIPS.length] ?? TIPS[0]!;
}

/**
 * Get tips filtered by category.
 */
export function getTipsByCategory(category: Tip['category']): readonly Tip[] {
  return TIPS.filter((t) => t.category === category);
}

/**
 * Get the total number of tips.
 */
export function getTipCount(): number {
  return TIPS.length;
}
