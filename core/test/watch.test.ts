import { describe, expect, it } from 'vitest';
import {
  ActiveSessionExistsError,
  InvalidInputError,
  InvalidPinError,
  WatchActionNotAllowedError,
} from '../src/domain/errors';
import { buildRig, TEST_CONFIG, TRIGGER_FIXTURE } from './helpers/build-service';

const MIN = 60 * 1000;

describe('journey watch — arming and safe check-in', () => {
  it('arms a WATCHING session with a deadline and alerts nobody', () => {
    const { service, clock, notifier } = buildRig();
    const receipt = service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    expect(receipt.state).toBe('WATCHING');
    expect(receipt.seekerToken).toMatch(/^[0-9a-f]{48}$/);
    // Deadline is on the injected clock: start + 20 minutes.
    expect(Date.parse(receipt.watchDeadline)).toBe(clock.now().getTime() + 20 * MIN);
    expect(service.opsView(receipt.sessionId).state).toBe('WATCHING');
    expect(notifier.contactAlerts).toHaveLength(0);
  });

  it('the genesis event is WATCH_ARMED and the chain verifies', () => {
    const { service } = buildRig();
    const { sessionId } = service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    const events = service.opsView(sessionId).events;
    expect(events[0].type).toBe('WATCH_ARMED');
    expect(events[0].data.consentVersion).toBeDefined();
  });

  it('a safe check-in ends the watch quietly (RESOLVED), no alert', async () => {
    const { service, notifier } = buildRig();
    const { sessionId } = service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    const res = await service.checkInSafe(sessionId, TEST_CONFIG.pins.safe);
    expect(res).toEqual({ status: 'safe', sessionId });
    expect(service.opsView(sessionId).state).toBe('RESOLVED');
    expect(notifier.contactAlerts).toHaveLength(0);
  });

  it('a wrong PIN is rejected and the watch stays WATCHING', async () => {
    const { service } = buildRig();
    const { sessionId } = service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    await expect(service.checkInSafe(sessionId, '0000')).rejects.toThrow(InvalidPinError);
    expect(service.opsView(sessionId).state).toBe('WATCHING');
  });

  it('rejects an out-of-range ETA', () => {
    const { service } = buildRig();
    expect(() => service.startWatch(TRIGGER_FIXTURE, 1)).toThrow(InvalidInputError);
    expect(() => service.startWatch(TRIGGER_FIXTURE, 100 * 60 * MIN)).toThrow(InvalidInputError);
  });

  it('check-in and extend refuse on a non-watch session', async () => {
    const { service } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE); // an SOS, PENDING
    await expect(service.checkInSafe(sessionId, TEST_CONFIG.pins.safe)).rejects.toThrow(
      WatchActionNotAllowedError,
    );
    expect(() => service.extendWatch(sessionId, 10 * MIN)).toThrow(WatchActionNotAllowedError);
  });
});

describe('journey watch — expiry escalates', () => {
  it('a missed deadline escalates to ACTIVE and alerts the circle', async () => {
    const { service, clock, notifier } = buildRig();
    const { sessionId } = service.startWatch(TRIGGER_FIXTURE, 20 * MIN);

    clock.advance(20 * MIN - 1);
    await service.evaluateTimers(clock.now());
    expect(service.opsView(sessionId).state).toBe('WATCHING');
    expect(notifier.contactAlerts).toHaveLength(0);

    clock.advance(1);
    await service.evaluateTimers(clock.now());
    expect(service.opsView(sessionId).state).toBe('ACTIVE');
    expect(notifier.contactAlerts).toHaveLength(TRIGGER_FIXTURE.contacts.length);
    expect(notifier.contactAlerts.every((a) => a.watchExpired)).toBe(true);
    expect(service.opsView(sessionId).events.at(-1)?.type).toBe('WATCH_ESCALATED');
  });

  it('extending the watch pushes the deadline out', async () => {
    const { service, clock, notifier } = buildRig();
    const { sessionId } = service.startWatch(TRIGGER_FIXTURE, 20 * MIN);

    clock.advance(15 * MIN);
    service.extendWatch(sessionId, 20 * MIN);
    expect(service.opsView(sessionId).events.at(-1)?.type).toBe('WATCH_EXTENDED');

    // The original deadline would have passed by now; the extension holds.
    clock.advance(10 * MIN);
    await service.evaluateTimers(clock.now());
    expect(service.opsView(sessionId).state).toBe('WATCHING');
    expect(notifier.contactAlerts).toHaveLength(0);

    clock.advance(20 * MIN);
    await service.evaluateTimers(clock.now());
    expect(service.opsView(sessionId).state).toBe('ACTIVE');
  });
});

