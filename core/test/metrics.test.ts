import { describe, expect, it } from 'vitest';
import { InMemoryKeyVault, SessionCrypto } from '../src/crypto/shredder';
import { MatchingService } from '../src/services/matching.service';
import { InMemoryMetrics, NoopMetrics } from '../src/services/metrics';
import { StubNotifier } from '../src/services/notification.service';
import { SessionService } from '../src/services/session.service';
import { ManualClock } from './helpers/manual-clock';
import { TEST_CONFIG, TRIGGER_FIXTURE } from './helpers/build-service';

describe('aggregate metrics', () => {
  it('counts and snapshots in sorted order', () => {
    const m = new InMemoryMetrics();
    m.increment('b');
    m.increment('a');
    m.increment('a');
    expect(m.snapshot()).toEqual({ a: 2, b: 1 });
  });

  it('the noop recorder is inert', () => {
    const m = new NoopMetrics();
    expect(() => m.increment('x')).not.toThrow();
  });

  it('the session funnel increments PII-free counters', async () => {
    const metrics = new InMemoryMetrics();
    const clock = new ManualClock(new Date('2026-06-14T10:00:00.000Z'));
    const service = new SessionService(
      clock,
      new SessionCrypto(new InMemoryKeyVault()),
      new StubNotifier(),
      new MatchingService(5),
      TEST_CONFIG,
      undefined,
      metrics,
    );
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    await service.confirm(sessionId);
    service.resolve(sessionId);
    const snap = metrics.snapshot();
    expect(snap['session.triggered']).toBe(1);
    expect(snap['session.activated']).toBe(1);
    expect(snap['session.resolved']).toBe(1);
    // The counter keys are a fixed vocabulary — never an id or a coordinate.
    for (const key of Object.keys(snap)) {
      expect(key).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it('a journey watch increments its own counter', () => {
    const metrics = new InMemoryMetrics();
    const clock = new ManualClock(new Date('2026-06-14T10:00:00.000Z'));
    const service = new SessionService(
      clock,
      new SessionCrypto(new InMemoryKeyVault()),
      new StubNotifier(),
      new MatchingService(5),
      TEST_CONFIG,
      undefined,
      metrics,
    );
    service.startWatch(TRIGGER_FIXTURE, 20 * 60 * 1000);
    expect(metrics.snapshot()['watch.armed']).toBe(1);
  });
});
