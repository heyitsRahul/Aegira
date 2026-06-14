/**
 * Aggregate, PII-free analytics. By design this can only ever hold integer
 * counters keyed by a fixed vocabulary of event names — there is no place to
 * put a user id, a location, or a session id (invariant 1 applies to analytics
 * too). It is the only kind of analytics consistent with the product's thesis:
 * we measure that something happened, never to whom or where.
 */
export interface Metrics {
  increment(name: string): void;
}

/** Default: counts nothing. Lets every call site stay unconditional. */
export class NoopMetrics implements Metrics {
  increment(_name: string): void {
    /* intentionally empty */
  }
}

export class InMemoryMetrics implements Metrics {
  private readonly counts = new Map<string, number>();

  increment(name: string): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
  }
}
