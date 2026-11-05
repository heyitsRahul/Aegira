import { describe, expect, it } from 'vitest';
import { AUDIO_CONSENT_VERSION, consentText } from '../src/domain/consent';
import { InvalidInputError, LocationRejectedError, RecordingRejectedError } from '../src/domain/errors';
import { InMemoryAudioStore } from '../src/persistence/audio-store';
import { AudioUpload, EvidenceService } from '../src/services/evidence.service';
import { buildRig, ROSTER_FIXTURE, TEST_CONFIG, TRIGGER_FIXTURE } from './helpers/build-service';

/**
 * Opt-in sound recording (consent v8). The properties that matter are the
 * negative ones: no sound without consent or outside a live emergency, no
 * responder ever hears it, a duress mask never shows through, and purge
 * leaves nothing readable.
 */

const { safe: SAFE, duress: DURESS } = TEST_CONFIG.pins;
const SOUND = Buffer.from('OggS fake opus bytes for one piece').toString('base64');

function rig() {
  const base = buildRig();
  const store = new InMemoryAudioStore();
  const evidence = new EvidenceService(base.clock, base.crypto, base.service, store);
  return { ...base, store, evidence };
}

const piece = (seq: number, over: Partial<AudioUpload> = {}): AudioUpload => ({
  segment: 'rec0a1b2c',
  seq,
  mime: 'audio/webm;codecs=opus',
  data: SOUND,
  consent: AUDIO_CONSENT_VERSION,
  ...over,
});

async function live(r: ReturnType<typeof rig>) {
  const { sessionId } = r.service.trigger(TRIGGER_FIXTURE);
  await r.service.confirm(sessionId);
  return sessionId;
}

async function purgeAll(r: ReturnType<typeof rig>) {
  for (const step of [TEST_CONFIG.closeAfterResolveMs, TEST_CONFIG.purgeAfterCloseMs]) {
    r.clock.advance(step);
    await r.service.evaluateTimers(r.clock.now());
  }
}

describe('sound recording: consent and limits', () => {
  it('has a published consent text that names who can and cannot listen', () => {
    const text = consentText(AUDIO_CONSENT_VERSION);
    expect(text).toMatch(/trusted contacts can listen/);
    expect(text).toMatch(/responders never can/);
    expect(text).toMatch(/destroyed/);
  });

  it('refuses sound without the recording consent', async () => {
    const r = rig();
    const id = await live(r);
    expect(() => r.evidence.append(id, piece(0, { consent: 'v1' }))).toThrow(InvalidInputError);
    expect(() => r.evidence.append(id, piece(0, { consent: undefined }))).toThrow(InvalidInputError);
    expect(r.store.list(id)).toHaveLength(0);
  });

  it('refuses wrong types, bad formats and oversized pieces without storing anything', async () => {
    const r = rig();
    const id = await live(r);
    const bad: Partial<AudioUpload>[] = [
      { segment: '../../etc' },
      { segment: 'ABC' },
      { seq: -1 },
      { seq: 1.5 },
      { seq: '3' },
      { mime: 'text/html' },
      { mime: 'image/png' },
      { data: '<script>' },
      { data: '' },
      { data: Buffer.alloc(65 * 1024).toString('base64') },
    ];
    for (const over of bad) {
      expect(() => r.evidence.append(id, piece(0, over)), JSON.stringify(over).slice(0, 60)).toThrow(
        InvalidInputError,
      );
    }
    expect(r.store.list(id)).toHaveLength(0);
  });

  it('stores each piece once, so a retried upload is harmless', async () => {
    const r = rig();
    const id = await live(r);
    expect(r.evidence.append(id, piece(0)).stored).toBe(true);
    expect(r.evidence.append(id, piece(0)).stored).toBe(false);
    expect(r.store.list(id)).toHaveLength(1);
  });

  it('caps how much one session can store', async () => {
    const base = buildRig();
    const store = new InMemoryAudioStore();
    const evidence = new EvidenceService(base.clock, base.crypto, base.service, store, {
      maxPieceBytes: 64 * 1024,
      maxPiecesPerSession: 3,
      maxSegmentsPerSession: 2,
    });
    const { sessionId } = base.service.trigger(TRIGGER_FIXTURE);
    evidence.append(sessionId, piece(0));
    evidence.append(sessionId, piece(0, { segment: 'second01' }));
    expect(() => evidence.append(sessionId, piece(0, { segment: 'third001' }))).toThrow(InvalidInputError);
    evidence.append(sessionId, piece(1));
    expect(() => evidence.append(sessionId, piece(2))).toThrow(InvalidInputError);
  });
});

