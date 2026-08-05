/**
 * hooks/useExpandedTools.ts — React hook for the expanded-tool registry (T-091).
 *
 * Returns a Set<string> of currently-expanded tool-call IDs. Re-renders
 * the calling component whenever the set changes (via toggleToolExpand()
 * or toggleLastToolExpand()).
 */
import { useState, useEffect } from 'react';
import { getExpandedToolIds, subscribeToExpandedTools } from '../lib/expandedTools.js';

/**
 * Returns a Set<string> of currently-expanded tool-call IDs. Re-renders
 * the calling component whenever the set changes.
 */
export function useExpandedTools(): Set<string> {
  const [ids, setIds] = useState(getExpandedToolIds());
  useEffect(() => {
    return subscribeToExpandedTools((next) => setIds(next));
  }, []);
  return ids;
}
