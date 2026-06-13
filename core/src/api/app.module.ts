import { Module } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SessionCrypto } from '../crypto/shredder';
import {
  openDatabase,
  SqliteKeyVault,
  SqliteRegistrationStore,
  SqliteSessionRepository,
} from '../persistence/sqlite';
import { MatchingService } from '../services/matching.service';
import { StubNotifier } from '../services/notification.service';
import { RegistrationService } from '../services/registration.service';
import { SessionService, SessionServiceConfig } from '../services/session.service';
import { CompositeNotifier, SmsNotifier, StubSmsTransport } from '../services/sms';
import { SmsGatewayService } from '../services/sms-gateway.service';
import { DevController, OUTBOX, SMS_TRANSPORT } from './dev.controller';
import { GATEWAY_SECRET, GatewayController, SMS_GATEWAY } from './gateway.controller';
import { LiteController, REGISTRATIONS } from './lite.controller';
import { ReferenceController } from './reference.controller';
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
 * sessions, registrations, and key material survive restarts, the event
 * chain is verified on rehydration, and crypto-shredding works across
 * processes. Notifications fan out to the app stub AND the SMS stub, so
 * every channel sees the same closed payloads. Fallback PINs: safe=1234,
 * duress=9999; both UIs enroll per-user PINs.
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
  minWatchMs: 60 * 1000,
  maxWatchMs: 12 * 60 * 60 * 1000,
  pins: { safe: '1234', duress: '9999' },
  publicBaseUrl: process.env.SAHAY_BASE_URL ?? 'http://localhost:3000',
};

const DEV_GATEWAY_SECRET = 'dev-gateway-secret';

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

function buildWiring() {
  const dbPath = process.env.SAHAY_DB ?? join(__dirname, '..', '..', 'var', 'sahay.db');
  if (dbPath !== ':memory:') {
    mkdirSync(join(__dirname, '..', '..', 'var'), { recursive: true });
  }
  const db = openDatabase(dbPath);
  const clock = new SystemClock();
  const appOutbox = new StubNotifier();
  const smsTransport = new StubSmsTransport();
  const notifier = new CompositeNotifier(appOutbox, new SmsNotifier(smsTransport));
  const registry = buildResponderRegistry();
  const sessions = new SessionService(
    clock,
    new SessionCrypto(new SqliteKeyVault(db)),
    notifier,
    new MatchingService(5),
    DEV_CONFIG,
    new SqliteSessionRepository(db),
  );
  const registrations = new RegistrationService(new SqliteRegistrationStore(db), clock);
  const gateway = new SmsGatewayService(sessions, registrations, () => registry.all());
  return { appOutbox, smsTransport, registry, sessions, registrations, gateway };
}

const wiring = buildWiring();

@Module({
  controllers: [
    SessionController,
    DevController,
    GatewayController,
    LiteController,
    ReferenceController,
  ],
  providers: [
    { provide: NOTIFIER, useValue: wiring.appOutbox },
    { provide: OUTBOX, useValue: wiring.appOutbox },
    { provide: SMS_TRANSPORT, useValue: wiring.smsTransport },
    { provide: RESPONDER_REGISTRY, useValue: wiring.registry },
    { provide: SESSION_SERVICE, useValue: wiring.sessions },
    { provide: REGISTRATIONS, useValue: wiring.registrations },
    { provide: SMS_GATEWAY, useValue: wiring.gateway },
    { provide: GATEWAY_SECRET, useValue: DEV_GATEWAY_SECRET },
  ],
})
export class AppModule {}