describe('sound recording: only during a live emergency', () => {
  it('accepts sound from the moment SOS is pressed (PENDING) through ARRIVED', async () => {
    const r = rig();
    const { sessionId: id } = r.service.trigger(TRIGGER_FIXTURE);
    r.evidence.append(id, piece(0));
    await r.service.confirm(id);
    r.evidence.append(id, piece(1));
    await r.service.dispatch(id, ROSTER_FIXTURE);
    const [offered] = r.notifier.responderOffers;
    r.service.accept(id, offered.to);
    r.evidence.append(id, piece(2));
    r.service.verifyArrival(id, offered.to, r.service.getArrivalCode(id));
    r.evidence.append(id, piece(3));
    expect(r.evidence.listForSeeker(id)).toEqual([expect.objectContaining({ pieces: 4 })]);
  });

  it('refuses sound on a journey watch: nobody has been alerted yet', () => {
    const r = rig();
    const { sessionId } = r.service.startWatch(TRIGGER_FIXTURE, 30 * 60 * 1000);
    expect(() => r.evidence.append(sessionId, piece(0))).toThrow(RecordingRejectedError);
  });

  it('refuses sound after "I am safe" and after a real cancel', async () => {
    const r = rig();
    const id = await live(r);
    await r.service.resolve(id, SAFE);
    expect(() => r.evidence.append(id, piece(0))).toThrow(RecordingRejectedError);

    const r2 = rig();
    const { sessionId } = r2.service.trigger(TRIGGER_FIXTURE);
    await r2.service.cancel(sessionId, SAFE);
    expect(() => r2.evidence.append(sessionId, piece(0))).toThrow(RecordingRejectedError);
  });
});

describe('sound recording: who can listen', () => {
  it('contacts can listen to the real recording while the emergency is live', async () => {
    const r = rig();
    const id = await live(r);
    r.evidence.append(id, piece(0));
    r.evidence.append(id, piece(1, { data: Buffer.from(' and the second piece').toString('base64') }));
    expect(r.evidence.listForContact(id)).toHaveLength(1);
    const clip = r.evidence.clipForContact(id, 'rec0a1b2c');
    expect(clip?.mime).toBe('audio/webm');
    expect(clip?.bytes.toString()).toBe('OggS fake opus bytes for one piece and the second piece');
  });

  it('contacts stop hearing it once the emergency is over; the helpseeker can still save it', async () => {
    const r = rig();
    const id = await live(r);
    r.evidence.append(id, piece(0));
    await r.service.resolve(id, SAFE);
    expect(r.evidence.listForContact(id)).toEqual([]);
    expect(r.evidence.clipForContact(id, 'rec0a1b2c')).toBeNull();
    expect(r.evidence.listForSeeker(id)).toHaveLength(1);
    expect(r.evidence.clipForSeeker(id, 'rec0a1b2c')).not.toBeNull();
  });

  it('a recording from another session is never joined into this one', async () => {
    const r = rig();
    const a = await live(r);
    const { sessionId: b } = r.service.trigger({ ...TRIGGER_FIXTURE, userId: 'someone-else' });
    r.evidence.append(a, piece(0));
    expect(r.evidence.clipForSeeker(b, 'rec0a1b2c')).toBeNull();
    expect(r.evidence.clipForContact(b, 'rec0a1b2c')).toBeNull();
  });

  it('nothing about sound reaches responders or any notification payload', async () => {
    const r = rig();
    const id = await live(r);
    r.evidence.append(id, piece(0));
    await r.service.dispatch(id, ROSTER_FIXTURE);
    const [offered] = r.notifier.responderOffers;
    r.service.accept(id, offered.to);
    const seen = JSON.stringify([
      r.service.responderView(id, offered.to),
      r.service.getDispatchLocation(id, offered.to),
      r.notifier.responderOffers,
      r.notifier.contactAlerts,
    ]);
    expect(seen).not.toMatch(/audio|sound|record|segment|rec0a1b2c|OggS/i);
  });
});

describe('sound recording under duress (invariant 4)', () => {
  it('after a duress cancel the device is refused and shown exactly what a real cancel shows', async () => {
    const real = rig();
    const forced = rig();
    const ids: string[] = [];
    for (const [r, pin] of [[real, SAFE], [forced, DURESS]] as const) {
      const { sessionId } = r.service.trigger(TRIGGER_FIXTURE);
      r.evidence.append(sessionId, piece(0));
      await r.service.cancel(sessionId, pin);
      ids.push(sessionId);
    }
    const attempt = (r: ReturnType<typeof rig>, id: string) => {
      try {
        r.evidence.append(id, piece(1));
        return 'stored';
      } catch (e) {
        return `${(e as Error).name}: ${(e as Error).message}`;
      }
    };
    expect(attempt(forced, ids[1])).toBe(attempt(real, ids[0]));
    const strip = (clips: unknown, id: string) => JSON.stringify(clips).replaceAll(id, 'ID');
    expect(strip(forced.evidence.listForSeeker(ids[1]), ids[1])).toBe(
      strip(real.evidence.listForSeeker(ids[0]), ids[0]),
    );
  });

  it('the sound sent before a duress cancel reaches the contacts, who get the secret alarm', async () => {
    const r = rig();
    const { sessionId } = r.service.trigger(TRIGGER_FIXTURE);
    r.evidence.append(sessionId, piece(0));
    await r.service.cancel(sessionId, DURESS);
    expect(r.service.contactView(sessionId).duress).toBe(true);
    expect(r.evidence.listForContact(sessionId)).toHaveLength(1);
  });

  it('a masked session hides its recording from the device on the benign purge schedule', async () => {
    const r = rig();
    const id = await live(r);
    r.evidence.append(id, piece(0));
    await r.service.resolve(id, DURESS);
    expect(r.evidence.listForSeeker(id)).toHaveLength(1);
    await purgeAll(r);
    // The real session is still live for the contacts...
    expect(r.evidence.listForContact(id)).toHaveLength(1);
    // ...but the device sees what a purged benign session would.
    expect(r.evidence.listForSeeker(id)).toEqual([]);
    expect(r.evidence.clipForSeeker(id, 'rec0a1b2c')).toBeNull();
  });
});

