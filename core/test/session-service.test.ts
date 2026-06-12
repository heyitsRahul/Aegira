import { describe, expect, it } from 'vitest';
import {
  CancelNotAllowedError,
  InvalidArrivalCodeError,
  InvalidPinError,
  LocationRejectedError,
  ResponderNotAuthorizedError,
} from '../src/domain/errors';
import { IllegalTransitionError } from '../src/domain/state-machine';
import { KeyDestroyedError } from '../src/crypto/shredder';
import {
  buildRig,
  ROSTER_FIXTURE,
  TEST_CONFIG,
  TRIGGER_FIXTURE,
} from './helpers/build-service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('trigger and activation countdown', () => {
  it('trigger creates a PENDING session with the countdown', () => {
    const { service } = buildRig();
    const receipt = service.trigger(TRIGGER_FIXTURE);
    expect(receipt.state).toBe('PENDING');
    expect(receipt.activationCountdownMs).toBe(TEST_CONFIG.activationCountdownMs);
    expect(service.clientStatus(receipt.sessionId).state).toBe('PENDING');
  });

  it('stays PENDING before the countdown elapses, activates after', async () => {
    const { service, clock, notifier } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);

    clock.advance(TEST_CONFIG.activationCountdownMs - 1);
    await service.evaluateTimers(clock.now());
    expect(service.clientStatus(sessionId).state).toBe('PENDING');
    expect(notifier.contactAlerts).toHaveLength(0);

    clock.advance(1);
    await service.evaluateTimers(clock.now());
    expect(service.clientStatus(sessionId).state).toBe('ACTIVE');
    expect(notifier.contactAlerts).toHaveLength(TRIGGER_FIXTURE.contacts.length);
  });

  it('explicit confirm activates immediately and alerts contacts', async () => {
    const { service, notifier } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    const status = await service.confirm(sessionId);
    expect(status.state).toBe('ACTIVE');
    expect(notifier.contactAlerts).toHaveLength(2);
    expect(notifier.contactAlerts[0].duress).toBe(false);
  });
});

describe('cancellation (invariant 3)', () => {
  it('safe PIN cancels a PENDING session; contacts are never alerted', async () => {
    const { service, notifier } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    const response = await service.cancel(sessionId, TEST_CONFIG.pins.safe);
    expect(response).toEqual({ status: 'cancelled', sessionId });
    expect(service.clientStatus(sessionId).state).toBe('CANCELLED');
    expect(notifier.contactAlerts).toHaveLength(0);
  });

  it('a wrong PIN is rejected and the session stays PENDING', async () => {
    const { service } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    await expect(service.cancel(sessionId, '0000')).rejects.toThrow(InvalidPinError);
    expect(service.clientStatus(sessionId).state).toBe('PENDING');
  });

  it('no cancel path exists from a live state — identical error for every PIN', async () => {
    const { service } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    await service.confirm(sessionId);
    for (const pin of [TEST_CONFIG.pins.safe, TEST_CONFIG.pins.duress, '0000']) {
      await expect(service.cancel(sessionId, pin)).rejects.toThrow(CancelNotAllowedError);
    }
    expect(service.opsView(sessionId).state).toBe('ACTIVE');
  });
});

