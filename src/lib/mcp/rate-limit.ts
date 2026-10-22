const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const MAX_ENTRIES = 1_000;

interface WindowState {
  count: number;
  resetsAt: number;
}

export class McpRequestRateLimiter {
  private readonly windows = new Map<string, WindowState>();

  allow(
    key: string,
    now = Date.now(),
  ): { allowed: true } | { allowed: false; retryAfter: number } {
    const current = this.windows.get(key);
    if (!current || current.resetsAt <= now) {
      this.trim(now);
      this.windows.set(key, { count: 1, resetsAt: now + WINDOW_MS });
      return { allowed: true };
    }
    if (current.count >= MAX_REQUESTS) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((current.resetsAt - now) / 1000)),
      };
    }
    current.count += 1;
    return { allowed: true };
  }

  private trim(now: number) {
    for (const [key, value] of this.windows) {
      if (value.resetsAt <= now || this.windows.size >= MAX_ENTRIES)
        this.windows.delete(key);
      if (this.windows.size < MAX_ENTRIES) break;
    }
  }
}
