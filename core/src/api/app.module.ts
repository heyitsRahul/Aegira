import { Module } from '@nestjs/common';
import { InMemoryKeyVault, SessionCrypto } from '../crypto/shredder';
import { MatchingService } from '../services/matching.service';
import { StubNotifier } from '../services/notification.service';
import { SessionService, SessionServiceConfig } from '../services/session.service';
import { ResponderRegistry } from './responder-registry';
import { RESPONDER_REGISTRY, SESSION_SERVICE, SessionController } from './session.controller';
import { SystemClock } from './system-clock';

/**
 * Dev wiring only. The in-memory vault stands in for KMS, the stub
 * notifier for SMS/push, and the PINs below are dev fixtures:
 * safe = 1234, duress = 9999.
 */
const DEV_CONFIG: SessionServiceConfig = {
  activationCountdownMs: 30_000,
  closeAfterResolveMs: 24 * 60 * 60 * 1000,
  closeAfterCancelMs: 60 * 60 * 1000,
  purgeAfterCloseMs: 7 * 24 * 60 * 60 * 1000,
  maxResponderOffers: 3,
  pins: { safe: '1234', duress: '9999' },
};

function buildResponderRegistry(): ResponderRegistry {
  const registry = new ResponderRegistry();
  registry.upsert({
    id: 'responder-asha',
    verified: true,
    availabilityCell: 'cell:1297:7759',
    hasOpenStrike: false,
  });
  registry.upsert({
    id: 'responder-vikram',
    verified: true,
    availabilityCell: 'cell:1298:7760',
    hasOpenStrike: false,
  });
  return registry;
}

@Module({
  controllers: [SessionController],
  providers: [
    { provide: RESPONDER_REGISTRY, useFactory: buildResponderRegistry },
    {
      provide: SESSION_SERVICE,
      useFactory: () =>
        new SessionService(
          new SystemClock(),
          new SessionCrypto(new InMemoryKeyVault()),
          new StubNotifier(),
          new MatchingService(5),
          DEV_CONFIG,
        ),
    },
  ],
})
export class AppModule {}
