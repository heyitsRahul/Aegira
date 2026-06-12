import { describe, expect, it } from 'vitest';
import { SessionAggregate } from '../src/domain/session';
import { IllegalTransitionError } from '../src/domain/state-machine';
import { SessionEvent } from '../src/domain/types';

function freshAggregate(): SessionAggregate {
  return SessionAggregate.trigger({
    sessionId: 'session-1',
    at: '2026-06-12T10:00:00.000Z',
    data: { category: 'personal_safety', consentVersion: 'v1' },
  });
}

describe('session aggregate', () => {
  it('starts in PENDING with a TRIGGERED genesis event', () => {
    const agg = freshAggregate();
    expect(agg.state).toBe('PENDING');
    expect(agg.events).toHaveLength(1);
    expect(agg.events[0].type).toBe('TRIGGERED');
    expect(agg.events[0].seq).toBe(0);
    expect(agg.events[0].prevHash).toBe('0'.repeat(64));
  });

  it('genesis event records the consent version (invariant 11)', () => {
    expect(freshAggregate().events[0].data.consentVersion).toBe('v1');
  });

  it('applies legal events through the state machine and chains hashes', () => {
    const agg = freshAggregate();
    agg.apply('ACTIVATED', '2026-06-12T10:00:30.000Z', { reason: 'countdown_elapsed' });
    agg.apply('SESSION_RESOLVED', '2026-06-12T10:20:00.000Z');
    expect(agg.state).toBe('RESOLVED');
    expect(agg.events).toHaveLength(3);
    expect(agg.events[1].prevHash).toBe(agg.events[0].hash);
    expect(agg.events[2].prevHash).toBe(agg.events[1].hash);
    expect(agg.verifyChain()).toBe(true);
  });

  it('rejects illegal events and records nothing', () => {
    const agg = freshAggregate();
    expect(() => agg.apply('DATA_PURGED', '2026-06-12T10:00:01.000Z')).toThrow(
      IllegalTransitionError,
    );
    expect(agg.state).toBe('PENDING');
    expect(agg.events).toHaveLength(1);
  });

  it('recorded events are frozen — mutation throws', () => {
    const agg = freshAggregate();
    const event = agg.events[0] as { data: Record<string, unknown> };
    expect(() => {
      (event as unknown as { at: string }).at = '1999-01-01T00:00:00.000Z';
    }).toThrow(TypeError);
    expect(() => {
      event.data.injected = true;
    }).toThrow(TypeError);
  });

  it('verifyEvents detects a tampered event', () => {
    const agg = freshAggregate();
    agg.apply('ACTIVATED', '2026-06-12T10:00:30.000Z', { reason: 'confirmed' });
    const events = agg.events;
    const tampered: SessionEvent[] = [
      events[0],
      { ...events[1], data: { reason: 'duress' } },
    ];
    expect(SessionAggregate.verifyEvents(events)).toBe(true);
    expect(SessionAggregate.verifyEvents(tampered)).toBe(false);
  });

  it('verifyEvents detects a dropped event', () => {
    const agg = freshAggregate();
    agg.apply('ACTIVATED', '2026-06-12T10:00:30.000Z');
    agg.apply('SESSION_RESOLVED', '2026-06-12T10:30:00.000Z');
    const events = agg.events;
    expect(SessionAggregate.verifyEvents([events[0], events[2]])).toBe(false);
  });

  it('verifyEvents rejects a log that does not begin with TRIGGERED', () => {
    const agg = freshAggregate();
    agg.apply('ACTIVATED', '2026-06-12T10:00:30.000Z');
    expect(SessionAggregate.verifyEvents(agg.events.slice(1))).toBe(false);
    expect(SessionAggregate.verifyEvents([])).toBe(false);
  });
});
