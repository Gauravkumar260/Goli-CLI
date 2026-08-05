/**
 * Client-safe helpers for generating IDs and parsing data.
 *
 * Kept separate from server-side storage modules so it can be imported
 * from client components without pulling in Prisma / Node-only deps.
 */

/** Generate a stable, URL-safe session id (client-safe). */
export function newSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `sess-${time}-${rand}`;
}

/** Generate a short unique id for transient UI items. */
export function newItemId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${rand}`;
}
