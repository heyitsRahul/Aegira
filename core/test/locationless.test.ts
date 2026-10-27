import { describe, expect, it } from 'vitest';
import { InvalidInputError, LocationUnknownError, ResponderNotAuthorizedError } from '../src/domain/errors';
import { TriggerInput } from '../src/services/session.service';
import { buildRig, ROSTER_FIXTURE, TEST_CONFIG, TRIGGER_FIXTURE } from './helpers/build-service';

/**
 * SOS from a basic phone through an ordinary SIM arrives with no position.
 * The circle must still be alerted; strangers must not be summoned blind;
 * the helpseeker's own description of the place reaches contacts only.
 */

const { location: _omit, ...WITHOUT_LOCATION } = TRIGGER_FIXTURE;
const LOCATIONLESS: TriggerInput = { ...WITHOUT_LOCATION, placeNote: 'near Andheri station gate 2' };
const DAY = 24 * 60 * 60 * 1000;

async function activeLocationless(input: TriggerInput = LOCATIONLESS) {
  const rig = buildRig();
  const { sessionId } = rig.service.trigger(input);
  await rig.service.confirm(sessionId);
  return { ...rig, sessionId };
}

describe('SOS without a location', () => {
  it('still creates a session and alerts every trusted contact', async () => {
    const { notifier } = await activeLocationless();
    expect(notifier.contactAlerts).toHaveLength(TRIGGER_FIXTURE.contacts.length);
    for (const alert of notifier.contactAlerts) {
      expect(alert.locationKnown).toBe(false);
      expect(alert.placeNote).toBe('near Andheri station gate 2');
    }
  });

  it('works with neither a location nor a place note', async () => {
    const { notifier, service, sessionId } = await activeLocationless(WITHOUT_LOCATION);
    expect(notifier.contactAlerts[0].placeNote).toBeNull();
    expect(service.contactView(sessionId).location).toBeNull();
  });

  it('a normal SOS reports its location as known', async () => {
    const rig = buildRig();
    const { sessionId } = rig.service.trigger(TRIGGER_FIXTURE);
    await rig.service.confirm(sessionId);
    expect(rig.notifier.contactAlerts[0].locationKnown).toBe(true);
    expect(rig.notifier.contactAlerts[0].placeNote).toBeNull();
  });

  it('contacts see the place note; no location is invented', async () => {
    const { service, sessionId } = await activeLocationless();
    const view = service.contactView(sessionId);
    expect(view.placeNote).toBe('near Andheri station gate 2');
    expect(view.location).toBeNull();
    expect(view.locationAgeMs).toBeNull();
  });

  it('refuses to summon strangers blind', async () => {
    const { service, sessionId, notifier } = await activeLocationless();
    await expect(service.dispatch(sessionId, ROSTER_FIXTURE)).rejects.toThrow(LocationUnknownError);
    expect(notifier.responderOffers).toHaveLength(0);
    expect(() => service.responderView(sessionId, ROSTER_FIXTURE[0].id)).toThrow(
      ResponderNotAuthorizedError,
    );
  });

  it('becomes dispatchable once the first location fix arrives', async () => {
    const { service, sessionId, notifier } = await activeLocationless();
    service.recordLocation(sessionId, 12.9716, 77.5946);
    const candidates = await service.dispatch(sessionId, ROSTER_FIXTURE);
    expect(candidates.length).toBeGreaterThan(0);
    expect(notifier.responderOffers[0].coarseCell).toMatch(/^cell:-?\d+:-?\d+$/);
  });

  it('survives escalation with no location', async () => {
    const { service, clock, notifier } = await activeLocationless();
    clock.advance(TEST_CONFIG.escalationAfterMs);
    await service.evaluateTimers(clock.now());
    const escalations = notifier.contactAlerts.filter((a) => a.escalation);
    expect(escalations.length).toBeGreaterThan(0);
    expect(escalations[0].locationKnown).toBe(false);
  });
});

describe('the place note is contact-only and crypto-mortal (invariants 6, 7)', () => {
  it('never appears in a responder offer or responder view', async () => {
    const { service, sessionId, notifier } = await activeLocationless();
    service.recordLocation(sessionId, 12.9716, 77.5946);
    await service.dispatch(sessionId, ROSTER_FIXTURE);
    const offers = JSON.stringify(notifier.responderOffers);
    expect(offers).not.toContain('Andheri');
    expect(offers).not.toContain('placeNote');
    const view = JSON.stringify(service.responderView(sessionId, notifier.responderOffers[0].to));
    expect(view).not.toContain('Andheri');
  });

  it('is never in the durable event log', async () => {
    const { service, sessionId } = await activeLocationless();
    expect(JSON.stringify(service.opsView(sessionId))).not.toContain('Andheri');
  });

  it('is gone after purge (key destroyed)', async () => {
    const { service, sessionId, clock } = await activeLocationless();
    await service.resolve(sessionId, '1234');
    clock.advance(TEST_CONFIG.closeAfterResolveMs);
    await service.evaluateTimers(clock.now());
    clock.advance(TEST_CONFIG.purgeAfterCloseMs + DAY);
    await service.evaluateTimers(clock.now());
    expect(service.opsView(sessionId).state).toBe('PURGED');
    expect(service.contactView(sessionId).placeNote).toBeNull();
  });

  it('is withheld from contacts during a pre-alert journey watch', () => {
    const { service } = buildRig();
    const { sessionId } = service.startWatch(LOCATIONLESS, 20 * 60 * 1000);
    expect(service.contactView(sessionId).placeNote).toBeNull();
  });
});

describe('location and place-note validation', () => {
  it('rejects a place note longer than one SMS can carry', () => {
    const { service } = buildRig();
    expect(() => service.trigger({ ...LOCATIONLESS, placeNote: 'x'.repeat(141) })).toThrow(
      InvalidInputError,
    );
  });

  it('still rejects coordinates that are not real', () => {
    const { service } = buildRig();
    expect(() => service.trigger({ ...TRIGGER_FIXTURE, location: { lat: 200, lng: 0 } })).toThrow(
      InvalidInputError,
    );
  });
});
