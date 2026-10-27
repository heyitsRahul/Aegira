import { Module } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SessionCrypto } from '../crypto/shredder';
import {
  openDatabase,
  SqliteKeyVault,
  SqliteRegistrationStore,
  SqliteSessionRepository,
  SqliteSmsOptInStore,
  SqliteWaitlistStore,
} from '../persistence/sqlite';
import {
  AndroidGatewaySmsTransport,
  androidGatewayConfigFromEnv,
} from '../services/android-gateway';
import { MatchingService } from '../services/matching.service';
import { InMemoryMetrics } from '../services/metrics';
import { Notifier, StubNotifier } from '../services/notification.service';
import { RegistrationService } from '../services/registration.service';
import { SessionService, SessionServiceConfig } from '../services/session.service';
import { CompositeNotifier, SmsNotifier, SmsTransport, StubSmsTransport } from '../services/sms';
import { SmsGatewayService } from '../services/sms-gateway.service';
import { DEMO_SMS_LIMITS, GuardedSmsTransport, SmsGuard, SmsKind } from '../services/sms-guard';
import { SmsOptInService } from '../services/sms-optin.service';
import { twilioConfigFromEnv, TwilioSmsTransport } from '../services/twilio';
import { WaitlistService } from '../services/waitlist.service';
import { DEMO_MODE, DevController, OUTBOX, SMS_TRANSPORT } from './dev.controller';
import {
  ALLOW_UNSIGNED_WEBHOOKS,
  ANDROID_GATEWAY,
  GATEWAY_CLOCK,
  GATEWAY_SECRET,
  GatewayController,
  PUBLIC_BASE_URL,
  SMS_GATEWAY,
  TWILIO_AUTH_TOKEN,
} from './gateway.controller';
import { AdminController, ADMIN_TOKEN } from './admin.controller';
import { GuideController, PUBLIC_CONFIG } from './guide.controller';
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
  const registrations = new RegistrationService(new SqliteRegistrationStore(db), clock);
  const optIns = new SmsOptInService(new SqliteSmsOptInStore(db), clock);

  // Real SMS from a public demo is guarded: alerts only reach numbers that
  // agreed (JOIN, or registered themselves), under daily caps (sms-guard.ts).
  const guard = new SmsGuard(
    clock,
    DEMO_SMS_LIMITS,
    (to) => {
      try {
        return optIns.hasJoined(to) || registrations.find(to) !== undefined;
      } catch {
        return false;
      }
    },
    metrics,
  );
  const real = (transport: SmsTransport, kind: SmsKind): SmsTransport =>
    RUNTIME.demoMode ? new GuardedSmsTransport(transport, guard, kind) : transport;

  // The stub SMS always runs (so the /phone simulator works). Real carriers
  // are added on top when configured; they carry contact alerts only, since
  // responders are addressed by id, not by phone number.
  const channels: Notifier[] = [appOutbox, new SmsNotifier(smsStub)];
  const twilioConfig = twilioConfigFromEnv(process.env);
  if (twilioConfig !== null) {
    channels.push(
      new SmsNotifier(real(new TwilioSmsTransport(twilioConfig), 'alert'), { responderOffers: false }),
    );
  }
  const androidConfig = androidGatewayConfigFromEnv(process.env);
  const androidTransport = androidConfig === null ? null : new AndroidGatewaySmsTransport(androidConfig);
  if (androidTransport !== null) {
    channels.push(new SmsNotifier(real(androidTransport, 'alert'), { responderOffers: false }));
  }
  const notifier = new CompositeNotifier(...channels).onChannelFailure(() =>
    metrics.increment('notify.channel_failed'),
  );

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
  const gateway = new SmsGatewayService(
    sessions,
    registrations,
    () => registry.all(),
    optIns,
    // Only real SMS is guarded; the simulator always delivers.
    RUNTIME.demoMode && (twilioConfig !== null || androidConfig !== null),
  );
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
    android:
      androidConfig === null || androidTransport === null
        ? null
        : { config: androidConfig, reply: real(androidTransport, 'reply') },
    clock,
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
    GuideController,
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
    { provide: ALLOW_UNSIGNED_WEBHOOKS, useValue: !RUNTIME.production },
    { provide: ANDROID_GATEWAY, useValue: wiring.android },
    { provide: GATEWAY_CLOCK, useValue: wiring.clock },
    { provide: DEMO_MODE, useValue: RUNTIME.demoMode },
    { provide: TWILIO_AUTH_TOKEN, useValue: wiring.twilioAuthToken },
    { provide: PUBLIC_BASE_URL, useValue: PUBLIC_URL },
    { provide: WAITLIST, useValue: wiring.waitlist },
    { provide: METRICS, useValue: wiring.metrics },
    { provide: ADMIN_TOKEN, useValue: RUNTIME.adminToken },
    { provide: PUBLIC_CONFIG, useValue: { smsNumber: RUNTIME.smsNumber, demoMode: RUNTIME.demoMode } },
  ],
})
export class AppModule {}
