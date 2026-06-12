import { createHash } from 'node:crypto';
import { transition } from './state-machine';
import { LifecycleEventType, SessionEvent, SessionState } from './types';

const GENESIS_PREV_HASH = '0'.repeat(64);

/** Deterministic JSON serialization (sorted keys) so hashes are stable. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function computeEventHash(event: Omit<SessionEvent, 'hash'>): string {
  return createHash('sha256')
    .update(
      stableStringify({
        seq: event.seq,
        sessionId: event.sessionId,
        type: event.type,
        at: event.at,
        data: event.data,
        prevHash: event.prevHash,
      }),
    )
    .digest('hex');
}

/**
 * The session aggregate: current state plus an append-only, hash-chained
 * event log. Recorded events are frozen and never mutated; new lifecycle
 * behavior means a new event appended through the state machine.
 */
export class SessionAggregate {
  private readonly _events: SessionEvent[] = [];
  private _state: SessionState;

  private constructor(sessionId: string, at: string, data: Record<string, unknown>) {
    this._state = 'PENDING';
    this._events.push(
      SessionAggregate.seal({
        seq: 0,
        sessionId,
        type: 'TRIGGERED',
        at,
        data: Object.freeze({ ...data }),
        prevHash: GENESIS_PREV_HASH,
      }),
    );
  }

  /** Creates a session in PENDING with its TRIGGERED genesis event. */
  static trigger(params: {
    sessionId: string;
    at: string;
    data: Record<string, unknown>;
  }): SessionAggregate {
    return new SessionAggregate(params.sessionId, params.at, params.data);
  }

  private static seal(event: Omit<SessionEvent, 'hash'>): SessionEvent {
    return Object.freeze({ ...event, hash: computeEventHash(event) });
  }

  get sessionId(): string {
    return this._events[0].sessionId;
  }

  get state(): SessionState {
    return this._state;
  }

  get events(): readonly SessionEvent[] {
    return [...this._events];
  }

  get lastEvent(): SessionEvent {
    return this._events[this._events.length - 1];
  }

  /**
   * Applies a lifecycle event. The state machine validates the transition
   * (throws IllegalTransitionError otherwise); the event is then appended
   * to the hash chain.
   */
  apply(type: LifecycleEventType, at: string, data: Record<string, unknown> = {}): SessionEvent {
    const next = transition(this._state, type);
    const prev = this.lastEvent;
    const event = SessionAggregate.seal({
      seq: this._events.length,
      sessionId: this.sessionId,
      type,
      at,
      data: Object.freeze({ ...data }),
      prevHash: prev.hash,
    });
    this._events.push(event);
    this._state = next;
    return event;
  }

  verifyChain(): boolean {
    return SessionAggregate.verifyEvents(this._events);
  }

  /** Verifies seq ordering, hash chaining, and per-event hashes. */
  static verifyEvents(events: readonly SessionEvent[]): boolean {
    if (events.length === 0 || events[0].type !== 'TRIGGERED') {
      return false;
    }
    let prevHash = GENESIS_PREV_HASH;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.seq !== i || event.prevHash !== prevHash) {
        return false;
      }
      if (computeEventHash(event) !== event.hash) {
        return false;
      }
      prevHash = event.hash;
    }
    return true;
  }
}