describe('sound recording: purge = key destruction (invariant 7)', () => {
  it('purging the session makes the sound unreadable, then the sweep clears the rows', async () => {
    const r = rig();
    const id = await live(r);
    r.evidence.append(id, piece(0));
    await r.service.resolve(id, SAFE);
    await purgeAll(r);
    expect(r.service.opsView(id).state).toBe('PURGED');
    const [row] = r.store.list(id);
    expect(() => r.crypto.decrypt(row.blob)).toThrow();
    expect(r.evidence.listForSeeker(id)).toEqual([]);
    expect(r.evidence.clipForSeeker(id, 'rec0a1b2c')).toBeNull();
    expect(r.evidence.sweep()).toBe(1);
    expect(r.store.list(id)).toHaveLength(0);
  });

  it('the sweep never touches a live session', async () => {
    const r = rig();
    const id = await live(r);
    r.evidence.append(id, piece(0));
    expect(r.evidence.sweep()).toBe(0);
    expect(r.store.list(id)).toHaveLength(1);
  });

  it('stored rows hold ciphertext only: no sound, no format', async () => {
    const r = rig();
    const id = await live(r);
    r.evidence.append(id, piece(0));
    const raw = JSON.stringify(r.store.list(id));
    expect(raw).not.toContain(SOUND);
    expect(raw).not.toMatch(/webm|opus/);
  });
});

describe('battery level (consent v7)', () => {
  it('reaches contacts with the latest fix, never responders', async () => {
    const r = rig();
    const id = await live(r);
    r.service.recordLocation(id, 12.9717, 77.5947, 14);
    expect(r.service.contactView(id).batteryPercent).toBe(14);
    await r.service.dispatch(id, ROSTER_FIXTURE);
    const [offered] = r.notifier.responderOffers;
    r.service.accept(id, offered.to);
    const responderSees = JSON.stringify([
      r.service.responderView(id, offered.to),
      r.service.getDispatchLocation(id, offered.to),
      r.notifier.responderOffers,
    ]);
    expect(responderSees).not.toMatch(/battery/i);
    expect(responderSees).not.toContain('"14"');
  });

  it('a bad battery reading is dropped, but the location is kept', async () => {
    const r = rig();
    const id = await live(r);
    for (const battery of [-5, 101, 3.5, '50', null]) {
      r.service.recordLocation(id, 12.9718, 77.5948, battery);
      expect(r.service.contactView(id).batteryPercent).toBeNull();
      expect(r.service.contactView(id).location?.lat).toBe(12.9718);
    }
  });

  it('refuses coordinates that are not coordinates', async () => {
    const r = rig();
    const id = await live(r);
    for (const [lat, lng] of [['12', 77], [NaN, 77], [12, Infinity], [91, 77], [12, -181], [null, null]]) {
      expect(() => r.service.recordLocation(id, lat, lng)).toThrow(InvalidInputError);
    }
  });
});

describe('location after a duress cancel (invariant 4)', () => {
  it('is refused exactly like after a real cancel, yet still reaches the contacts', async () => {
    const outcomes: string[] = [];
    let forcedRig: ReturnType<typeof rig> | null = null;
    let forcedId = '';
    for (const pin of [SAFE, DURESS]) {
      const r = rig();
      const { sessionId } = r.service.trigger(TRIGGER_FIXTURE);
      await r.service.cancel(sessionId, pin);
      try {
        r.service.recordLocation(sessionId, 12.98, 77.6);
        outcomes.push('recorded');
      } catch (e) {
        expect(e).toBeInstanceOf(LocationRejectedError);
        outcomes.push((e as Error).message);
      }
      if (pin === DURESS) {
        forcedRig = r;
        forcedId = sessionId;
      }
    }
    expect(outcomes[1]).toBe(outcomes[0]);
    expect(forcedRig!.service.contactView(forcedId).location?.lat).toBe(12.98);
  });
});