describe('duress (invariant 4) — responses lie by design', () => {
  it('duress cancel returns a response identical in shape and content to a real cancel', async () => {
    const { service } = buildRig();
    const safe = service.trigger(TRIGGER_FIXTURE);
    const duress = service.trigger(TRIGGER_FIXTURE);

    const safeResponse = await service.cancel(safe.sessionId, TEST_CONFIG.pins.safe);
    const duressResponse = await service.cancel(duress.sessionId, TEST_CONFIG.pins.duress);

    expect(Object.keys(duressResponse).sort()).toEqual(Object.keys(safeResponse).sort());
    expect({ ...duressResponse, sessionId: 'X' }).toEqual({ ...safeResponse, sessionId: 'X' });
  });

  it('client status stays indistinguishable from a real cancel over time', async () => {
    const { service, clock } = buildRig();
    const safe = service.trigger(TRIGGER_FIXTURE);
    const duress = service.trigger(TRIGGER_FIXTURE);
    await service.cancel(safe.sessionId, TEST_CONFIG.pins.safe);
    await service.cancel(duress.sessionId, TEST_CONFIG.pins.duress);

    // Immediately, after the close delay, and after the purge delay, the
    // coerced device sees exactly what a genuine cancel would show.
    expect(service.clientStatus(duress.sessionId).state).toBe(
      service.clientStatus(safe.sessionId).state,
    );

    clock.advance(TEST_CONFIG.closeAfterCancelMs);
    await service.evaluateTimers(clock.now());
    expect(service.clientStatus(safe.sessionId).state).toBe('CLOSED');
    expect(service.clientStatus(duress.sessionId).state).toBe('CLOSED');

    clock.advance(TEST_CONFIG.purgeAfterCloseMs);
    await service.evaluateTimers(clock.now());
    expect(service.clientStatus(safe.sessionId).state).toBe('PURGED');
    expect(service.clientStatus(duress.sessionId).state).toBe('PURGED');
  });

  it('meanwhile the session is really ACTIVE and contacts were told it was duress', async () => {
    const { service, notifier } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    await service.cancel(sessionId, TEST_CONFIG.pins.duress);

    expect(service.opsView(sessionId).state).toBe('ACTIVE');
    expect(notifier.contactAlerts).toHaveLength(2);
    expect(notifier.contactAlerts.every((a) => a.duress)).toBe(true);
  });

  it('nothing in the cancel response or client status reveals duress', async () => {
    const { service } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    const response = await service.cancel(sessionId, TEST_CONFIG.pins.duress);
    const visible = JSON.stringify([response, service.clientStatus(sessionId)]).toLowerCase();
    expect(visible).not.toContain('duress');
    expect(visible).not.toContain('active');
  });
});

describe('dispatch, arrival, resolution', () => {
  async function liveSession() {
    const rig = buildRig();
    const { sessionId } = rig.service.trigger(TRIGGER_FIXTURE);
    await rig.service.confirm(sessionId);
    return { ...rig, sessionId };
  }

  it('dispatch requires an ACTIVE session', async () => {
    const { service } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    await expect(service.dispatch(sessionId, ROSTER_FIXTURE)).rejects.toThrow(
      IllegalTransitionError,
    );
  });

  it('accept is limited to responders who actually received an offer', async () => {
    const { service, sessionId } = await liveSession();
    await service.dispatch(sessionId, ROSTER_FIXTURE);
    expect(() => service.accept(sessionId, 'responder-far')).toThrow(
      ResponderNotAuthorizedError,
    );
    expect(service.accept(sessionId, 'responder-a').state).toBe('DISPATCHED');
  });

  it('precise location is released only to the accepted responder, only while DISPATCHED', async () => {
    const { service, sessionId } = await liveSession();
    await service.dispatch(sessionId, ROSTER_FIXTURE);
    service.accept(sessionId, 'responder-a');

    const location = service.getDispatchLocation(sessionId, 'responder-a');
    expect(location.sessionId).toBe(sessionId);
    expect(location.lat).toBeCloseTo(TRIGGER_FIXTURE.location.lat);

    expect(() => service.getDispatchLocation(sessionId, 'responder-b')).toThrow(
      ResponderNotAuthorizedError,
    );

    const code = service.getArrivalCode(sessionId);
    service.verifyArrival(sessionId, 'responder-a', code);
    expect(() => service.getDispatchLocation(sessionId, 'responder-a')).toThrow(
      ResponderNotAuthorizedError,
    );
  });

  it('arrival requires the correct code from the right responder', async () => {
    const { service, sessionId } = await liveSession();
    await service.dispatch(sessionId, ROSTER_FIXTURE);
    service.accept(sessionId, 'responder-a');
    const code = service.getArrivalCode(sessionId);

    expect(() => service.verifyArrival(sessionId, 'responder-b', code)).toThrow(
      ResponderNotAuthorizedError,
    );
    const wrong = code === '000000' ? '000001' : '000000';
    expect(() => service.verifyArrival(sessionId, 'responder-a', wrong)).toThrow(
      InvalidArrivalCodeError,
    );
    expect(service.verifyArrival(sessionId, 'responder-a', code).state).toBe('ARRIVED');
  });

  it('location pings are accepted only while the session is live', async () => {
    const { service, sessionId } = await liveSession();
    service.recordLocation(sessionId, 12.972, 77.595);
    service.resolve(sessionId);
    expect(() => service.recordLocation(sessionId, 12.973, 77.596)).toThrow(
      LocationRejectedError,
    );
  });
});

