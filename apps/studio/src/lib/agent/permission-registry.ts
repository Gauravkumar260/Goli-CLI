/**
 * In-memory registry that bridges SSE-pending permission requests with
 * later POSTs from the client. Keys are toolCallIds; values are resolver
 * functions. Entries auto-expire after 5 minutes to avoid leaks.
 */
interface PendingEntry {
  resolve: (decision: 'allow' | 'deny') => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

class PermissionResolverRegistry {
  private map = new Map<string, PendingEntry>();

  waitFor(toolCallId: string, signal?: AbortSignal): Promise<'allow' | 'deny'> {
    return new Promise<'allow' | 'deny'>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.map.has(toolCallId)) {
          this.map.delete(toolCallId);
          reject(new Error('Permission request timed out after 5 minutes.'));
        }
      }, 5 * 60 * 1000);

      this.map.set(toolCallId, { resolve, reject, timer });

      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          this.map.delete(toolCallId);
          reject(new Error('Cancelled.'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  resolve(toolCallId: string, decision: 'allow' | 'deny'): boolean {
    const entry = this.map.get(toolCallId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.map.delete(toolCallId);
    entry.resolve(decision);
    return true;
  }

  cleanup(_sessionId: string) {
    // Optional: clear entries for a session. We don't track session->toolCallId
    // here, but the per-request timeout handles cleanup.
  }
}

/**
 *
 */
export const permissionResolverRegistry = new PermissionResolverRegistry();
