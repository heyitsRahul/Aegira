import { describe, expect, it } from 'vitest';
import {
  InMemoryRegistrationStore,
  RegistrationService,
} from '../src/services/registration.service';
import { SmsGatewayService } from '../src/services/sms-gateway.service';
import { CompositeNotifier, SmsNotifier, StubSmsTransport } from '../src/services/sms';
import { InMemoryKeyVault, SessionCrypto } from '../src/crypto/shredder';
import { MatchingService } from '../src/services/matching.service';
import { StubNotifier } from '../src/services/notification.service';
import { SessionService } from '../src/services/session.service';
import { ManualClock } from './helpers/manual-clock';
import { ROSTER_FIXTURE, TEST_CONFIG } from './helpers/build-service';

const SEEKER = '+91 90000 12345';
const CONTACT = '9876543210';
// What CONTACT normalizes to once stored (E.164). Outbound SMS is addressed
// to this canonical form regardless of how the seeker typed the number.
const CONTACT_E164 = '+919876543210';
const TOWER = { lat: 12.9716, lng: 77.5946 };

function buildSmsRig() {
  const clock = new ManualClock(new Date('2026-06-13T10:00:00.000Z'));
  const sms = new StubSmsTransport();
  const appStub = new StubNotifier();
  const service = new SessionService(
    clock,
    new SessionCrypto(new InMemoryKeyVault()),
    new CompositeNotifier(appStub, new SmsNotifier(sms)),
    new MatchingService(5),
    TEST_CONFIG,
  );
  const registrations = new RegistrationService(new InMemoryRegistrationStore(), clock);
  const gateway = new SmsGatewayService(service, registrations, () => ROSTER_FIXTURE);
  return { clock, sms, appStub, service, registrations, gateway };
}

async function registered(rig = buildSmsRig()) {
  await rig.gateway.handle(SEEKER, `REG Meera_Krishnan ${CONTACT} 1234 9999`);
  return rig;
}

describe('SMS registration (consent v4)', () => {
  it('registers with underscored names and confirms the consent version', async () => {
    const { gateway } = buildSmsRig();
    const reply = await gateway.handle(SEEKER, `REG Meera_Krishnan ${CONTACT} 1234 9999`);
    expect(reply).toContain('Meera Krishnan');
    expect(reply).toContain('v4');
  });

  it('rejects malformed registrations with usable guidance', async () => {
    const { gateway } = buildSmsRig();
    expect(await gateway.handle(SEEKER, 'REG Meera')).toContain('REG <name>');
    expect(await gateway.handle(SEEKER, `REG Meera ${CONTACT} 12 9999`)).toContain('4-6 digits');
    expect(await gateway.handle(SEEKER, `REG Meera ${CONTACT} 1234 1234`)).toContain('differ');
  });

  it('STOP deletes the registration, as consent v4 promises', async () => {
    const rig = await registered();
    expect(await rig.gateway.handle(SEEKER, 'STOP')).toContain('deleted');
    expect(await rig.gateway.handle(SEEKER, 'SOS', TOWER)).toContain('not registered');
  });
});

