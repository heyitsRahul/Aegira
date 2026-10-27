import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/domain/errors';
import { SessionAggregate } from '../src/domain/session';
import { IllegalTransitionError, transition } from '../src/domain/state-machine';
import { SessionState } from '../src/domain/types';
import { buildRig, ROSTER_FIXTURE, TEST_CONFIG, TestRig } from './helpers/build-service';

/**
 * Chaos runs: hundreds of seeded random sequences of everything a user,
 * contact, responder, attacker and the clock can do, in any order. After
 * EVERY step, the safety rules are re-checked across every session. A
 * failure prints the seed, so the exact run can be replayed.
 *
 * The example tests elsewhere prove each rule on the paths we thought of;
 * this proves them on the paths we did not.
 */

const SEEDS = 300;
const STEPS = 60;

/** Small deterministic PRNG (mulberry32) so every run is replayable. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USERS = [
  { userId: 'user-meera', displayName: 'Meera Krishnan', phone: '+919876543210' },
  { userId: 'user-arjun', displayName: 'Arjun Rao', phone: '+919123456789' },
  { userId: 'user-fatima', displayName: 'Fatima Sheikh', phone: '+918888877777' },
];
const PLACE_NOTE = 'behind Lakshmi Sweets, gate 3';
// Distinctive coordinates near the seeded roster, so a leak is greppable.
const PRECISE = { lat: 12.971634, lng: 77.594612 };
const SECRETS = [
  ...USERS.flatMap((u) => [u.userId, u.displayName, u.phone, u.displayName.split(' ')[0]]),
  PLACE_NOTE,
  '12.9716',
  '77.5946',
];

const LIVE: readonly SessionState[] = ['WATCHING', 'PENDING', 'ACTIVE', 'DISPATCHED', 'ARRIVED'];

interface Tracked {
  id: string;
  user: number;
  seekerToken: string;
  /** What the coerced device must keep seeing, if duress was used. */
  masked: 'CANCELLED' | 'RESOLVED' | null;
}

type Pick = <T>(items: readonly T[]) => T;

/** One random action. Domain refusals are fine; anything else is a bug. */
async function step(rig: TestRig, sessions: Tracked[], rand: () => number, pick: Pick): Promise<string> {
  const { service, clock } = rig;
  const s = sessions.length > 0 ? pick(sessions) : null;
  const roll = rand();

  if (s === null || roll < 0.12) {
    const user = Math.floor(rand() * USERS.length);
    const u = USERS[user];
    const input = {
      userId: u.userId,
      displayName: u.displayName,
      contacts: [{ id: 'c1', address: u.phone }],
      ...(rand() < 0.7 ? { location: PRECISE } : {}),
      ...(rand() < 0.5 ? { placeNote: PLACE_NOTE } : {}),
      category: pick(['personal_safety', 'medical', 'accident', 'other'] as const),
    };
    const watch = rand() < 0.25;
    await refusalsAllowed(() => {
      const receipt = watch
        ? service.startWatch(input, Math.floor(TEST_CONFIG.minWatchMs + rand() * 30 * 60_000))
        : service.trigger(input);
      sessions.push({ id: receipt.sessionId, user, seekerToken: receipt.seekerToken, masked: null });
    });
    return watch ? 'watch' : 'trigger';
  }

  const actions: Array<[string, () => unknown]> = [
    ['confirm', () => service.confirm(s.id)],
    ['cancel-safe', () => service.cancel(s.id, TEST_CONFIG.pins.safe)],
    [
      'cancel-duress',
      async () => {
        const before = service.opsView(s.id).state;
        const res = await service.cancel(s.id, TEST_CONFIG.pins.duress);
        // Byte-for-byte the same shape a real cancel returns.
        expect(res).toEqual({ status: 'cancelled', sessionId: s.id });
        expect(before).toBe('PENDING');
        s.masked = 'CANCELLED';
      },
    ],
    ['cancel-wrong', () => service.cancel(s.id, pick(['0000', '', '12345678', '1234 ']))],
    ['checkin-safe', () => service.checkInSafe(s.id, TEST_CONFIG.pins.safe)],
    [
      'checkin-duress',
      async () => {
        const res = await service.checkInSafe(s.id, TEST_CONFIG.pins.duress);
        expect(res).toEqual({ status: 'safe', sessionId: s.id });
        s.masked = 'RESOLVED';
      },
    ],
    ['extend', () => service.extendWatch(s.id, pick([-1, 0, 60_000, 10 * 60_000, Number.NaN]))],
    ['location', () => service.recordLocation(s.id, PRECISE.lat, PRECISE.lng)],
    ['dispatch', () => service.dispatch(s.id, ROSTER_FIXTURE)],
    ['accept', () => service.accept(s.id, pick(ROSTER_FIXTURE).id)],
    ['withdraw', () => service.withdraw(s.id, pick(ROSTER_FIXTURE).id)],
    [
      'arrival',
      () => {
        const accepted = ['responder-a', 'responder-b', 'responder-c'];
        const code = rand() < 0.5 ? service.getArrivalCode(s.id) : pick(['000000', '', 'abcdef']);
        return service.verifyArrival(s.id, pick(accepted), code);
      },
    ],
    ['resolve-safe', () => service.resolve(s.id, TEST_CONFIG.pins.safe)],
    [
      'resolve-duress',
      async () => {
        const res = await service.resolve(s.id, TEST_CONFIG.pins.duress);
        // Exactly what a real "I'm safe" returns.
        expect(res).toEqual({ sessionId: s.id, state: 'RESOLVED' });
        s.masked ??= 'RESOLVED';
      },
    ],
    ['resolve-wrong', () => service.resolve(s.id, pick(['0000', '', '99999']))],
    [
      'stolen-token',
      () => {
        // Someone else's token, or a contact-shaped guess, never works.
        const other = pick(sessions);
        const token = other.id === s.id ? 'not-a-token' : other.seekerToken;
        expect(() => service.authorizeSeeker(s.id, token)).toThrow(DomainError);
        expect(() => service.authorizeContact(s.id, s.seekerToken)).toThrow(DomainError);
      },
    ],
    [
      'time',
      async () => {
        clock.advance(pick([1_000, 31_000, 11 * 60_000, 25 * 60_000, 2 * 60 * 60_000, 26 * 60 * 60_000, 8 * 24 * 60 * 60_000]));
        await service.evaluateTimers(clock.now());
      },
    ],
  ];
  const [name, run] = pick(actions);
  await refusalsAllowed(run);
  return name;
}