describe('close, purge, and crypto-shred (invariant 7)', () => {
  it('full lifecycle: resolve -> auto-close -> purge destroys the key', async () => {
    const { service, clock, crypto, sessionId } = await (async () => {
      const rig = buildRig();
      const { sessionId } = rig.service.trigger(TRIGGER_FIXTURE);
      await rig.service.confirm(sessionId);
      await rig.service.dispatch(sessionId, ROSTER_FIXTURE);
      rig.service.accept(sessionId, 'responder-a');
      const code = rig.service.getArrivalCode(sessionId);
      rig.service.verifyArrival(sessionId, 'responder-a', code);
      rig.service.resolve(sessionId);
      return { ...rig, sessionId };
    })();

    expect(service.opsView(sessionId).state).toBe('RESOLVED');

    clock.advance(DAY);
    await service.evaluateTimers(clock.now());
    expect(service.opsView(sessionId).state).toBe('CLOSED');

    clock.advance(7 * DAY);
    await service.evaluateTimers(clock.now());
    expect(service.opsView(sessionId).state).toBe('PURGED');
    expect(crypto.isShredded(sessionId)).toBe(true);

    const events = service.opsView(sessionId).events;
    expect(events[events.length - 1].type).toBe('DATA_PURGED');
    expect(events[events.length - 1].data.method).toBe('crypto-shred');
  });

  it('after purge the hash chain still verifies — audit survives, data does not', async () => {
    const { service, clock } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    await service.cancel(sessionId, TEST_CONFIG.pins.safe);
    clock.advance(HOUR);
    await service.evaluateTimers(clock.now());
    clock.advance(7 * DAY);
    await service.evaluateTimers(clock.now());

    const { state, events } = service.opsView(sessionId);
    expect(state).toBe('PURGED');
    expect(events[0].type).toBe('TRIGGERED');
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
  });

  it('a shredded key can never decrypt previously written blobs', () => {
    const { crypto } = buildRig();
    crypto.provisionSession('doomed');
    const blob = crypto.encrypt('doomed', 'last known location');
    crypto.shred('doomed');
    expect(() => crypto.decrypt(blob)).toThrow(KeyDestroyedError);
  });
});

describe('event log hygiene (invariant 1 + conventions)', () => {
  it('no event in the durable log ever contains identity or coordinates', async () => {
    const { service, clock } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    await service.confirm(sessionId);
    service.recordLocation(sessionId, 12.9716, 77.5946);
    await service.dispatch(sessionId, ROSTER_FIXTURE);
    service.accept(sessionId, 'responder-a');
    service.resolve(sessionId);
    clock.advance(DAY);
    await service.evaluateTimers(clock.now());
    clock.advance(7 * DAY);
    await service.evaluateTimers(clock.now());

    const serialized = JSON.stringify(service.opsView(sessionId).events);
    expect(serialized).not.toContain(TRIGGER_FIXTURE.displayName);
    expect(serialized).not.toContain(TRIGGER_FIXTURE.userId);
    expect(serialized).not.toContain(TRIGGER_FIXTURE.contacts[0].address);
    expect(serialized).not.toContain('12.97');
    expect(serialized).not.toContain('77.59');
    expect(serialized).not.toContain('"lat"');
    expect(serialized).not.toContain('"lng"');
  });
});
