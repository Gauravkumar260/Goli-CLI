/**
 * lib/expandedTools.ts — Reactive registry of expanded tool-call IDs (T-091).
 *
 * AgentMessage tracks expanded tool-call IDs in local state, but there
 * was no way to toggle expansion from outside the component (e.g. via
 * a /expand command or keybinding). This module provides a global
 * registry + subscription mechanism so:
 *
 *   1. The /expand command can toggle the most recent tool call.
 *   2. AgentMessage re-renders when a tool call's expansion changes.
 *
 * Usage in AgentMessage:
 *   const expandedIds = useExpandedTools();
 *   // expandedIds is a Set<string> that updates when toggleToolExpand()
 *   // is called.
 *
 * Usage in /expand command handler:
 *   toggleLastToolExpand(messageHistory);
 */

/** Set of currently-expanded tool-call IDs. */
let expandedIds = new Set<string>();

/** Listeners that fire when the set changes. */
const listeners = new Set<(ids: Set<string>) => void>();

/**
 * Get a snapshot of the currently-expanded tool-call IDs.
 */
export function getExpandedToolIds(): Set<string> {
  return new Set(expandedIds);
}

/**
 * Toggle a tool call's expansion state.
 * @param toolCallId The tool call ID to toggle.
 */
export function toggleToolExpand(toolCallId: string): void {
  const next = new Set(expandedIds);
  if (next.has(toolCallId)) {
    next.delete(toolCallId);
  } else {
    next.add(toolCallId);
  }
  expandedIds = next;
  listeners.forEach((fn) => fn(new Set(expandedIds)));
}

/**
 * Toggle the most recent tool call from a list of messages.
 * Finds the last agent message with tool calls and toggles its last tool call.
 * @returns The tool call ID that was toggled, or null if none found.
 */
export function toggleLastToolExpand(
  messages: Array<{ type: string; toolCalls?: Array<{ id: string }> }>,
): string | null {
  // Iterate from newest to oldest.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.type === 'agent' && msg.toolCalls && msg.toolCalls.length > 0) {
      const lastTool = msg.toolCalls[msg.toolCalls.length - 1]!;
      toggleToolExpand(lastTool.id);
      return lastTool.id;
    }
  }
  return null;
}

/**
 * Clear all expanded tool calls.
 */
export function clearExpandedTools(): void {
  expandedIds = new Set();
  listeners.forEach((fn) => fn(new Set(expandedIds)));
}

/**
 * Subscribe to expanded-tool changes. Returns an unsubscribe function.
 */
export function subscribeToExpandedTools(fn: (ids: Set<string>) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
