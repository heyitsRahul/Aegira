import { describe, expect, it } from 'vitest';
import {
  ActiveSessionExistsError,
  ArrivalCodeLockedError,
  InvalidArrivalCodeError,
  InvalidInputError,
  NotAuthenticatedError,
  ResponderNotAuthorizedError,
} from '../src/domain/errors';
import { buildRig, ROSTER_FIXTURE, TEST_CONFIG, TRIGGER_FIXTURE } from './helpers/build-service';

const MIN = 60 * 1000;

describe('capability tokens', () => {
  it('the trigger receipt carries the seeker token; it authorizes seeker actions', () => {
    const { service } = buildRig();
    const receipt = service.trigger(TRIGGER_FIXTURE);
    expect(receipt.seekerToken).toMatch(/^[0-9a-f]{48}$/);
    expect(() => service.authorizeSeeker(receipt.sessionId, receipt.seekerToken)).not.toThrow();
  });

  it('missing or wrong tokens are rejected in constant-shape fashion', () => {
    const { service } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    expect(() => service.authorizeSeeker(sessionId, null)).toThrow(NotAuthenticatedError);
    expect(() => service.authorizeSeeker(sessionId, 'f'.repeat(48))).toThrow(
      NotAuthenticatedError,
    );
    expect(() => service.authorizeContact(sessionId, 'wrong')).toThrow(NotAuthenticatedError);
  });

  it('the contact token rides inside the alert live link and authorizes the contact view', async () => {
    const { service, notifier } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    await service.confirm(sessionId);
    const link = notifier.contactAlerts[0].liveSessionLink;
    const token = new URL(link).searchParams.get('t');
    expect(token).toBeTruthy();
    expect(() => service.authorizeContact(sessionId, token)).not.toThrow();
    expect(() => service.authorizeSeekerOrContact(sessionId, null, token)).not.toThrow();
  });

  it('seeker and contact tokens are not interchangeable', async () => {
    const { service, notifier } = buildRig();
    const receipt = service.trigger(TRIGGER_FIXTURE);
    await service.confirm(receipt.sessionId);
    const contactToken = new URL(notifier.contactAlerts[0].liveSessionLink).searchParams.get('t');
    expect(() => service.authorizeSeeker(receipt.sessionId, contactToken)).toThrow(
      NotAuthenticatedError,
    );
    expect(() => service.authorizeContact(receipt.sessionId, receipt.seekerToken)).toThrow(
      NotAuthenticatedError,
    );
  });
});

describe('per-session PINs', () => {
  it('enrolled PINs replace the config fallbacks', async () => {
    const { service } = buildRig();
    const input = { ...TRIGGER_FIXTURE, pins: { safe: '2468', duress: '8642' } };
    const a = service.trigger(input);
    const response = await service.cancel(a.sessionId, '2468');
    expect(response.status).toBe('cancelled');

    const b = service.trigger(input);
    // The config fallback PIN is now just a wrong PIN.
    await expect(service.cancel(b.sessionId, TEST_CONFIG.pins.safe)).rejects.toThrow();
    const duressResponse = await service.cancel(b.sessionId, '8642');
    expect(duressResponse.status).toBe('cancelled');
    expect(service.opsView(b.sessionId).state).toBe('ACTIVE');
  });

  it('rejects malformed or identical PINs at trigger', () => {
    const { service } = buildRig();
    expect(() =>
      service.trigger({ ...TRIGGER_FIXTURE, pins: { safe: 'abcd', duress: '9999' } }),
    ).toThrow(InvalidInputError);
    expect(() =>
      service.trigger({ ...TRIGGER_FIXTURE, pins: { safe: '1111', duress: '1111' } }),
    ).toThrow(InvalidInputError);
  });
});

describe('input validation', () => {
  const bad = (patch: Partial<typeof TRIGGER_FIXTURE>) => () =>
    buildRig().service.trigger({ ...TRIGGER_FIXTURE, ...patch });

  it('rejects out-of-range coordinates', () => {
    expect(bad({ location: { lat: 91, lng: 77 } })).toThrow(InvalidInputError);
    expect(bad({ location: { lat: 12, lng: 181 } })).toThrow(InvalidInputError);
    expect(bad({ location: { lat: Number.NaN, lng: 77 } })).toThrow(InvalidInputError);
  });

  it('rejects empty identity and empty circles', () => {
    expect(bad({ displayName: '  ' })).toThrow(InvalidInputError);
    expect(bad({ contacts: [] })).toThrow(InvalidInputError);
    expect(bad({ category: 'parade' as never })).toThrow(InvalidInputError);
  });
});

