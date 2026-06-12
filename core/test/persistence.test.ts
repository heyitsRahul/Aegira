import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionCrypto } from '../src/crypto/shredder';
import { openDatabase, SqliteKeyVault, SqliteSessionRepository } from '../src/persistence/sqlite';
import { MatchingService } from '../src/services/matching.service';
import { StubNotifier } from '../src/services/notification.service';
import { SessionService } from '../src/services/session.service';
import { ManualClock } from './helpers/manual-clock';
import { ROSTER_FIXTURE, TEST_CONFIG, TRIGGER_FIXTURE } from './helpers/build-service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let tmp: string;
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function bootService(dbPath: string, clock: ManualClock) {
  const db = openDatabase(dbPath);
  const crypto = new SessionCrypto(new SqliteKeyVault(db));
  const notifier = new StubNotifier();
  const service = new SessionService(
    clock,
    crypto,
    notifier,
    new MatchingService(5),
    TEST_CONFIG,
    new SqliteSessionRepository(db),
  );
  return { service, crypto, notifier, db };
}

describe('sessions survive a process restart', () => {
  it('rehydrates state, ciphertext, and tokens from disk', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'sahay-'));
    const dbPath = join(tmp, 'sahay.db');
    const clock = new ManualClock(new Date('2026-06-12T10:00:00.000Z'));

    const a = bootService(dbPath, clock);
    const receipt = a.service.trigger(TRIGGER_FIXTURE);
    await a.service.confirm(receipt.sessionId);
    await a.service.dispatch(receipt.sessionId, ROSTER_FIXTURE);
    a.service.accept(receipt.sessionId, 'responder-a');
    a.db.close();

    // "Restart": a brand-new service over the same database file.
    const b = bootService(dbPath, clock);
    expect(b.service.opsView(receipt.sessionId).state).toBe('DISPATCHED');
    expect(b.service.contactView(receipt.sessionId).helpseekerDisplayName).toBe(
      TRIGGER_FIXTURE.displayName,
    );
    expect(
      b.service.responderView(receipt.sessionId, 'responder-a').location?.lat,
    ).toBeCloseTo(TRIGGER_FIXTURE.location.lat);
    // The seeker token from before the restart still authorizes.
    expect(() => b.service.authorizeSeeker(receipt.sessionId, receipt.seekerToken)).not.toThrow();
  });

  it('timers pick up where they left off after a restart', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'sahay-'));
    const dbPath = join(tmp, 'sahay.db');
    const clock = new ManualClock(new Date('2026-06-12T10:00:00.000Z'));

    const a = bootService(dbPath, clock);
    const { sessionId } = a.service.trigger(TRIGGER_FIXTURE);
    a.db.close();

    clock.advance(TEST_CONFIG.activationCountdownMs);
    const b = bootService(dbPath, clock);
    await b.service.evaluateTimers(clock.now());
    expect(b.service.opsView(sessionId).state).toBe('ACTIVE');
    // The activation alert went out from the post-restart process.
    expect(b.notifier.contactAlerts.length).toBe(TRIGGER_FIXTURE.contacts.length);
  });

  it('crypto-shredding survives restarts: purged stays purged', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'sahay-'));
    const dbPath = join(tmp, 'sahay.db');
    const clock = new ManualClock(new Date('2026-06-12T10:00:00.000Z'));

    const a = bootService(dbPath, clock);
    const { sessionId } = a.service.trigger(TRIGGER_FIXTURE);
    await a.service.cancel(sessionId, TEST_CONFIG.pins.safe);
    clock.advance(HOUR);
    await a.service.evaluateTimers(clock.now());
    clock.advance(7 * DAY);
    await a.service.evaluateTimers(clock.now());
    expect(a.service.opsView(sessionId).state).toBe('PURGED');
    a.db.close();

    const b = bootService(dbPath, clock);
    expect(b.service.opsView(sessionId).state).toBe('PURGED');
    expect(b.crypto.isShredded(sessionId)).toBe(true);
    const view = b.service.contactView(sessionId);
    expect(view.location).toBeNull();
    expect(view.helpseekerDisplayName).toBe('');
  });

  it('a tampered store refuses to load (hash chain verification)', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'sahay-'));
    const dbPath = join(tmp, 'sahay.db');
    const clock = new ManualClock(new Date('2026-06-12T10:00:00.000Z'));

    const a = bootService(dbPath, clock);
    const { sessionId } = a.service.trigger(TRIGGER_FIXTURE);
    await a.service.confirm(sessionId);
    a.db.close();

    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT snapshot FROM sessions WHERE id = ?').get(sessionId) as {
      snapshot: string;
    };
    const snapshot = JSON.parse(row.snapshot);
    snapshot.events[1].data.reason = 'tampered';
    db.prepare('UPDATE sessions SET snapshot = ? WHERE id = ?').run(
      JSON.stringify(snapshot),
      sessionId,
    );

    const crypto = new SessionCrypto(new SqliteKeyVault(db));
    expect(
      () =>
        new SessionService(
          clock,
          crypto,
          new StubNotifier(),
          new MatchingService(5),
          TEST_CONFIG,
          new SqliteSessionRepository(db),
        ),
    ).toThrow(/verification/);
  });
});
