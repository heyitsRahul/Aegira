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
