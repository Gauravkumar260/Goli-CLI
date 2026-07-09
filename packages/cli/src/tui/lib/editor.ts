/**
 * lib/editor.ts — Open \$EDITOR for multi-line input editing (T-080).
 *
 * Reference: gemini-cli's `openFileInEditor()` lets users press Ctrl+G
 * to open the current prompt in their \$EDITOR for multi-line editing.
 * Goli-CLI's keymap had `openEditor` bound to Ctrl+O but no implementation.
 *
 * Flow:
 *   1. Write the current prompt text to a temp file.
 *   2. Spawn \$EDITOR (or \$VISUAL, or 'vi' as fallback) on that file.
 *   3. Wait for the editor to exit.
 *   4. Read the file back.
 *   5. Delete the temp file.
 *   6. Return the edited text (caller injects it into the prompt).
 *
 * In a TUI context, Ink's renderer must be paused while the editor runs
 * (otherwise the terminal gets corrupted). The caller is responsible for
 * calling `instance.clear()` before and re-rendering after.
 *
 * @module lib/editor
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the user's preferred editor.
 *
 * Order of preference:
 *   1. \$EDITOR
 *   2. \$VISUAL
 *   3. 'vi' (universal fallback on Unix; on Windows, 'notepad')
 *
 * @returns The editor command string.
 */
export function getPreferredEditor(): string {
  const editor = process.env['EDITOR'];
  if (editor && editor.length > 0) return editor;
  const visual = process.env['VISUAL'];
  if (visual && visual.length > 0) return visual;
  return process.platform === 'win32' ? 'notepad' : 'vi';
}

/**
 * Open \$EDITOR with the given initial text and return the edited text.
 *
 * @param initialText The text to pre-fill the editor with.
 * @returns The edited text (may be empty if the user cleared the file).
 *          Returns null if the editor could not be spawned.
 */
export function openInEditor(initialText: string): string | null {
  const editor = getPreferredEditor();

  // Create a temp file with the initial text.
  const tempDir = mkdtempSync(join(tmpdir(), 'goli-editor-'));
  const tempFile = join(tempDir, 'prompt.md');
  try {
    writeFileSync(tempFile, initialText, 'utf-8');

    // Parse the editor command (may include args, e.g. "code --wait").
    const parts = editor.split(/\s+/);
    const cmd = parts[0]!;
    const args = [...parts.slice(1), tempFile];

    // Spawn the editor synchronously (blocks until the editor exits).
    const result = spawnSync(cmd, args, {
      stdio: 'inherit',
      env: process.env,
    });

    if (result.error || result.status !== 0) {
      // Editor failed to spawn or exited with an error.
      return null;
    }

    // Read the edited text back.
    const edited = readFileSync(tempFile, 'utf-8');
    return edited;
  } catch {
    return null;
  } finally {
    // Clean up the temp file + directory.
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
}
