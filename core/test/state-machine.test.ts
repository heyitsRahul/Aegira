import { describe, expect, it } from 'vitest';
import {
  ALL_EVENT_TYPES,
  ALL_STATES,
  IllegalTransitionError,
  LegalTransition,
  legalTransitions,
  transition,
} from '../src/domain/state-machine';
import { SessionEventType, SessionState } from '../src/domain/types';

/**
 * EXHAUSTIVE state machine coverage: every legal transition is asserted
 * individually, and every other (state, event) pair is proven to throw.
 * Any change to the transition table MUST update EXPECTED below.
 */

const EXPECTED: ReadonlyArray<[SessionState, SessionEventType, SessionState]> = [
  ['PENDING', 'ACTIVATED', 'ACTIVE'],
  ['PENDING', 'CANCEL_CONFIRMED', 'CANCELLED'],
  ['ACTIVE', 'RESPONDER_ACCEPTED', 'DISPATCHED'],
  ['ACTIVE', 'SESSION_RESOLVED', 'RESOLVED'],
  ['ACTIVE', 'ESCALATION_RAISED', 'ACTIVE'],
  ['DISPATCHED', 'RESPONDER_ARRIVED', 'ARRIVED'],
  ['DISPATCHED', 'SESSION_RESOLVED', 'RESOLVED'],
  ['DISPATCHED', 'RESPONDER_WITHDREW', 'ACTIVE'],
  ['ARRIVED', 'SESSION_RESOLVED', 'RESOLVED'],
  ['RESOLVED', 'SESSION_CLOSED', 'CLOSED'],
  ['CANCELLED', 'SESSION_CLOSED', 'CLOSED'],
  ['CLOSED', 'DATA_PURGED', 'PURGED'],
];

function expectedTarget(from: SessionState, event: SessionEventType): SessionState | undefined {
  return EXPECTED.find(([f, e]) => f === from && e === event)?.[2];
}

describe('state machine — exhaustive transition coverage', () => {
  it('covers all 8 states and 10 event types', () => {
    expect(ALL_STATES).toHaveLength(8);
    expect(ALL_EVENT_TYPES).toHaveLength(10);
  });

  for (const from of ALL_STATES) {
    for (const event of ALL_EVENT_TYPES) {
      const to = expectedTarget(from, event);
      if (to !== undefined) {
        it(`LEGAL: ${from} + ${event} -> ${to}`, () => {
          expect(transition(from, event)).toBe(to);
        });
      } else {
        it(`ILLEGAL: ${from} + ${event} throws`, () => {
          expect(() => transition(from, event)).toThrow(IllegalTransitionError);
        });
      }
    }
  }

  it('legalTransitions() enumerates exactly the expected table', () => {
    const actual = legalTransitions()
      .map((t: LegalTransition) => `${t.from}|${t.event}|${t.to}`)
      .sort();
    const expected = EXPECTED.map(([f, e, t]) => `${f}|${e}|${t}`).sort();
    expect(actual).toEqual(expected);
  });
});

describe('state machine — structural invariants', () => {
  it('CANCELLED is reachable only from PENDING (invariant 3)', () => {
    const intoCancelled = legalTransitions().filter((t) => t.to === 'CANCELLED');
    expect(intoCancelled).toHaveLength(1);
    expect(intoCancelled[0].from).toBe('PENDING');
  });

  it('PURGED is reachable only from CLOSED via DATA_PURGED (invariant 7)', () => {
    const intoPurged = legalTransitions().filter((t) => t.to === 'PURGED');
    expect(intoPurged).toEqual([{ from: 'CLOSED', event: 'DATA_PURGED', to: 'PURGED' }]);
  });

  it('PURGED is terminal', () => {
    expect(legalTransitions().filter((t) => t.from === 'PURGED')).toHaveLength(0);
  });

  it('TRIGGERED is genesis-only: never legal as a transition', () => {
    expect(legalTransitions().filter((t) => t.event === 'TRIGGERED')).toHaveLength(0);
  });

  it('a withdrawal returns to ACTIVE so the session can be re-dispatched', () => {
    expect(transition('DISPATCHED', 'RESPONDER_WITHDREW')).toBe('ACTIVE');
  });

  it('escalation is a self-loop on ACTIVE, never a new capability', () => {
    expect(transition('ACTIVE', 'ESCALATION_RAISED')).toBe('ACTIVE');
    expect(legalTransitions().filter((t) => t.event === 'ESCALATION_RAISED')).toHaveLength(1);
  });

  it('every non-terminal state has a path to PURGED', () => {
    const edges = legalTransitions();
    const reaches = (from: SessionState, target: SessionState, seen = new Set<SessionState>()): boolean => {
      if (from === target) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return edges.filter((e) => e.from === from).some((e) => reaches(e.to, target, seen));
    };
    for (const state of ALL_STATES) {
      expect(reaches(state, 'PURGED'), `${state} must reach PURGED`).toBe(true);
    }
  });
});