describe('SOS over SMS', () => {
  it('triggers a session using only the carrier position from the webhook', async () => {
    const rig = await registered();
    const reply = await rig.gateway.handle(SEEKER, 'SOS', TOWER);
    expect(reply).toContain('30s');
    const sessionId = rig.service.latestSessionIdForUser(
      rig.registrations.find(SEEKER)!.phoneRef,
    );
    expect(sessionId).not.toBeNull();
    expect(rig.service.opsView(sessionId!).state).toBe('PENDING');
  });

  it('with no carrier position, still alerts the circle and says so (no stored fallback, invariant 1)', async () => {
    const rig = await registered();
    const reply = await rig.gateway.handle(SEEKER, 'SOS');
    expect(reply).toContain('30s');
    expect(reply).toContain('Tell your circle where you are');
    rig.clock.advance(TEST_CONFIG.activationCountdownMs);
    await rig.service.evaluateTimers(rig.clock.now());
    const alert = rig.sms.messages.find((m) => m.to === CONTACT_E164);
    expect(alert!.text).toContain('AEGIRA ALERT');
    expect(alert!.text).toContain('Location unknown - call them');
    expect(alert!.text).not.toContain('Reply SEND');
  });

  it('carries the place in the sender\'s own words to the circle', async () => {
    const rig = await registered();
    const reply = await rig.gateway.handle(SEEKER, 'SOS near Andheri station gate 2');
    expect(reply).not.toContain('Tell your circle');
    rig.clock.advance(TEST_CONFIG.activationCountdownMs);
    await rig.service.evaluateTimers(rig.clock.now());
    const alert = rig.sms.messages.find((m) => m.to === CONTACT_E164);
    expect(alert!.text).toContain('They said: "near Andheri station gate 2"');
  });

  it('a category letter and a place can be combined', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS M outside Lilavati hospital');
    const sessionId = rig.service.latestSessionIdForUser(rig.registrations.find(SEEKER)!.phoneRef)!;
    rig.clock.advance(TEST_CONFIG.activationCountdownMs);
    await rig.service.evaluateTimers(rig.clock.now());
    const view = rig.service.contactView(sessionId);
    expect(view.category).toBe('medical');
    expect(view.placeNote).toBe('outside Lilavati hospital');
  });

  it('a duress alert with no position never tells the contact to call', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS');
    await rig.gateway.handle(SEEKER, 'CANCEL 9999');
    const alert = rig.sms.messages.find((m) => m.to === CONTACT_E164);
    expect(alert!.text).toContain('DURESS');
    expect(alert!.text).toContain('Location unknown.');
    expect(alert!.text).not.toContain('Location unknown - call them');
  });

  it('a contact\'s SEND is answered honestly when nobody can be sent', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS');
    rig.clock.advance(TEST_CONFIG.activationCountdownMs);
    await rig.service.evaluateTimers(rig.clock.now());
    const reply = await rig.gateway.handle(CONTACT, 'SEND');
    expect(reply).toContain('no helper can be sent');
    expect(rig.sms.messages.filter((m) => m.text.startsWith('AEGIRA DISPATCH'))).toHaveLength(0);
  });

  it('a place note never reaches a responder', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS near Andheri station', TOWER);
    rig.clock.advance(TEST_CONFIG.activationCountdownMs);
    await rig.service.evaluateTimers(rig.clock.now());
    await rig.gateway.handle(CONTACT, 'SEND');
    const offers = rig.sms.messages.filter((m) => m.text.startsWith('AEGIRA DISPATCH'));
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer.text).not.toContain('Andheri');
    }
  });

  it('category letters map to categories', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS M', TOWER);
    const sessionId = rig.service.latestSessionIdForUser(rig.registrations.find(SEEKER)!.phoneRef)!;
    expect(rig.service.contactView(sessionId).category).toBe('medical');
  });

  it('a second SOS points at the running session', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS', TOWER);
    expect(await rig.gateway.handle(SEEKER, 'SOS', TOWER)).toContain('STATUS');
  });
});

