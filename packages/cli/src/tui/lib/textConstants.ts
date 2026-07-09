/**
 * lib/textConstants.ts — Centralized TUI text strings (T-055).
 *
 * Reference: gemini-cli's `textConstants.ts` centralizes all user-facing
 * strings so they can be localized, audited for screen-reader variants,
 * and tweaked without hunting through component code.
 *
 * We expose two variants of key strings:
 *   - DEFAULT:    the visual-mode string (with emoji/box-drawing/short forms)
 *   - SCREEN_READER: the screen-reader-friendly string (plain text, no
 *                   decoration, more verbose for AT users)
 *
 * Components should pick the variant based on `useIsScreenReaderEnabled()`.
 *
 * @module tui/lib/textConstants
 */

/**
 * Status strings shown in the status bar / header.
 */
export const STATUS = {
  READY: 'Ready',
  BUSY: 'Busy',
  THINKING: 'Thinking',
  TOOL_CALLING: 'Calling tool',
  RESPONDING: 'Responding',
  WAITING_FOR_CONFIRMATION: 'Waiting for confirmation',
  COMPACTING: 'Compacting context',
  STARTING: 'Starting',
  SHUTTING_DOWN: 'Shutting down',
} as const;

/**
 * Screen-reader-friendly variants of status strings.
 * These are more verbose because screen-reader users can't glance at a
 * spinner to infer state.
 */
export const SCREEN_READER_STATUS = {
  READY: 'Goli-CLI is ready. Type a prompt and press Enter.',
  BUSY: 'Goli-CLI is busy. Press Escape to interrupt.',
  THINKING: 'Agent is thinking. Please wait.',
  TOOL_CALLING: 'Agent is calling a tool. Please wait.',
  RESPONDING: 'Agent is responding. Please wait.',
  WAITING_FOR_CONFIRMATION: 'Agent is waiting for your confirmation. Press Y to approve or N to deny.',
  COMPACTING: 'Compacting context to save tokens. Please wait.',
  STARTING: 'Goli-CLI is starting up. Please wait.',
  SHUTTING_DOWN: 'Goli-CLI is shutting down. Goodbye.',
} as const;

/**
 * Loading phrases shown next to the spinner.
 * gemini-cli's `usePhraseCycler` cycles through these.
 */
export const LOADING_PHRASES = [
  'Working',
  'Thinking',
  'Processing',
  'Analyzing',
  'Generating',
  'Composing',
  'Pondering',
  'Reflecting',
] as const;

/**
 * Witty loading phrases (shown occasionally for delight).
 * Disabled in screen-reader mode (verbose humor is annoying via TTS).
 */
export const WITTY_PHRASES = [
  'Consulting the rubber duck',
  'Counting electrons',
  'Aligning brackets',
  'Herding cats',
  'Brewing coffee',
  'Deciding what to have for lunch',
] as const;

/**
 * Spinner alt text for screen-reader mode.
 * When SR is enabled, the spinner renders this static text instead of
 * cycling through frames (which would be announced every 100ms — chaos).
 */
/** Screen-reader alt text for the loading spinner (replaces animated frames). */
export const SCREEN_READER_LOADING = 'Loading (please wait)';
/** Screen-reader alt text when the agent is responding to a prompt. */
export const SCREEN_READER_RESPONDING = 'Agent is responding (please wait)';
/** Screen-reader alt text when the agent is in the thinking phase. */
export const SCREEN_READER_THINKING = 'Agent is thinking (please wait)';

/**
 * Prefix shown before the user's input prompt in screen-reader mode.
 * Visual mode uses just `>` or `❯`; screen-reader mode announces
 * "Goli-CLI prompt:" so AT users know where they are.
 */
export const SCREEN_READER_USER_PREFIX = 'Goli-CLI prompt:';

/**
 * Permission dialog text variants.
 * The visual mode uses short y/n keys; SR mode spells out the action.
 */
export const PERMISSION = {
  APPROVE_KEY: 'y',
  DENY_KEY: 'n',
  ALWAYS_KEY: 'a',
  VIEW_KEY: 'v',
  EDIT_KEY: 'e',
  APPROVE_LABEL: 'Yes, approve',
  DENY_LABEL: 'No, deny',
  ALWAYS_LABEL: 'Always allow this tool',
  VIEW_LABEL: 'View details',
  EDIT_LABEL: 'Edit before approving',
} as const;

/**
 * Screen-reader-friendly permission dialog strings (verbose, no key abbreviations).
 */
export const SCREEN_READER_PERMISSION = {
  PROMPT: 'A tool is requesting permission. Press Y to approve, N to deny, or A to always allow this tool.',
  APPROVED: 'Tool approved.',
  DENIED: 'Tool denied.',
} as const;

/**
 * Banner / tip strings.
 */
export const WELCOME_TIP = 'Welcome to Goli-CLI! Type your message or /help for commands.';
/** Screen-reader-friendly welcome tip (verbose, spells out /help). */
export const SCREEN_READER_WELCOME = 'Welcome to Goli-CLI. Type a prompt and press Enter, or type slash and help for the command list.';

/**
 * Tier legend shown in the welcome tip (visual mode only).
 * T0=read T1=write T2=exec T3=net BLK=all
 */
export const TIER_LEGEND = 'T0=read  T1=write  T2=exec  T3=net  BLK=all';

/**
 * Error / warning prefixes.
 * In SR mode, these are spelled out so AT users hear the severity.
 */
/** Visual-mode error prefix (compact). */
export const ERROR_PREFIX = 'Error';
/** Visual-mode warning prefix (compact). */
export const WARNING_PREFIX = 'Warning';
/** Screen-reader-friendly error prefix (spelled out with colon). */
export const SCREEN_READER_ERROR_PREFIX = 'Error:';
/** Screen-reader-friendly warning prefix (spelled out with colon). */
export const SCREEN_READER_WARNING_PREFIX = 'Warning:';

/**
 * Get the appropriate status string for the given mode.
 * @param mode 'visual' or 'screen-reader'
 * @param key  status key (e.g. 'READY', 'BUSY')
 */
export function getStatusText(
  mode: 'visual' | 'screen-reader',
  key: keyof typeof STATUS,
): string {
  if (mode === 'screen-reader') {
    return SCREEN_READER_STATUS[key];
  }
  return STATUS[key];
}

/**
 * Get the appropriate loading phrase for the given mode.
 * In SR mode, returns a stable "Loading (please wait)" instead of cycling.
 *
 * @param mode          'visual' or 'screen-reader'
 * @param phraseIdx     index into LOADING_PHRASES (visual mode only)
 */
export function getLoadingText(
  mode: 'visual' | 'screen-reader',
  phraseIdx = 0,
): string {
  if (mode === 'screen-reader') return SCREEN_READER_LOADING;
  return LOADING_PHRASES[phraseIdx % LOADING_PHRASES.length]!;
}
