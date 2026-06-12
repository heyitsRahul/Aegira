/**
 * Core domain types. This layer is pure TypeScript: no framework imports,
 * no I/O, no clocks. Time always arrives as a parameter (see Clock).
 */

/** Lifecycle states of an emergency session. */
export type SessionState =
  | 'PENDING'
  | 'ACTIVE'
  | 'DISPATCHED'
  | 'ARRIVED'
  | 'RESOLVED'
  | 'CANCELLED'
  | 'CLOSED'
  | 'PURGED';

/**
 * Event types. TRIGGERED is the genesis event that creates a session in
 * PENDING; it never appears in the transition table. All other lifecycle
 * behavior is an event type with an entry in the transition table.
 */
export type SessionEventType =
  | 'TRIGGERED'
  | 'ACTIVATED'
  | 'CANCEL_CONFIRMED'
  | 'RESPONDER_ACCEPTED'
  | 'RESPONDER_ARRIVED'
  | 'SESSION_RESOLVED'
  | 'SESSION_CLOSED'
  | 'DATA_PURGED';

/** Event types that may be applied to an existing session. */
export type LifecycleEventType = Exclude<SessionEventType, 'TRIGGERED'>;

/**
 * One entry in a session's append-only, hash-chained event log.
 * Events are immutable once recorded; `hash` covers every other field and
 * `prevHash` chains it to the previous event.
 */
export interface SessionEvent {
  readonly seq: number;
  readonly sessionId: string;
  readonly type: SessionEventType;
  /** ISO-8601 timestamp supplied by the injected Clock at append time. */
  readonly at: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly prevHash: string;
  readonly hash: string;
}

/**
 * Injected time source. Nothing in domain/ or services/ may read the
 * wall clock directly — timers must be testable with a manual clock.
 */
export interface Clock {
  now(): Date;
}

/**
 * A precise location. The sessionId field is mandatory by construction:
 * there is no type in this codebase that carries coordinates without a
 * session (invariant 1).
 */
export interface PreciseLocation {
  readonly sessionId: string;
  readonly lat: number;
  readonly lng: number;
  readonly capturedAt: string;
}

export type SessionCategory = 'personal_safety' | 'medical' | 'accident' | 'other';

/** Retention classes every table must declare in its migration. */
export type RetentionClass = 'durable' | 'incident-scoped' | 'ephemeral';

/**
 * A discrete, human-reviewable, appealable record of responder misbehavior.
 * Never aggregated into a numeric reputation (invariant 10).
 */
export interface StrikeRecord {
  readonly id: string;
  readonly responderId: string;
  readonly reason: string;
  readonly createdAt: string;
  status: 'open' | 'upheld' | 'dismissed';
  appealNote: string | null;
}