describe('duress over SMS (invariant 4)', () => {
  it('CANCEL replies are one constant string for safe and duress PINs', async () => {
    const rigA = await registered();
    await rigA.gateway.handle(SEEKER, 'SOS', TOWER);
    const safeReply = await rigA.gateway.handle(SEEKER, 'CANCEL 1234');

    const rigB = await registered();
    await rigB.gateway.handle(SEEKER, 'SOS', TOWER);
    const duressReply = await rigB.gateway.handle(SEEKER, 'CANCEL 9999');

    expect(duressReply).toBe(safeReply);
    expect(rigA.service.opsView(rigA.service.latestSessionIdForUser(rigA.registrations.find(SEEKER)!.phoneRef)!).state).toBe('CANCELLED');
    expect(rigB.service.opsView(rigB.service.latestSessionIdForUser(rigB.registrations.find(SEEKER)!.phoneRef)!).state).toBe('ACTIVE');
  });

  it('STATUS after a duress cancel reads exactly like after a real cancel', async () => {
    const rigA = await registered();
    await rigA.gateway.handle(SEEKER, 'SOS', TOWER);
    await rigA.gateway.handle(SEEKER, 'CANCEL 1234');

    const rigB = await registered();
    await rigB.gateway.handle(SEEKER, 'SOS', TOWER);
    await rigB.gateway.handle(SEEKER, 'CANCEL 9999');

    expect(await rigB.gateway.handle(SEEKER, 'STATUS')).toBe(
      await rigA.gateway.handle(SEEKER, 'STATUS'),
    );
  });

  it('the duress contact SMS warns the contact, and only the contact', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS', TOWER);
    await rig.gateway.handle(SEEKER, 'CANCEL 9999');
    const toContact = rig.sms.messages.filter((m) => m.to === CONTACT_E164);
    expect(toContact.length).toBe(1);
    expect(toContact[0].text).toContain('DURESS');
    expect(toContact[0].text).toContain('DO NOT call');
  });

  it('a duress PIN on SAFE behaves exactly like any wrong PIN', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS', TOWER);
    rig.clock.advance(TEST_CONFIG.activationCountdownMs);
    await rig.service.evaluateTimers(rig.clock.now());
    const wrongReply = await rig.gateway.handle(SEEKER, 'SAFE 0000');
    expect(await rig.gateway.handle(SEEKER, 'SAFE 9999')).toBe(wrongReply);
  });
});

describe('the full feature-phone rescue', () => {
  it('SOS -> activation -> contact SEND -> responder offer, all by text', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS', TOWER);
    rig.clock.advance(TEST_CONFIG.activationCountdownMs);
    await rig.service.evaluateTimers(rig.clock.now());

    // The contact's basic phone received a plain-text alert with a link.
    const alert = rig.sms.messages.find((m) => m.to === CONTACT_E164);
    expect(alert).toBeDefined();
    expect(alert!.text).toContain('AEGIRA ALERT');
    expect(alert!.text).toContain('Reply SEND');

    // The contact replies SEND; responders get identity-free offers.
    expect(await rig.gateway.handle(CONTACT, 'SEND')).toContain('responders');
    const offers = rig.sms.messages.filter((m) => m.text.startsWith('AEGIRA DISPATCH'));
    expect(offers.length).toBeGreaterThan(0);

    // The seeker resolves by text.
    expect(await rig.gateway.handle(SEEKER, 'SAFE 1234')).toContain('resolved');
  });

  it('SEND from a stranger dispatches nothing', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS', TOWER);
    rig.clock.advance(TEST_CONFIG.activationCountdownMs);
    await rig.service.evaluateTimers(rig.clock.now());
    expect(await rig.gateway.handle('+91 70000 00000', 'SEND')).toContain('nothing');
  });

  it('unknown commands get the help text', async () => {
    const { gateway } = buildSmsRig();
    expect(await gateway.handle(SEEKER, 'hello?')).toContain('Aegira commands');
  });
});

describe('SMS wire privacy (negative assertions)', () => {
  it('responder offer SMS carries alias + coarse cell, never identity or coordinates', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS', TOWER);
    rig.clock.advance(TEST_CONFIG.activationCountdownMs);
    await rig.service.evaluateTimers(rig.clock.now());
    await rig.gateway.handle(CONTACT, 'SEND');

    const offers = rig.sms.messages.filter((m) => m.text.startsWith('AEGIRA DISPATCH'));
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer.text).toMatch(/helpseeker-[0-9a-f]{8}/);
      expect(offer.text).toMatch(/cell:-?\d+:-?\d+/);
      expect(offer.text).not.toContain('Meera');
      expect(offer.text).not.toContain(CONTACT);
      expect(offer.text).not.toContain('12345');
      expect(offer.text).not.toMatch(/\d{1,3}\.\d{3,}/);
    }
  });

  it('contact alert SMS carries the live link but no raw coordinates', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'SOS', TOWER);
    rig.clock.advance(TEST_CONFIG.activationCountdownMs);
    await rig.service.evaluateTimers(rig.clock.now());
    const alert = rig.sms.messages.find((m) => m.to === CONTACT_E164)!;
    expect(alert.text).toContain('/lite/c/');
    expect(alert.text).not.toMatch(/12\.9\d+/);
    expect(alert.text).not.toMatch(/77\.5\d+/);
  });
});

