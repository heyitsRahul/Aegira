import { describe, expect, it } from 'vitest';
import { IllegalTransitionError } from '../src/domain/state-machine';
import { buildRig, ROSTER_FIXTURE, TEST_CONFIG, TRIGGER_FIXTURE } from './helpers/build-service';

/**
 * Invariant 4, for every request the helpseeker's device can make. Once a
 * duress PIN has faked a benign ending (a cancel, a journey check-in, or
 * "I'm safe"), someone holding the phone may try hand-made requests to test
 * whether it was real: confirm, "I'm safe" again, ask for a helper, read the
 * arrival code. Each must answer exactly as it would for a real ending, at
 * every point of the timeline, while help keeps going behind the scenes.
 */

const { safe: SAFE, duress: DURESS } = TEST_CONFIG.pins;
const HOUR = 60 * 60 * 1000;
type Kind = 'cancel' | 'checkin' | 'resolve';

async function ended(kind: Kind, pin: string) {
  const rig = buildRig();
  const { service } = rig;
  let sessionId: string;
  if (kind === 'cancel') {
    sessionId = service.trigger(TRIGGER_FIXTURE).sessionId;
    await service.cancel(sessionId, pin);
  } else if (kind === 'checkin') {
    sessionId = service.startWatch(TRIGGER_FIXTURE, 30 * 60 * 1000).sessionId;
    await service.checkInSafe(sessionId, pin);
  } else {
    sessionId = service.trigger(TRIGGER_FIXTURE).sessionId;
    await service.confirm(sessionId);
    await service.dispatch(sessionId, ROSTER_FIXTURE);
    service.accept(sessionId, 'responder-a');
    await service.resolve(sessionId, pin);
  }
  return { ...rig, sessionId };
}

/** Behind the scenes, a contact sends a helper, who accepts. */
async function helpGoesAhead(rig: Awaited<ReturnType<typeof ended>>) {
  const { service, sessionId } = rig;
  if (service.opsView(sessionId).state === 'ACTIVE') {
    await service.dispatch(sessionId, ROSTER_FIXTURE, 'contact');
    service.accept(sessionId, 'responder-b');
  }
}

/** Everything the device can ask, reduced to what the device would see. */
async function probe(rig: Awaited<ReturnType<typeof ended>>): Promise<Record<string, string>> {
  const { service, sessionId } = rig;
  const outcome = async (run: () => unknown): Promise<string> => {
    try {
      const value = await run();
      return 'ok ' + JSON.stringify(value).replaceAll(sessionId, 'ID').replace(/"\d{6}"/g, '"CODE"');
    } catch (error) {
      return `${(error as Error).name}: ${(error as Error).message}`;
    }
  };
  return {
    status: await outcome(() => service.clientStatus(sessionId)),
    confirm: await outcome(() => service.confirm(sessionId)),
    resolveDuress: await outcome(() => service.resolve(sessionId, DURESS)),
    resolveWrong: await outcome(() => service.resolve(sessionId, '0000')),
    askHelper: await outcome(() => service.dispatch(sessionId, ROSTER_FIXTURE, 'seeker')),
    arrivalCode: await outcome(() => service.getArrivalCode(sessionId)),
    cancel: await outcome(() => service.cancel(sessionId, DURESS)),
    checkin: await outcome(() => service.checkInSafe(sessionId, DURESS)),
    extend: await outcome(() => service.extendWatch(sessionId, 60_000)),
    location: await outcome(() => service.recordLocation(sessionId, 12.97, 77.59)),
  };
}

describe.each(['cancel', 'checkin', 'resolve'] as const)('after a forced %s', (kind) => {
  it('every request from the phone answers as after a real one, for days', async () => {
    const real = await ended(kind, SAFE);
    const forced = await ended(kind, DURESS);
    await helpGoesAhead(forced);
    for (const step of [0, 1000, HOUR, 23 * HOUR, 2 * HOUR, 7 * 24 * HOUR]) {
      real.clock.advance(step);
      forced.clock.advance(step);
      await real.service.evaluateTimers(real.clock.now());
      await forced.service.evaluateTimers(forced.clock.now());
      expect(await probe(forced)).toEqual(await probe(real));
    }
  });

  it('the hand-made requests do not stop the help behind the scenes', async () => {
    const forced = await ended(kind, DURESS);
    await helpGoesAhead(forced);
    const before = forced.service.opsView(forced.sessionId).state;
    await probe(forced);
    expect(forced.service.opsView(forced.sessionId).state).toBe(before);
    expect(['ACTIVE', 'DISPATCHED', 'ARRIVED']).toContain(before);
  });
});

describe('what still works on a forced ending', () => {
  it('a contact can still send a helper; the phone cannot', async () => {
    const forced = await ended('cancel', DURESS);
    await expect(forced.service.dispatch(forced.sessionId, ROSTER_FIXTURE, 'seeker')).rejects.toThrow(
      IllegalTransitionError,
    );
    const asked = await forced.service.dispatch(forced.sessionId, ROSTER_FIXTURE, 'contact');
    expect(asked.length).toBeGreaterThan(0);
  });

  it('the real safe PIN still ends it for good', async () => {
    const forced = await ended('cancel', DURESS);
    await forced.service.resolve(forced.sessionId, SAFE);
    expect(forced.service.opsView(forced.sessionId).state).toBe('RESOLVED');
    // The phone keeps the timeline it was already showing.
    expect(forced.service.clientStatus(forced.sessionId).state).toBe('CANCELLED');
  });

  it('a second forced "I am safe" quietly warns the circle again', async () => {
    const forced = await ended('cancel', DURESS);
    const before = forced.notifier.contactAlerts.length;
    await expect(forced.service.resolve(forced.sessionId, DURESS)).rejects.toThrow(IllegalTransitionError);
    const alarms = forced.notifier.contactAlerts.slice(before);
    expect(alarms.length).toBe(TRIGGER_FIXTURE.contacts.length);
    expect(alarms.every((a) => a.duress)).toBe(true);
  });

  it('a helper already on the way can still check in with the code the phone showed', async () => {
    const forced = await ended('resolve', DURESS);
    const code = forced.service.getArrivalCode(forced.sessionId);
    expect(forced.service.verifyArrival(forced.sessionId, 'responder-a', code).state).toBe('ARRIVED');
  });
});