/** The app saying "no" is expected; any other error (a crash) fails the run. */
async function refusalsAllowed(run: () => unknown): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof DomainError) && !(error instanceof IllegalTransitionError)) {
      throw error;
    }
  }
}

function checkRules(rig: TestRig, sessions: Tracked[]): void {
  const { service, crypto, notifier } = rig;
  const liveUnmaskedPerUser = new Map<number, number>();

  for (const s of sessions) {
    const { state, events } = service.opsView(s.id);

    // Tamper-evident log: every hash links to the one before.
    expect(SessionAggregate.verifyEvents(events)).toBe(true);

    // Replaying the log through the state machine lands on the same state,
    // so nothing ever changed state behind the machine's back (invariant 2).
    let replay: SessionState = events[0].type === 'WATCH_ARMED' ? 'WATCHING' : 'PENDING';
    for (const event of events.slice(1)) {
      // Cancel only ever from PENDING (invariant 3).
      if (event.type === 'CANCEL_CONFIRMED') {
        expect(replay).toBe('PENDING');
      }
      replay = transition(replay, event.type);
    }
    expect(replay).toBe(state);

    // The durable event log never holds identity, place or coordinates.
    const log = JSON.stringify(events);
    for (const secret of SECRETS) {
      expect(log).not.toContain(secret);
    }

    // Purge = the key is gone; nothing readable is left (invariant 7).
    if (state === 'PURGED') {
      expect(crypto.isShredded(s.id)).toBe(true);
      const view = service.contactView(s.id);
      expect(view.helpseekerDisplayName).toBe('');
      expect(view.location).toBeNull();
      expect(view.placeNote).toBeNull();
    }

    // The duress lie holds forever on the coerced device (invariant 4).
    if (s.masked !== null) {
      expect([s.masked, 'CLOSED', 'PURGED']).toContain(service.clientStatus(s.id).state);
    } else if (LIVE.includes(state)) {
      liveUnmaskedPerUser.set(s.user, (liveUnmaskedPerUser.get(s.user) ?? 0) + 1);
    }
  }

  // At most one real live emergency per person.
  for (const count of liveUnmaskedPerUser.values()) {
    expect(count).toBeLessThanOrEqual(1);
  }

  // Responders only ever see an alias and a ~1 km cell (invariant 6).
  const offers = JSON.stringify(notifier.responderOffers);
  for (const secret of SECRETS) {
    expect(offers).not.toContain(secret);
  }
  // Contacts may see the name and the place note, but a message at rest
  // never carries raw coordinates: those stay behind the live link.
  const alerts = JSON.stringify(notifier.contactAlerts);
  expect(alerts).not.toContain('12.9716');
  expect(alerts).not.toContain('77.5946');
}

describe(`chaos: ${SEEDS} random runs × ${STEPS} steps, rules checked after every step`, () => {
  it('no sequence of actions breaks a safety rule', async () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rig = buildRig();
      const rand = prng(seed);
      const pick: Pick = (items) => items[Math.floor(rand() * items.length)];
      const sessions: Tracked[] = [];
      for (let i = 0; i < STEPS; i++) {
        let action = '?';
        try {
          action = await step(rig, sessions, rand, pick);
          checkRules(rig, sessions);
        } catch (error) {
          throw new Error(`seed ${seed}, step ${i} (${action}): ${(error as Error).message}`);
        }
        seen.add(action);
      }
    }
    // The runs really did exercise every kind of action.
    expect(seen.size).toBeGreaterThanOrEqual(16);
  }, 120_000);

  it('the random runs reach every state, including the rare ones', async () => {
    const reached = new Set<SessionState>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rig = buildRig();
      const rand = prng(seed);
      const pick: Pick = (items) => items[Math.floor(rand() * items.length)];
      const sessions: Tracked[] = [];
      for (let i = 0; i < STEPS; i++) {
        await step(rig, sessions, rand, pick);
        for (const s of sessions) {
          reached.add(rig.service.opsView(s.id).state);
        }
      }
    }
    expect([...reached].sort()).toEqual(
      ['ACTIVE', 'ARRIVED', 'CANCELLED', 'CLOSED', 'DISPATCHED', 'PENDING', 'PURGED', 'RESOLVED', 'WATCHING'],
    );
  }, 120_000);
});
