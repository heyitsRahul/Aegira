import { describe, expect, it } from 'vitest';
import { StrikeService } from '../src/services/strike.service';
import { ManualClock } from './helpers/manual-clock';

function freshService(): StrikeService {
  return new StrikeService(new ManualClock(new Date('2026-06-12T10:00:00.000Z')));
}

describe('strikes, not scores (invariant 10)', () => {
  it('misbehavior creates a discrete reviewable record', () => {
    const service = freshService();
    const strike = service.file('responder-a', 'no-show after accepting dispatch');
    expect(strike.status).toBe('open');
    expect(strike.reason).toContain('no-show');
    expect(service.listFor('responder-a')).toHaveLength(1);
  });

  it('strikes are human-reviewable and appealable', () => {
    const service = freshService();
    const strike = service.file('responder-a', 'arrived without verification');
    service.review(strike.id, 'upheld');
    expect(service.listFor('responder-a')[0].status).toBe('upheld');

    service.appeal(strike.id, 'verification app crashed; helpseeker confirmed arrival');
    expect(service.listFor('responder-a')[0].status).toBe('open');
    expect(service.listFor('responder-a')[0].appealNote).toContain('crashed');

    service.review(strike.id, 'dismissed');
    expect(service.hasOpenOrUpheldStrike('responder-a')).toBe(false);
  });

  it('moves only open -> upheld/dismissed, and upheld -> open by appeal', () => {
    const service = freshService();
    const dismissed = service.file('responder-a', 'late');
    service.review(dismissed.id, 'dismissed');
    // A dismissed strike cannot be reopened (that would take them off dispatch again)...
    expect(() => service.appeal(dismissed.id, 'please')).toThrow();
    // ...or flipped to upheld without a new review.
    expect(() => service.review(dismissed.id, 'upheld')).toThrow();
    expect(service.hasOpenOrUpheldStrike('responder-a')).toBe(false);

    const upheld = service.file('responder-b', 'rude');
    service.review(upheld.id, 'upheld');
    expect(() => service.review(upheld.id, 'dismissed')).toThrow();
    // An open strike is already under review; there is nothing to appeal yet.
    const open = service.file('responder-c', 'no-show');
    expect(() => service.appeal(open.id, 'early')).toThrow();
  });

  it('eligibility is a boolean rule over records, never a numeric score', () => {
    const service = freshService();
    service.file('responder-a', 'first incident');
    expect(service.hasOpenOrUpheldStrike('responder-a')).toBe(true);
    expect(service.hasOpenOrUpheldStrike('responder-clean')).toBe(false);

    // The service surface itself must not offer any score-like aggregate.
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    expect(surface.join(' ')).not.toMatch(/score|rating|reputation/i);
  });
});