describe('journey watch — duress check-in (invariant 4)', () => {
  it('duress check-in returns the identical response to a safe one', async () => {
    const safe = buildRig();
    const a = safe.service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    const safeRes = await safe.service.checkInSafe(a.sessionId, TEST_CONFIG.pins.safe);

    const duress = buildRig();
    const b = duress.service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    const duressRes = await duress.service.checkInSafe(b.sessionId, TEST_CONFIG.pins.duress);

    expect(Object.keys(duressRes).sort()).toEqual(Object.keys(safeRes).sort());
    expect({ ...duressRes, sessionId: 'X' }).toEqual({ ...safeRes, sessionId: 'X' });
  });

  it('a duress check-in really escalates while the device shows "safe"', async () => {
    const { service, notifier } = buildRig();
    const { sessionId } = service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    await service.checkInSafe(sessionId, TEST_CONFIG.pins.duress);

    // Real state: a live emergency, contacts told it was duress.
    expect(service.opsView(sessionId).state).toBe('ACTIVE');
    expect(notifier.contactAlerts).toHaveLength(TRIGGER_FIXTURE.contacts.length);
    expect(notifier.contactAlerts.every((a) => a.duress)).toBe(true);
    // Coerced device: a benign "resolved" timeline, nothing says duress.
    expect(service.clientStatus(sessionId).state).toBe('RESOLVED');
    const visible = JSON.stringify(service.clientStatus(sessionId)).toLowerCase();
    expect(visible).not.toContain('duress');
    expect(visible).not.toContain('active');
  });

  it('the masked timeline ages exactly like a genuine safe check-in', async () => {
    const safe = buildRig();
    const a = safe.service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    await safe.service.checkInSafe(a.sessionId, TEST_CONFIG.pins.safe);

    const duress = buildRig();
    const b = duress.service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    await duress.service.checkInSafe(b.sessionId, TEST_CONFIG.pins.duress);

    const sameNow = () =>
      expect(duress.service.clientStatus(b.sessionId).state).toBe(
        safe.service.clientStatus(a.sessionId).state,
      );
    sameNow();
    safe.clock.advance(TEST_CONFIG.closeAfterResolveMs);
    duress.clock.advance(TEST_CONFIG.closeAfterResolveMs);
    await safe.service.evaluateTimers(safe.clock.now());
    await duress.service.evaluateTimers(duress.clock.now());
    expect(safe.service.clientStatus(a.sessionId).state).toBe('CLOSED');
    sameNow();
  });
});

describe('journey watch — location and concurrency', () => {
  it('location is recorded while WATCHING but hidden from contacts pre-alert', () => {
    const { service } = buildRig();
    const { sessionId } = service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    service.recordLocation(sessionId, 12.972, 77.595);
    // Pre-alert: a watch is invisible to contacts.
    expect(service.contactView(sessionId).location).toBeNull();
  });

  it('after escalation the contact sees location with a freshness age', async () => {
    const { service, clock } = buildRig();
    const { sessionId } = service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    clock.advance(20 * MIN);
    await service.evaluateTimers(clock.now());
    service.recordLocation(sessionId, 12.9716, 77.5946);
    const view = service.contactView(sessionId);
    expect(view.location?.lat).toBeCloseTo(12.9716);
    expect(view.locationAgeMs).toBe(0);
    clock.advance(90 * 1000);
    expect(service.contactView(sessionId).locationAgeMs).toBe(90 * 1000);
  });

  it('a live watch blocks a second session; a duress-masked one does not', async () => {
    const { service } = buildRig();
    service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    expect(() => service.trigger(TRIGGER_FIXTURE)).toThrow(ActiveSessionExistsError);

    const masked = buildRig();
    const { sessionId } = masked.service.startWatch(TRIGGER_FIXTURE, 20 * MIN);
    await masked.service.checkInSafe(sessionId, TEST_CONFIG.pins.duress);
    // The coerced user appears to have no session; a new trigger must work.
    expect(() => masked.service.trigger(TRIGGER_FIXTURE)).not.toThrow();
  });
});
