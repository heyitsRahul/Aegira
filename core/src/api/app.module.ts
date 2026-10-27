import { Module } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SessionCrypto } from '../crypto/shredder';
import {
  openDatabase,
  SqliteKeyVault,
  SqliteRegistrationStore,
  SqliteSessionRepository,
  SqliteWaitlistStore,
} from '../persistence/sqlite';
import { MatchingService } from '../services/matching.service';
import { InMemoryMetrics } from '../services/metrics';
import { Notifier, StubNotifier } from '../services/notification.service';
import { RegistrationService } from '../services/registration.service';
import { SessionService, SessionServiceConfig } from '../services/session.service';
import { CompositeNotifier, SmsNotifier, StubSmsTransport } from '../services/sms';
import { SmsGatewayService } from '../services/sms-gateway.service';
import { twilioConfigFromEnv, TwilioSmsTransport } from '../services/twilio';
import { WaitlistService } from '../services/waitlist.service';
import { DEMO_MODE, DevController, OUTBOX, SMS_TRANSPORT } from './dev.controller';
import {
  ALLOW_UNSIGNED_TWILIO,
  GATEWAY_SECRET,
  GatewayController,
  PUBLIC_BASE_URL,
  SMS_GATEWAY,
  TWILIO_AUTH_TOKEN,
} from './gateway.controller';
import { AdminController, ADMIN_TOKEN } from './admin.controller';
import { LiteController, REGISTRATIONS } from './lite.controller';
import { METRICS, PublicController, WAITLIST } from './public.controller';
import { ReferenceController } from './reference.controller';
import { ResponderRegistry } from './responder-registry';
import {
  NOTIFIER,
  RESPONDER_REGISTRY,
  SESSION_SERVICE,
  SessionController,
} from './session.controller';
import { resolveRuntimeConfig } from './runtime-config';
import { SystemClock } from './system-clock';

/**
 * Dev/production wiring. SQLite (Node's built-in driver) stands in for
 * Postgres+KMS. Notifications fan out to the app stub AND SMS; if TWILIO_*
 * env vars are set, real outbound SMS is added on top of the stub (which the
 * /phone simulator reads). Fallback PINs: safe=1234, duress=9999.
 *
 * Env (see runtime-config.ts): AEGIRA_DB, AEGIRA_BASE_URL, AEGIRA_DEMO,
 * AEGIRA_GATEWAY_SECRET, AEGIRA_ADMIN_TOKEN, TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.
 */
const RUNTIME = resolveRuntimeConfig(process.env);
const PUBLIC_URL = RUNTIME.baseUrl;

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
  publicBaseUrl: PUBLIC_URL,
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

function buildWiring() {
  const dbPath = RUNTIME.dbPath ?? join(__dirname, '..', '..', 'var', 'aegira.db');
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = openDatabase(dbPath);
  const clock = new SystemClock();
  const metrics = new InMemoryMetrics();
  const appOutbox = new StubNotifier();
  const smsStub = new StubSmsTransport();

  // The stub SMS always runs (so the /phone simulator works). Real Twilio
  // delivery is added on top when configured — never in demo mode, where
  // anyone can type any contact number into the public app.
  const channels: Notifier[] = [appOutbox, new SmsNotifier(smsStub)];
  const twilioConfig = twilioConfigFromEnv(process.env);
  if (twilioConfig !== null && !RUNTIME.demoMode) {
    channels.push(new SmsNotifier(new TwilioSmsTransport(twilioConfig)));
  }
  const notifier = new CompositeNotifier(...channels);

  const registry = buildResponderRegistry();
  const sessions = new SessionService(
    clock,
    new SessionCrypto(new SqliteKeyVault(db)),
    notifier,
    new MatchingService(5),
    DEV_CONFIG,
    new SqliteSessionRepository(db),
    metrics,
  );
  const registrations = new RegistrationService(new SqliteRegistrationStore(db), clock);
  const gateway = new SmsGatewayService(sessions, registrations, () => registry.all());
  const waitlist = new WaitlistService(new SqliteWaitlistStore(db), clock);
  return {
    appOutbox,
    smsStub,
    metrics,
    registry,
    sessions,
    registrations,
    gateway,
    waitlist,
    twilioAuthToken: twilioConfig?.authToken ?? null,
  };
}

const wiring = buildWiring();

@Module({
  controllers: [
    SessionController,
    DevController,
    GatewayController,
    LiteController,
    ReferenceController,
    PublicController,
    AdminController,
  ],
  providers: [
    { provide: NOTIFIER, useValue: wiring.appOutbox },
    { provide: OUTBOX, useValue: wiring.appOutbox },
    { provide: SMS_TRANSPORT, useValue: wiring.smsStub },
    { provide: RESPONDER_REGISTRY, useValue: wiring.registry },
    { provide: SESSION_SERVICE, useValue: wiring.sessions },
    { provide: REGISTRATIONS, useValue: wiring.registrations },
    { provide: SMS_GATEWAY, useValue: wiring.gateway },
    { provide: GATEWAY_SECRET, useValue: RUNTIME.gatewaySecret },
    { provide: ALLOW_UNSIGNED_TWILIO, useValue: !RUNTIME.production },
    { provide: DEMO_MODE, useValue: RUNTIME.demoMode },
    { provide: TWILIO_AUTH_TOKEN, useValue: wiring.twilioAuthToken },
    { provide: PUBLIC_BASE_URL, useValue: PUBLIC_URL },
    { provide: WAITLIST, useValue: wiring.waitlist },
    { provide: METRICS, useValue: wiring.metrics },
    { provide: ADMIN_TOKEN, useValue: RUNTIME.adminToken },
  ],
})
export class AppModule {}
