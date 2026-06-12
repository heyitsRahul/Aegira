import { describe, expect, it } from 'vitest';
import { buildRig, ROSTER_FIXTURE, TRIGGER_FIXTURE } from './helpers/build-service';

/**
 * Privacy tests assert on the NEGATIVE: what must never appear on the
 * wire. The fixtures use realistic identity values so a leak would be
 * caught by string search over the serialized payloads.
 */

async function dispatchedRig() {
  const rig = buildRig();
  const { sessionId } = rig.service.trigger(TRIGGER_FIXTURE);
  await rig.service.confirm(sessionId);
  await rig.service.dispatch(sessionId, ROSTER_FIXTURE);
  return { ...rig, sessionId };
}

describe('responder offers never carry identity (invariant 6)', () => {
  it('payloads contain no name, phone number, or user id', async () => {
    const { notifier } = await dispatchedRig();
    expect(notifier.responderOffers.length).toBeGreaterThan(0);
    const wire = JSON.stringify(notifier.responderOffers);
    expect(wire).not.toContain(TRIGGER_FIXTURE.displayName);
    expect(wire).not.toContain('Meera');
    expect(wire).not.toContain(TRIGGER_FIXTURE.userId);
    for (const contact of TRIGGER_FIXTURE.contacts) {
      expect(wire).not.toContain(contact.address);
    }
  });

  it('payloads contain no precise coordinates — only the coarse cell', async () => {
    const { notifier } = await dispatchedRig();
    const wire = JSON.stringify(notifier.responderOffers);
    expect(wire).not.toContain('12.9716');
    expect(wire).not.toContain('77.5946');
    expect(wire).not.toContain('"lat"');
    expect(wire).not.toContain('"lng"');
    // No decimal-degree-shaped number anywhere in a responder payload
    // (sentAt excluded: ISO millisecond timestamps contain "30.000Z").
    const withoutTimestamps = JSON.stringify(
      notifier.responderOffers.map(({ sentAt: _sentAt, ...rest }) => rest),
    );
    expect(withoutTimestamps).not.toMatch(/\d{1,3}\.\d{3,}/);
    for (const offer of notifier.responderOffers) {
      expect(offer.coarseCell).toMatch(/^cell:-?\d+:-?\d+$/);
    }
  });

  it('helpseeker appears only as a session alias', async () => {
    const { notifier } = await dispatchedRig();
    for (const offer of notifier.responderOffers) {
      expect(offer.alias).toMatch(/^helpseeker-[0-9a-f]{8}$/);
    }
  });

  it('payload shape is closed: exactly the audited fields, nothing else', async () => {
    const { notifier } = await dispatchedRig();
    for (const offer of notifier.responderOffers) {
      expect(Object.keys(offer).sort()).toEqual([
        'alias',
        'category',
        'coarseCell',
        'kind',
        'sentAt',
        'sessionId',
        'to',
      ]);
    }
  });

  it('the routing address is a responder id, never a phone number', async () => {
    const { notifier } = await dispatchedRig();
    for (const offer of notifier.responderOffers) {
      expect(offer.to).toMatch(/^responder-/);
    }
  });
});

describe('contact alerts carry no raw coordinates', () => {
  it('location travels only behind the session-scoped live link', async () => {
    const { notifier, sessionId } = await (async () => {
      const rig = buildRig();
      const { sessionId } = rig.service.trigger(TRIGGER_FIXTURE);
      await rig.service.confirm(sessionId);
      return { ...rig, sessionId };
    })();

    expect(notifier.contactAlerts).toHaveLength(2);
    const wire = JSON.stringify(notifier.contactAlerts);
    expect(wire).not.toContain('12.9716');
    expect(wire).not.toContain('77.5946');
    expect(wire).not.toContain('"lat"');
    expect(wire).not.toContain('"lng"');
    for (const alert of notifier.contactAlerts) {
      expect(alert.liveSessionLink).toContain(sessionId);
    }
  });
});
