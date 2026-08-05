/**
 * hooks/useThemeVersion.ts — React hook for live theme switching (T-076).
 *
 * Subscribes to theme version changes from tokens.ts. Returns the current
 * version number, which increments every time `applySkinToTokens()` is
 * called. Components that use this hook re-render on theme switch.
 *
 * Usage in App.tsx:
 *   const themeVersion = useThemeVersion();
 *   // themeVersion is read but not used directly — its mere presence
 *   // in the render scope ensures the component re-renders when the
 *   // theme changes, picking up the new T.red / T.blue / etc. values.
 */
import { useState, useEffect } from 'react';
import { subscribeToThemeVersion, getThemeVersion } from '../theme/tokens.js';

/**
 * Returns the current theme version. Re-renders the calling component
 * whenever the theme changes (via applySkinToTokens()).
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(getThemeVersion());
  useEffect(() => {
    return subscribeToThemeVersion((v) => setVersion(v));
  }, []);
  return version;
}
