import { describe, expect, it } from 'vitest';
import { MatchingService, ResponderProfile } from '../src/services/matching.service';
import { ROSTER_FIXTURE } from './helpers/build-service';

const SESSION_CELL = 'cell:1297:7759';

describe('deterministic matching (invariant 9)', () => {
  const matching = new MatchingService(5);

  it('is deterministic: identical inputs produce identical rankings', () => {
    const a = matching.match(SESSION_CELL, ROSTER_FIXTURE, 10);
    const b = matching.match(SESSION_CELL, [...ROSTER_FIXTURE].reverse(), 10);
    expect(a).toEqual(b);
  });

  it('excludes unverified responders', () => {
    const result = matching.match(SESSION_CELL, ROSTER_FIXTURE, 10);
    expect(result.map((c) => c.responderId)).not.toContain('responder-unverified');
  });

  it('excludes responders with open strikes (invariant 10: rule, not score)', () => {
    const result = matching.match(SESSION_CELL, ROSTER_FIXTURE, 10);
    expect(result.map((c) => c.responderId)).not.toContain('responder-struck');
  });

  it('excludes responders outside the dispatch radius', () => {
    const result = matching.match(SESSION_CELL, ROSTER_FIXTURE, 10);
    expect(result.map((c) => c.responderId)).not.toContain('responder-far');
  });

  it('ranks by cell distance with stable id tie-breaks', () => {
    const result = matching.match(SESSION_CELL, ROSTER_FIXTURE, 10);
    expect(result.map((c) => c.responderId)).toEqual([
      'responder-a',
      'responder-b',
      'responder-c',
    ]);
    expect(result.map((c) => c.rank)).toEqual([1, 2, 3]);
  });

  it('tie-break is lexicographic by responder id', () => {
    const tied: ResponderProfile[] = [
      { id: 'zeta', verified: true, availabilityCell: SESSION_CELL, hasOpenStrike: false },
      { id: 'alpha', verified: true, availabilityCell: SESSION_CELL, hasOpenStrike: false },
    ];
    const result = matching.match(SESSION_CELL, tied, 10);
    expect(result.map((c) => c.responderId)).toEqual(['alpha', 'zeta']);
  });

  it('caps results at maxResults', () => {
    expect(matching.match(SESSION_CELL, ROSTER_FIXTURE, 2)).toHaveLength(2);
  });

  it('every candidate carries a human-readable explanation', () => {
    for (const candidate of matching.match(SESSION_CELL, ROSTER_FIXTURE, 10)) {
      expect(candidate.explanation.length).toBeGreaterThan(0);
      expect(candidate.explanation.join(' ')).toContain('cells from the session cell');
    }
  });
});
