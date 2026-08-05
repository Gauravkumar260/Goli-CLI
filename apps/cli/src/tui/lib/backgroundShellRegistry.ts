/**
 * lib/backgroundShellRegistry.ts — Registry for background shells (T-098).
 *
 * The core `background-shell.ts` tool manages child processes, but the
 * TUI has no way to display them. This registry tracks shell metadata
 * (id, command, status, startedAt) so the /bg command and a future
 * BackgroundShellPanel can render them.
 *
 * The registry is populated when the agent starts a background shell
 * (via a callback from the tool layer) and queried by the /bg command.
 *
 * @module lib/backgroundShellRegistry
 */

/** A background shell entry for display. */
export interface BackgroundShellEntry {
  /** Unique shell ID. */
  id: string;
  /** The command being run. */
  command: string;
  /** When the shell was started (ms since epoch). */
  startedAt: number;
  /** Whether the shell is still running. */
  running: boolean;
  /** Exit code (if exited). */
  exitCode?: number;
}

/** Active background shells. */
let shells: BackgroundShellEntry[] = [];

/** Listeners that fire when the registry changes. */
const listeners = new Set<(shells: BackgroundShellEntry[]) => void>();

/**
 * Register a new background shell.
 */
export function registerShell(id: string, command: string): void {
  const entry: BackgroundShellEntry = {
    id,
    command,
    startedAt: Date.now(),
    running: true,
  };
  shells = [...shells, entry];
  notifyListeners();
}

/**
 * Mark a shell as exited.
 */
export function markShellExited(id: string, exitCode: number): void {
  shells = shells.map((s) =>
    s.id === id ? { ...s, running: false, exitCode } : s,
  );
  notifyListeners();
}

/**
 * Remove a shell from the registry.
 */
export function removeShell(id: string): void {
  shells = shells.filter((s) => s.id !== id);
  notifyListeners();
}

/**
 * Get all registered shells.
 */
export function getShells(): BackgroundShellEntry[] {
  return [...shells];
}

/**
 * Clear all shells.
 */
export function clearShells(): void {
  shells = [];
  notifyListeners();
}

/**
 * Subscribe to registry changes.
 */
export function subscribeToShells(fn: (shells: BackgroundShellEntry[]) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function notifyListeners(): void {
  listeners.forEach((fn) => fn(getShells()));
}
