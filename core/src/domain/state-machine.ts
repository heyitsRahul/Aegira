import { SessionEventType, SessionState } from './types';

/**
 * The single source of truth for session lifecycle. Every state change in
 * the system goes through transition(); nothing may UPDATE session state
 * directly (invariant 2).
 *
 * Deliberate properties of this table:
 *  - CANCELLED is reachable ONLY from PENDING. A visible cancel after
 *    activation would be a coercion lever (invariant 3).
 *  - PURGED is reachable only from CLOSED, and only via DATA_PURGED, which
 *    is emitted by the crypto-shred purge path (invariant 7).
 *  - PURGED is terminal.
 *  - TRIGGERED and WATCH_ARMED are genesis-only and absent from every row.
 *  - ESCALATION_RAISED is a self-loop in every live emergency state: it
 *    records that the circle was re-alerted (nobody accepted in time, or a
 *    duress PIN was given at "I'm safe") without changing the state.
 *  - WATCHING (timed journey check-in) ends benignly via CHECKIN_SAFE →
 *    RESOLVED (nobody was ever alerted), or escalates to a real emergency
 *    via WATCH_ESCALATED → ACTIVE (deadline missed, or a duress check-in).
 *    There is deliberately NO WATCHING → CANCELLED edge: CANCELLED stays
 *    reachable only from PENDING (invariant 3).
 */
const TRANSITION_TABLE: Readonly<
  Record<SessionState, Partial<Readonly<Record<SessionEventType, SessionState>>>>
> = {
  WATCHING: {
    CHECKIN_SAFE: 'RESOLVED',
    WATCH_EXTENDED: 'WATCHING',
    WATCH_ESCALATED: 'ACTIVE',
  },
  PENDING: {
    ACTIVATED: 'ACTIVE',
    CANCEL_CONFIRMED: 'CANCELLED',
  },
  ACTIVE: {
    RESPONDER_ACCEPTED: 'DISPATCHED',
    SESSION_RESOLVED: 'RESOLVED',
    // Self-loop: records that contacts were re-alerted because nobody
    // accepted. An event, not a state, so the timeline stays auditable.
    ESCALATION_RAISED: 'ACTIVE',
  },
  DISPATCHED: {
    RESPONDER_ARRIVED: 'ARRIVED',
    SESSION_RESOLVED: 'RESOLVED',
    // Self-loop: contacts re-alerted mid-dispatch (a duress "I'm safe").
    ESCALATION_RAISED: 'DISPATCHED',
    // A no-show or withdrawal returns the session to ACTIVE so it can be
    // re-dispatched instead of hanging forever.
    RESPONDER_WITHDREW: 'ACTIVE',
  },
  ARRIVED: {
    SESSION_RESOLVED: 'RESOLVED',
    // Self-loop: contacts re-alerted (a duress "I'm safe" with the helper there).
    ESCALATION_RAISED: 'ARRIVED',
  },
  RESOLVED: {
    SESSION_CLOSED: 'CLOSED',
  },
  CANCELLED: {
    SESSION_CLOSED: 'CLOSED',
  },
  CLOSED: {
    DATA_PURGED: 'PURGED',
  },
  PURGED: {},
};

export const ALL_STATES: readonly SessionState[] = [
  'WATCHING',
  'PENDING',
  'ACTIVE',
  'DISPATCHED',
  'ARRIVED',
  'RESOLVED',
  'CANCELLED',
  'CLOSED',
  'PURGED',
];

export const ALL_EVENT_TYPES: readonly SessionEventType[] = [
  'TRIGGERED',
  'WATCH_ARMED',
  'WATCH_EXTENDED',
  'CHECKIN_SAFE',
  'WATCH_ESCALATED',
  'ACTIVATED',
  'CANCEL_CONFIRMED',
  'RESPONDER_ACCEPTED',
  'RESPONDER_WITHDREW',
  'RESPONDER_ARRIVED',
  'ESCALATION_RAISED',
  'SESSION_RESOLVED',
  'SESSION_CLOSED',
  'DATA_PURGED',
];

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: SessionState,
    public readonly event: SessionEventType,
  ) {
    super(`event ${event} is not legal in state ${from}`);
    this.name = 'IllegalTransitionError';
  }
}

/** Returns the next state, or throws IllegalTransitionError. */
export function transition(from: SessionState, event: SessionEventType): SessionState {
  const next = TRANSITION_TABLE[from][event];
  if (next === undefined) {
    throw new IllegalTransitionError(from, event);
  }
  return next;
}

export interface LegalTransition {
  readonly from: SessionState;
  readonly event: SessionEventType;
  readonly to: SessionState;
}

/** Full enumeration of the transition table, for exhaustive tests. */
export function legalTransitions(): readonly LegalTransition[] {
  const out: LegalTransition[] = [];
  for (const from of ALL_STATES) {
    const row = TRANSITION_TABLE[from];
    for (const event of ALL_EVENT_TYPES) {
      const to = row[event];
      if (to !== undefined) {
        out.push({ from, event, to });
      }
    }
  }
  return out;
}
