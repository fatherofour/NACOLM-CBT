// In-memory lockout after repeated failed logins for the same service number.
// Single-process only; if the API is ever run as several instances, move this
// to the database or Redis.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

interface Entry {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Milliseconds until this key may try again, or 0. */
  lockedFor(key: string): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    return Math.max(0, e.lockedUntil - this.now());
  }

  recordFailure(key: string): void {
    const t = this.now();
    const e = this.entries.get(key);
    if (!e || t - e.firstFailureAt > WINDOW_MS) {
      this.entries.set(key, { failures: 1, firstFailureAt: t, lockedUntil: 0 });
      return;
    }
    e.failures++;
    if (e.failures >= MAX_FAILURES) e.lockedUntil = t + LOCK_MS;
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }
}
