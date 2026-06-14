import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/domain/errors';
import { InMemoryWaitlistStore, WaitlistService } from '../src/services/waitlist.service';
import { ManualClock } from './helpers/manual-clock';

function build() {
  return new WaitlistService(
    new InMemoryWaitlistStore(),
    new ManualClock(new Date('2026-06-14T10:00:00.000Z')),
  );
}

describe('waitlist (consent v3)', () => {
  it('accepts a valid email and counts it once', () => {
    const w = build();
    const r = w.join('Asha@Example.com', 'in');
    expect(r).toEqual({ ok: true, alreadyJoined: false, count: 1 });
    expect(w.count()).toBe(1);
  });

  it('is idempotent and case-insensitive on the email', () => {
    const w = build();
    w.join('asha@example.com');
    const again = w.join('ASHA@example.com');
    expect(again.alreadyJoined).toBe(true);
    expect(w.count()).toBe(1);
  });

  it('rejects malformed emails', () => {
    const w = build();
    expect(() => w.join('not-an-email')).toThrow(InvalidInputError);
    expect(() => w.join('')).toThrow(InvalidInputError);
  });

  it('normalizes country to a 2-letter code and tolerates its absence', () => {
    const store = new InMemoryWaitlistStore();
    const w = new WaitlistService(store, new ManualClock(new Date('2026-06-14T10:00:00.000Z')));
    w.join('a@b.com', 'india');
    w.join('c@d.com');
    expect(store.count()).toBe(2);
  });
});
