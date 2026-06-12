import { Module } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SessionCrypto } from '../crypto/shredder';
import { openDatabase, SqliteKeyVault, SqliteSessionRepository } from '../persistence/sqlite';
import { MatchingService } from '../services/matching.service';
import { StubNotifier } from '../services/notification.service';
import { SessionService, SessionServiceConfig } from '../services/session.service';
import { DevController } from './dev.controller';
import { ResponderRegistry } from './responder-registry';
import {
  NOTIFIER,
  RESPONDER_REGISTRY,
  SESSION_SERVICE,
  SessionController,
} from './session.controller';
import { SystemClock } from './system-clock';

/**
 * Dev wiring. SQLite (Node's built-in driver) stands in for Postgres+KMS:
 * sessions and key material survive restarts, the event chain is verified
 * on rehydration, and crypto-shredding works across processes. The stub
 * notifier stands in for SMS/push. Fallback PINs: safe=1234, duress=9999;
 * the app enrolls per-user PINs at trigger time.
 * Set SAHAY_DB=:memory: for an ephemeral run.
 */
const DEV_CONFIG: SessionServiceConfig = {
  activationCountdownMs: 30_000,
  closeAfterResolveMs: 24 * 60 * 60 * 1000,
  closeAfterCancelMs: 60 * 60 * 1000,
  purgeAfterCloseMs: 7 * 24 * 60 * 60 * 1000,
  escalationAfterMs: 2 * 60 * 1000,
  responderArrivalTimeoutMs: 30 * 60 * 1000,
  maxArrivalAttempts: 5,
  maxResponderOffers: 3,
  pins: { safe: '1234', duress: '9999' },
};

function buildResponderRegistry(): ResponderRegistry {
  const registry = new ResponderRegistry();
  registry.enroll(
    { id: 'responder-asha', verified: true, availabilityCell: 'cell:1297:7759', hasOpenStrike: false },
    'asha-dev-token',
  );
  registry.enroll(
    { id: 'responder-vikram', verified: true, availabilityCell: 'cell:1298:7760', hasOpenStrike: false },
    'vikram-dev-token',
  );
  return registry;
}

function buildSessionService(notifier: StubNotifier): SessionService {
  const dbPath = process.env.SAHAY_DB ?? join(__dirname, '..', '..', 'var', 'sahay.db');
  if (dbPath !== ':memory:') {
    mkdirSync(join(__dirname, '..', '..', 'var'), { recursive: true });
  }
  const db = openDatabase(dbPath);
  return new SessionService(
    new SystemClock(),
    new SessionCrypto(new SqliteKeyVault(db)),
    notifier,
    new MatchingService(5),
    DEV_CONFIG,
    new SqliteSessionRepository(db),
  );
}

@Module({
  controllers: [SessionController, DevController],
  providers: [
    { provide: NOTIFIER, useValue: new StubNotifier() },
    { provide: RESPONDER_REGISTRY, useFactory: buildResponderRegistry },
    {
      provide: SESSION_SERVICE,
      useFactory: (notifier: StubNotifier) => buildSessionService(notifier),
      inject: [NOTIFIER],
    },
  ],
})
export class AppModule {}