describe('journey watch over SMS', () => {
  const MIN = 60 * 1000;

  it('WATCH arms a watch; SAFE checks in quietly', async () => {
    const rig = await registered();
    const reply = await rig.gateway.handle(SEEKER, 'WATCH 20', TOWER);
    expect(reply).toContain('20 min');
    const sessionId = rig.service.latestSessionIdForUser(rig.registrations.find(SEEKER)!.phoneRef)!;
    expect(rig.service.opsView(sessionId).state).toBe('WATCHING');
    expect(rig.sms.messages.filter((m) => m.to === CONTACT_E164)).toHaveLength(0);

    expect(await rig.gateway.handle(SEEKER, 'SAFE 1234')).toContain('checked in safe');
    expect(rig.service.opsView(sessionId).state).toBe('RESOLVED');
  });

  it('WATCH works with no network position, taking an optional destination', async () => {
    const rig = await registered();
    expect(await rig.gateway.handle(SEEKER, 'WATCH 20 walking home to Powai')).toContain('20 min');
    const sessionId = rig.service.latestSessionIdForUser(rig.registrations.find(SEEKER)!.phoneRef)!;
    expect(rig.service.opsView(sessionId).state).toBe('WATCHING');
    rig.clock.advance(20 * MIN);
    await rig.service.evaluateTimers(rig.clock.now());
    const alert = rig.sms.messages.find((m) => m.to === CONTACT_E164);
    expect(alert!.text).toContain('did not check in');
    expect(alert!.text).toContain('They said: "walking home to Powai"');
  });

  it('a missed deadline escalates and alerts the contact with the watch wording', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'WATCH 20', TOWER);
    rig.clock.advance(20 * MIN);
    await rig.service.evaluateTimers(rig.clock.now());
    const alert = rig.sms.messages.find((m) => m.to === CONTACT_E164);
    expect(alert?.text).toContain('did not check in');
    expect(alert?.text).toContain('Reply SEND');
  });

  it('EXTEND pushes the deadline out', async () => {
    const rig = await registered();
    await rig.gateway.handle(SEEKER, 'WATCH 20', TOWER);
    rig.clock.advance(15 * MIN);
    expect(await rig.gateway.handle(SEEKER, 'EXTEND 20')).toContain('extended');
    rig.clock.advance(10 * MIN);
    await rig.service.evaluateTimers(rig.clock.now());
    const sessionId = rig.service.latestSessionIdForUser(rig.registrations.find(SEEKER)!.phoneRef)!;
    expect(rig.service.opsView(sessionId).state).toBe('WATCHING');
  });

  it('SAFE on a watch is duress-safe: identical reply, silent escalation', async () => {
    const safe = await registered();
    await safe.gateway.handle(SEEKER, 'WATCH 20', TOWER);
    const safeReply = await safe.gateway.handle(SEEKER, 'SAFE 1234');

    const duress = await registered();
    await duress.gateway.handle(SEEKER, 'WATCH 20', TOWER);
    const duressReply = await duress.gateway.handle(SEEKER, 'SAFE 9999');

    expect(duressReply).toBe(safeReply);
    const sid = duress.service.latestSessionIdForUser(duress.registrations.find(SEEKER)!.phoneRef)!;
    expect(duress.service.opsView(sid).state).toBe('ACTIVE');
    expect(duress.sms.messages.find((m) => m.to === CONTACT_E164)?.text).toContain('DURESS');
  });
});
