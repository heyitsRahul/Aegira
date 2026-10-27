import { describe, expect, it } from 'vitest';
import { InvalidPinError } from '../src/domain/errors';
import { IllegalTransitionError } from '../src/domain/state-machine';
import { MatchingService } from '../src/services/matching.service';
import { InMemoryMetrics } from '../src/services/metrics';
import { SessionService } from '../src/services/session.service';
import { buildRig, ROSTER_FIXTURE, TEST_CONFIG, TRIGGER_FIXTURE } from './helpers/build-service';

/**
 * A coerced "I'm safe" on a live emergency (threat model §8.8). The safe
 * PIN ends it; the duress PIN must look exactly like that to whoever holds
 * the phone, while help keeps coming and the circle gets a secret alarm.
 */

const { safe: SAFE, duress: DURESS } = TEST_CONFIG.pins;
const HOUR = 60 * 60 * 1000;

async function live(stage: 'ACTIVE' | 'DISPATCHED' | 'ARRIVED') {
  const rig = buildRig();
  const { sessionId } = rig.service.trigger(TRIGGER_FIXTURE);
  await rig.service.confirm(sessionId);
  if (stage !== 'ACTIVE') {
    await rig.service.dispatch(sessionId, ROSTER_FIXTURE);
    rig.service.accept(sessionId, 'responder-a');
  }
  if (stage === 'ARRIVED') {
    rig.service.verifyArrival(sessionId, 'responder-a', rig.service.getArrivalCode(sessionId));
  }
  return { ...rig, sessionId };
}

describe('"I am safe" needs a PIN', () => {
  it('no PIN or a wrong PIN changes nothing', async () => {
    const { service, sessionId } = await live('ACTIVE');
    for (const pin of ['', '0000', undefined as unknown as string]) {
      await expect(service.resolve(sessionId, pin)).rejects.toThrow(InvalidPinError);
    }
    expect(service.opsView(sessionId).state).toBe('ACTIVE');
  });

  it('outside a live emergency every PIN gets the same refusal', async () => {
    const { service } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE); // still PENDING
    for (const pin of [SAFE, DURESS, '0000']) {
      await expect(service.resolve(sessionId, pin)).rejects.toThrow(IllegalTransitionError);
    }
  });
});

describe.each(['ACTIVE', 'DISPATCHED', 'ARRIVED'] as const)('duress PIN at "I am safe" while %s', (stage) => {
  it('returns exactly what a real "I am safe" returns', async () => {
    const real = await live(stage);
    const forced = await live(stage);
    const a = await real.service.resolve(real.sessionId, SAFE);
    const b = await forced.service.resolve(forced.sessionId, DURESS);
    expect(b).toEqual({ ...a, sessionId: forced.sessionId });
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
  });

  it('the phone shows the same timeline as a real one, for days afterwards', async () => {
    const real = await live(stage);
    const forced = await live(stage);
    await real.service.resolve(real.sessionId, SAFE);
    await forced.service.resolve(forced.sessionId, DURESS);
    for (const step of [0, HOUR, 23 * HOUR, 2 * HOUR, 7 * 24 * HOUR]) {
      real.clock.advance(step);
      forced.clock.advance(step);
      await real.service.evaluateTimers(real.clock.now());
      await forced.service.evaluateTimers(forced.clock.now());
      expect(forced.service.clientStatus(forced.sessionId).state).toBe(
        real.service.clientStatus(real.sessionId).state,
      );
    }
  });

  it('behind the scenes help keeps coming and the circle gets a secret alarm', async () => {
    const { service, notifier, sessionId } = await live(stage);
    const before = notifier.contactAlerts.length;
    await service.resolve(sessionId, DURESS);
    expect(service.opsView(sessionId).state).toBe(stage);
    const alarms = notifier.contactAlerts.slice(before);
    expect(alarms.length).toBe(TRIGGER_FIXTURE.contacts.length);
    expect(alarms.every((a) => a.duress)).toBe(true);
    expect(service.contactView(sessionId).duress).toBe(true);
    // The event log records it, without identity.
    const last = service.opsView(sessionId).events.at(-1)!;
    expect(last.type).toBe('ESCALATION_RAISED');
    expect(last.data).toEqual({ reason: 'duress_resolve' });
  });
});

describe('after a forced "I am safe"', () => {
  it('the helper on the way can still find them and check in', async () => {
    const { service, sessionId } = await live('DISPATCHED');
    await service.resolve(sessionId, DURESS);
    expect(service.getDispatchLocation(sessionId, 'responder-a').lat).toBe(TRIGGER_FIXTURE.location.lat);
    const code = service.getArrivalCode(sessionId);
    expect(service.verifyArrival(sessionId, 'responder-a', code).state).toBe('ARRIVED');
    // ...and the phone still shows the benign view.
    expect(service.clientStatus(sessionId).state).toBe('RESOLVED');
  });

  it('the real safe PIN can still end it for good later', async () => {
    const { service, sessionId } = await live('ACTIVE');
    await service.resolve(sessionId, DURESS);
    await service.resolve(sessionId, SAFE);
    expect(service.opsView(sessionId).state).toBe('RESOLVED');
  });

  it('a new SOS is allowed straight away; refusing it would give the lie away', async () => {
    const { service, sessionId } = await live('ACTIVE');
    await service.resolve(sessionId, DURESS);
    expect(() => service.trigger(TRIGGER_FIXTURE)).not.toThrow();
  });

  it('"nobody accepted" re-alert still fires once, on time', async () => {
    const { service, notifier, clock, sessionId } = await live('ACTIVE');
    clock.advance(TEST_CONFIG.escalationAfterMs / 2);
    await service.resolve(sessionId, DURESS);
    const afterDuress = notifier.contactAlerts.length;
    clock.advance(TEST_CONFIG.escalationAfterMs / 2);
    await service.evaluateTimers(clock.now());
    const escalations = notifier.contactAlerts.slice(afterDuress).filter((a) => a.escalation);
    expect(escalations.length).toBe(TRIGGER_FIXTURE.contacts.length);
    clock.advance(TEST_CONFIG.escalationAfterMs * 3);
    await service.evaluateTimers(clock.now());
    expect(notifier.contactAlerts.filter((a) => a.escalation).length).toBe(TRIGGER_FIXTURE.contacts.length);
  });

  it('a no-show helper is still withdrawn on time', async () => {
    const { service, clock, sessionId } = await live('DISPATCHED');
    clock.advance(TEST_CONFIG.responderArrivalTimeoutMs - 1000);
    await service.resolve(sessionId, DURESS);
    clock.advance(1000);
    await service.evaluateTimers(clock.now());
    expect(service.opsView(sessionId).state).toBe('ACTIVE');
  });

  it('the public counters move exactly as for a real "I am safe"', async () => {
    const counts = async (pin: string) => {
      const metrics = new InMemoryMetrics();
      const rig = buildRig();
      const service = new SessionService(
        rig.clock, rig.crypto, rig.notifier, new MatchingService(5), TEST_CONFIG, undefined, metrics,
      );
      const { sessionId } = service.trigger(TRIGGER_FIXTURE);
      await service.confirm(sessionId);
      await service.resolve(sessionId, pin);
      return metrics.snapshot();
    };
    expect(await counts(DURESS)).toEqual(await counts(SAFE));
  });
});
