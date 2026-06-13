import { InMemoryKeyVault, SessionCrypto } from '../../src/crypto/shredder';
import { MatchingService, ResponderProfile } from '../../src/services/matching.service';
import { StubNotifier } from '../../src/services/notification.service';
import {
  SessionService,
  SessionServiceConfig,
  TriggerInput,
} from '../../src/services/session.service';
import { ManualClock } from './manual-clock';

export const TEST_CONFIG: SessionServiceConfig = {
  activationCountdownMs: 30_000,
  closeAfterResolveMs: 24 * 60 * 60 * 1000,
  closeAfterCancelMs: 60 * 60 * 1000,
  purgeAfterCloseMs: 7 * 24 * 60 * 60 * 1000,
  escalationAfterMs: 10 * 60 * 1000,
  responderArrivalTimeoutMs: 20 * 60 * 1000,
  maxArrivalAttempts: 3,
  maxResponderOffers: 3,
  minWatchMs: 60 * 1000,
  maxWatchMs: 12 * 60 * 60 * 1000,
  pins: { safe: '1234', duress: '9999' },
  publicBaseUrl: 'http://localhost:3000',
};

export interface TestRig {
  clock: ManualClock;
  crypto: SessionCrypto;
  vault: InMemoryKeyVault;
  notifier: StubNotifier;
  service: SessionService;
}

export function buildRig(config: SessionServiceConfig = TEST_CONFIG): TestRig {
  const clock = new ManualClock(new Date('2026-06-12T10:00:00.000Z'));
  const vault = new InMemoryKeyVault();
  const crypto = new SessionCrypto(vault);
  const notifier = new StubNotifier();
  const service = new SessionService(clock, crypto, notifier, new MatchingService(5), config);
  return { clock, crypto, vault, notifier, service };
}

export const TRIGGER_FIXTURE: TriggerInput = {
  userId: 'user-77',
  displayName: 'Meera Krishnan',
  contacts: [
    { id: 'contact-1', address: '+91-98765-43210' },
    { id: 'contact-2', address: '+91-91234-56789' },
  ],
  location: { lat: 12.9716, lng: 77.5946 },
  category: 'personal_safety',
};

export const ROSTER_FIXTURE: ResponderProfile[] = [
  { id: 'responder-a', verified: true, availabilityCell: 'cell:1297:7759', hasOpenStrike: false },
  { id: 'responder-b', verified: true, availabilityCell: 'cell:1298:7760', hasOpenStrike: false },
  { id: 'responder-c', verified: true, availabilityCell: 'cell:1295:7757', hasOpenStrike: false },
  { id: 'responder-unverified', verified: false, availabilityCell: 'cell:1297:7759', hasOpenStrike: false },
  { id: 'responder-struck', verified: true, availabilityCell: 'cell:1297:7759', hasOpenStrike: true },
  { id: 'responder-far', verified: true, availabilityCell: 'cell:1400:7800', hasOpenStrike: false },
];