describe('one live session per user', () => {
  it('blocks a second trigger while one is live', async () => {
    const { service } = buildRig();
    service.trigger(TRIGGER_FIXTURE);
    expect(() => service.trigger(TRIGGER_FIXTURE)).toThrow(ActiveSessionExistsError);
  });

  it('allows a new trigger after a real cancel', async () => {
    const { service } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    await service.cancel(sessionId, TEST_CONFIG.pins.safe);
    expect(() => service.trigger(TRIGGER_FIXTURE)).not.toThrow();
  });

  it('a duress-masked session does NOT block a new trigger — blocking would unmask it', async () => {
    const { service } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    await service.cancel(sessionId, TEST_CONFIG.pins.duress);
    // To the coercer this user has no session; a 409 here would say otherwise.
    expect(() => service.trigger(TRIGGER_FIXTURE)).not.toThrow();
  });
});

describe('withdrawal and re-dispatch', () => {
  async function dispatched() {
    const rig = buildRig();
    const { sessionId } = rig.service.trigger(TRIGGER_FIXTURE);
    await rig.service.confirm(sessionId);
    await rig.service.dispatch(sessionId, ROSTER_FIXTURE);
    rig.service.accept(sessionId, 'responder-a');
    return { ...rig, sessionId };
  }

  it('the accepted responder can withdraw; the session returns to ACTIVE', async () => {
    const { service, sessionId } = await dispatched();
    expect(service.withdraw(sessionId, 'responder-a').state).toBe('ACTIVE');
    const events = service.opsView(sessionId).events;
    expect(events[events.length - 1].type).toBe('RESPONDER_WITHDREW');
  });

  it('only the accepted responder can withdraw', async () => {
    const { service, sessionId } = await dispatched();
    expect(() => service.withdraw(sessionId, 'responder-b')).toThrow(
      ResponderNotAuthorizedError,
    );
  });

  it('after withdrawal another offered responder can accept; the withdrawn one cannot', async () => {
    const { service, sessionId } = await dispatched();
    service.withdraw(sessionId, 'responder-a');
    expect(() => service.accept(sessionId, 'responder-a')).toThrow(ResponderNotAuthorizedError);
    expect(service.accept(sessionId, 'responder-b').state).toBe('DISPATCHED');
  });

  it('a no-show responder is withdrawn automatically by the timer sweep', async () => {
    const { service, clock, sessionId } = await dispatched();
    clock.advance(TEST_CONFIG.responderArrivalTimeoutMs);
    await service.evaluateTimers(clock.now());
    expect(service.opsView(sessionId).state).toBe('ACTIVE');
    const last = service.opsView(sessionId).events.at(-1);
    expect(last?.type).toBe('RESPONDER_WITHDREW');
    expect(last?.data.reason).toBe('arrival_timeout');
  });
});

describe('escalation when nobody accepts', () => {
  it('re-alerts contacts exactly once, as an auditable self-loop event', async () => {
    const { service, clock, notifier } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    await service.confirm(sessionId);
    const alertsAfterActivation = notifier.contactAlerts.length;

    clock.advance(TEST_CONFIG.escalationAfterMs);
    await service.evaluateTimers(clock.now());
    expect(notifier.contactAlerts.length).toBe(alertsAfterActivation * 2);
    expect(notifier.contactAlerts.at(-1)?.escalation).toBe(true);
    expect(service.opsView(sessionId).events.at(-1)?.type).toBe('ESCALATION_RAISED');

    // The sweep must not fire a second escalation.
    clock.advance(TEST_CONFIG.escalationAfterMs);
    await service.evaluateTimers(clock.now());
    expect(notifier.contactAlerts.length).toBe(alertsAfterActivation * 2);
  });
});

describe('arrival code lockout', () => {
  it('locks after maxArrivalAttempts wrong codes, even for the right code', async () => {
    const { service, sessionId } = await (async () => {
      const rig = buildRig();
      const { sessionId } = rig.service.trigger(TRIGGER_FIXTURE);
      await rig.service.confirm(sessionId);
      await rig.service.dispatch(sessionId, ROSTER_FIXTURE);
      rig.service.accept(sessionId, 'responder-a');
      return { ...rig, sessionId };
    })();

    const code = service.getArrivalCode(sessionId);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < TEST_CONFIG.maxArrivalAttempts; i++) {
      expect(() => service.verifyArrival(sessionId, 'responder-a', wrong)).toThrow(
        InvalidArrivalCodeError,
      );
    }
    expect(() => service.verifyArrival(sessionId, 'responder-a', code)).toThrow(
      ArrivalCodeLockedError,
    );
  });
});
