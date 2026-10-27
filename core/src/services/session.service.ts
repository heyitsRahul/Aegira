import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { CURRENT_CONSENT_VERSION } from '../domain/consent';
import {
  ActiveSessionExistsError,
  ArrivalCodeLockedError,
  CancelNotAllowedError,
  InvalidArrivalCodeError,
  InvalidInputError,
  InvalidPinError,
  LocationRejectedError,
  LocationUnknownError,
  NotAuthenticatedError,
  ResponderNotAuthorizedError,
  SessionNotFoundError,
  WatchActionNotAllowedError,
} from '../domain/errors';
import { cellId, toCell } from '../domain/geo';
import { normalizePhone } from '../domain/phone';
import { SessionAggregate } from '../domain/session';
import { IllegalTransitionError } from '../domain/state-machine';
import { Clock, PreciseLocation, SessionCategory, SessionEvent, SessionState } from '../domain/types';
import { EncryptedBlob, SessionCrypto } from '../crypto/shredder';
import {
  InMemorySessionRepository,
  SessionRepository,
  SessionSnapshot,
} from '../persistence/session-repository';
import { MatchCandidate, MatchingService, ResponderProfile } from './matching.service';
import { Metrics, NoopMetrics } from './metrics';
import { Notifier } from './notification.service';

export interface SessionServiceConfig {
  /** PENDING auto-activates after this long (the cancel window). */
  activationCountdownMs: number;
  closeAfterResolveMs: number;
  closeAfterCancelMs: number;
  purgeAfterCloseMs: number;
  /** ACTIVE with no acceptance for this long → contacts re-alerted once. */
  escalationAfterMs: number;
  /** DISPATCHED with no arrival for this long → automatic withdrawal. */
  responderArrivalTimeoutMs: number;
  maxArrivalAttempts: number;
  maxResponderOffers: number;
  /** Bounds for a journey watch ETA (timed check-in). */
  minWatchMs: number;
  maxWatchMs: number;
  /** Fallback PINs for dev wiring; real sessions enroll their own. */
  pins: { safe: string; duress: string };
  /**
   * Base URL for contact live-links. Points at /lite/c/... so the link in
   * an alert SMS opens on any browser, however old.
   */
  publicBaseUrl: string;
}

export interface TriggerInput {
  userId: string;
  displayName: string;
  contacts: ReadonlyArray<{ id: string; address: string }>;
  /**
   * Where the helpseeker is, if known. Optional: a basic phone texting SOS
   * through an ordinary SIM has no position. Contacts are still alerted;
   * responders cannot be matched until a location arrives.
   */
  location?: { lat: number; lng: number };
  /**
   * Free-text place in the helpseeker's own words ("near Andheri station").
   * Stored inside the encrypted session PII, shown only to trusted contacts,
   * never to responders, destroyed with the session key.
   */
  placeNote?: string;
  category: SessionCategory;
  /** Per-user PINs enrolled for this session; falls back to config. */
  pins?: { safe: string; duress: string };
  /**
   * Pre-hashed PINs (sha256 hex) for channels that enrolled them earlier,
   * e.g. SMS registration. Mutually exclusive with `pins`.
   */
  pinHashes?: { safe: string; duress: string };
}

export interface TriggerReceipt {
  sessionId: string;
  state: SessionState;
  activationCountdownMs: number;
  /** Capability token for the triggering device. Returned exactly once. */
  seekerToken: string;
}

export interface CancelResponse {
  status: 'cancelled';
  sessionId: string;
}

/** Returned by both safe and duress check-ins — identical by design. */
export interface CheckInResponse {
  status: 'safe';
  sessionId: string;
}

export interface WatchReceipt {
  sessionId: string;
  state: SessionState;
  seekerToken: string;
  /** ISO deadline; if no check-in by then, the circle is alerted. */
  watchDeadline: string;
}

export interface ClientStatus {
  sessionId: string;
  state: SessionState;
  /** Present only while WATCHING (and not masked): the check-in deadline. */
  watchDeadline?: string;
}

/**
 * What a trusted contact's app sees. Contacts get the REAL state and the
 * live location — they are the helpseeker's chosen circle, and the duress
 * mask exists only to fool whoever holds the helpseeker's device.
 */
export interface ContactView {
  sessionId: string;
  state: SessionState;
  duress: boolean;
  category: SessionCategory;
  helpseekerDisplayName: string;
  location: PreciseLocation | null;
  /**
   * Age of the latest location fix in ms, or null if none. Lets a contact
   * see "updated 4 min ago" and infer a dead/offline phone instead of
   * trusting a stale dot — a gap real safety apps fill with "last seen".
   */
  locationAgeMs: number | null;
  /** The helpseeker's own description of where they are, if given. */
  placeNote: string | null;
}

/** What an offered/accepted responder's app sees. Identity-free. */
export interface ResponderView {
  sessionId: string;
  state: SessionState;
  alias: string;
  category: SessionCategory;
  coarseCell: string;
  /** Precise location only for the accepted responder while DISPATCHED. */
  location: PreciseLocation | null;
}

interface SessionPii {
  userId: string;
  displayName: string;
  contacts: Array<{ id: string; address: string }>;
  placeNote?: string;
}

/**
 * Set when a duress PIN faked a benign outcome. `benign` is the timeline
 * the coerced device must keep showing — CANCELLED for a duress cancel,
 * RESOLVED for a duress journey check-in (invariant 4).
 */
interface DuressMask {
  atIso: string;
  benign: 'CANCELLED' | 'RESOLVED';
}

interface StoredSession {
  aggregate: SessionAggregate;
  alias: string;
  /** ~1 km matching area; null until the session gets its first location. */
  coarseCell: string | null;
  category: SessionCategory;
  userRef: string;
  encryptedPii: EncryptedBlob | null;
  encryptedLocations: EncryptedBlob[];
  encryptedContactToken: EncryptedBlob | null;
  /** sha256 of each contact address — reply-routing index, not identity. */
  contactRefs: string[];
  /** Set when a duress PIN faked a benign outcome; masks the client view. */
  duressMask: DuressMask | null;
  /** Deadline for a journey watch (WATCHING); null for SOS sessions. */
  watchDeadlineIso: string | null;
  offeredResponderIds: Set<string>;
  acceptedResponderId: string | null;
  arrivalCode: string | null;
  arrivalAttempts: number;
  seekerTokenHash: string;
  contactTokenHash: string;
  pinSafeHash: string;
  pinDuressHash: string;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Routing reference for a contact address. Phone-like addresses are
 * normalized to E.164 first so the same contact matches across channels
 * whatever the format; anything else (e.g. a future email) hashes as-is.
 */
function contactRefOf(address: string): string {
  try {
    return sha256(normalizePhone(address));
  } catch {
    return sha256(address);
  }
}

/** Constant-time comparison of a presented secret against a stored hash. */
function matchesHash(presented: string | null | undefined, storedHash: string): boolean {
  if (typeof presented !== 'string' || presented.length === 0) {
    return false;
  }
  return timingSafeEqual(Buffer.from(sha256(presented), 'hex'), Buffer.from(storedHash, 'hex'));
}

/** Long enough for a landmark, short enough to fit in one alert SMS. */
const MAX_PLACE_NOTE = 140;

const LIVE_STATES: readonly SessionState[] = [
  'WATCHING',
  'PENDING',
  'ACTIVE',
  'DISPATCHED',
  'ARRIVED',
];
/** States in which precise location pings are accepted. */
const LOCATION_STATES: readonly SessionState[] = [
  'WATCHING',
  'PENDING',
  'ACTIVE',
  'DISPATCHED',
  'ARRIVED',
];
/** States in which a contact may see the live location. */
const CONTACT_VISIBLE_STATES: readonly SessionState[] = [
  'PENDING',
  'ACTIVE',
  'DISPATCHED',
  'ARRIVED',
];
/** States a helpseeker can end with "I'm safe". */
const RESOLVABLE_STATES: readonly SessionState[] = ['ACTIVE', 'DISPATCHED', 'ARRIVED'];
const VALID_CATEGORIES: readonly SessionCategory[] = [
  'personal_safety',
  'medical',
  'accident',
  'other',
];

function lastLifecycleEvent(events: readonly SessionEvent[]): SessionEvent {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type !== 'ESCALATION_RAISED') {
      return events[i];
    }
  }
  return events[0];
}

function validateTrigger(input: TriggerInput): void {
  if (typeof input.displayName !== 'string' || input.displayName.trim().length === 0) {
    throw new InvalidInputError('displayName is required');
  }
  if (typeof input.userId !== 'string' || input.userId.trim().length === 0) {
    throw new InvalidInputError('userId is required');
  }
  if (!Array.isArray(input.contacts) || input.contacts.length === 0 || input.contacts.length > 5) {
    throw new InvalidInputError('between 1 and 5 trusted contacts are required');
  }
  for (const contact of input.contacts) {
    if (typeof contact?.address !== 'string' || contact.address.trim().length === 0) {
      throw new InvalidInputError('every contact needs an address');
    }
  }
  // Location is optional (a basic phone may have none), but if given it
  // must be real coordinates.
  if (input.location !== undefined && input.location !== null) {
    const { lat, lng } = input.location;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new InvalidInputError('location.lat must be a number in [-90, 90]');
    }
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new InvalidInputError('location.lng must be a number in [-180, 180]');
    }
  }
  if (input.placeNote !== undefined && input.placeNote !== null) {
    if (typeof input.placeNote !== 'string' || input.placeNote.trim().length > MAX_PLACE_NOTE) {
      throw new InvalidInputError(`place note must be text of at most ${MAX_PLACE_NOTE} characters`);
    }
  }
  if (!VALID_CATEGORIES.includes(input.category)) {
    throw new InvalidInputError('unknown category');
  }
  if (input.pins !== undefined && input.pinHashes !== undefined) {
    throw new InvalidInputError('provide pins or pinHashes, not both');
  }
  if (input.pins !== undefined) {
    const pinShape = /^\d{4,6}$/;
    if (
      input.pins === null ||
      typeof input.pins.safe !== 'string' ||
      typeof input.pins.duress !== 'string' ||
      !pinShape.test(input.pins.safe) ||
      !pinShape.test(input.pins.duress)
    ) {
      throw new InvalidInputError('pins must be 4-6 digits');
    }
    if (input.pins.safe === input.pins.duress) {
      throw new InvalidInputError('safe and duress pins must differ');
    }
  }
  if (input.pinHashes !== undefined) {
    const hashShape = /^[0-9a-f]{64}$/;
    if (
      input.pinHashes === null ||
      typeof input.pinHashes.safe !== 'string' ||
      typeof input.pinHashes.duress !== 'string' ||
      !hashShape.test(input.pinHashes.safe) ||
      !hashShape.test(input.pinHashes.duress)
    ) {
      throw new InvalidInputError('pin hashes must be sha256 hex');
    }
    if (input.pinHashes.safe === input.pinHashes.duress) {
      throw new InvalidInputError('safe and duress pins must differ');
    }
  }
}

/**
 * Orchestrates the session lifecycle. Owns no wall clock: time comes from
 * the injected Clock for event stamping, and ALL timer behavior runs
 * through the explicit evaluateTimers(now) sweep so it is fully testable
 * with a manual clock. Every state change goes through the aggregate's
 * state machine, and every mutation is written through to the repository,
 * which rehydrates (with chain verification) on boot.
 */
export class SessionService {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(
    private readonly clock: Clock,
    private readonly crypto: SessionCrypto,
    private readonly notifier: Notifier,
    private readonly matching: MatchingService,
    private readonly config: SessionServiceConfig,
    private readonly repository: SessionRepository = new InMemorySessionRepository(),
    private readonly metrics: Metrics = new NoopMetrics(),
  ) {
    for (const snapshot of this.repository.loadAll()) {
      this.sessions.set(snapshot.sessionId, {
        aggregate: SessionAggregate.rehydrate(snapshot.events),
        alias: snapshot.alias,
        coarseCell: snapshot.coarseCell,
        category: snapshot.category,
        userRef: snapshot.userRef,
        encryptedPii: snapshot.encryptedPii,
        encryptedLocations: [...snapshot.encryptedLocations],
        encryptedContactToken: snapshot.encryptedContactToken,
        contactRefs: snapshot.contactRefs ?? [],
        duressMask: snapshot.duressMask ?? null,
        watchDeadlineIso: snapshot.watchDeadlineIso ?? null,
        offeredResponderIds: new Set(snapshot.offeredResponderIds),
        acceptedResponderId: snapshot.acceptedResponderId,
        arrivalCode: snapshot.arrivalCode,
        arrivalAttempts: snapshot.arrivalAttempts,
        seekerTokenHash: snapshot.seekerTokenHash,
        contactTokenHash: snapshot.contactTokenHash,
        pinSafeHash: snapshot.pinSafeHash,
        pinDuressHash: snapshot.pinDuressHash,
      });
    }
  }

  /* ------------------------- authorization ------------------------- */

  authorizeSeeker(sessionId: string, token: string | null): void {
    const record = this.mustGet(sessionId);
    if (!matchesHash(token, record.seekerTokenHash)) {
      throw new NotAuthenticatedError();
    }
  }

  authorizeContact(sessionId: string, token: string | null): void {
    const record = this.mustGet(sessionId);
    if (!matchesHash(token, record.contactTokenHash)) {
      throw new NotAuthenticatedError();
    }
  }

  authorizeSeekerOrContact(
    sessionId: string,
    seekerToken: string | null,
    contactToken: string | null,
  ): void {
    const record = this.mustGet(sessionId);
    if (
      !matchesHash(seekerToken, record.seekerTokenHash) &&
      !matchesHash(contactToken, record.contactTokenHash)
    ) {
      throw new NotAuthenticatedError();
    }
  }

  /* --------------------------- lifecycle --------------------------- */

  /**
   * Shared session builder for both genesis paths (SOS and journey watch).
   * Returns the stored record plus the one-time seeker token; the caller
   * sets the genesis aggregate and any watch deadline.
   */
  private createSession(
    input: TriggerInput,
    aggregate: SessionAggregate,
    watchDeadlineIso: string | null,
  ): { record: StoredSession; seekerToken: string } {
    const userRef = sha256(input.userId);
    // One live session per user — but duress-masked sessions don't count:
    // refusing a new trigger after a "successful" cancel/check-in would
    // expose the mask to a coercer (invariant 4).
    for (const existing of this.sessions.values()) {
      if (
        existing.userRef === userRef &&
        existing.duressMask === null &&
        LIVE_STATES.includes(existing.aggregate.state)
      ) {
        throw new ActiveSessionExistsError();
      }
    }

    const sessionId = aggregate.sessionId;
    const at = aggregate.events[0].at;
    const seekerToken = randomBytes(24).toString('hex');
    const contactToken = randomBytes(24).toString('hex');
    const fallbackPins = input.pins ?? this.config.pins;
    const pinSafeHash = input.pinHashes?.safe ?? sha256(fallbackPins.safe);
    const pinDuressHash = input.pinHashes?.duress ?? sha256(fallbackPins.duress);
    const placeNote = input.placeNote?.trim();
    const pii: SessionPii = {
      userId: input.userId,
      displayName: input.displayName,
      contacts: [...input.contacts],
      ...(placeNote ? { placeNote } : {}),
    };
    const start = input.location ?? null;
    const initialLocation: PreciseLocation | null =
      start === null ? null : { sessionId, lat: start.lat, lng: start.lng, capturedAt: at };

    const record: StoredSession = {
      aggregate,
      alias: `helpseeker-${sha256(sessionId).slice(0, 8)}`,
      coarseCell: start === null ? null : cellId(toCell(start.lat, start.lng)),
      category: input.category,
      userRef,
      encryptedPii: this.crypto.encrypt(sessionId, JSON.stringify(pii)),
      encryptedLocations:
        initialLocation === null
          ? []
          : [this.crypto.encrypt(sessionId, JSON.stringify(initialLocation))],
      encryptedContactToken: this.crypto.encrypt(sessionId, contactToken),
      contactRefs: input.contacts.map((c) => contactRefOf(c.address)),
      duressMask: null,
      watchDeadlineIso,
      offeredResponderIds: new Set(),
      acceptedResponderId: null,
      arrivalCode: null,
      arrivalAttempts: 0,
      seekerTokenHash: sha256(seekerToken),
      contactTokenHash: sha256(contactToken),
      pinSafeHash,
      pinDuressHash,
    };
    this.sessions.set(sessionId, record);
    this.persist(record);
    return { record, seekerToken };
  }

  trigger(input: TriggerInput): TriggerReceipt {
    validateTrigger(input);
    const sessionId = randomUUID();
    const at = this.clock.now().toISOString();
    this.crypto.provisionSession(sessionId);
    // Identity and precise location never enter the durable event log: the
    // genesis event carries only category + consent version.
    const aggregate = SessionAggregate.trigger({
      sessionId,
      at,
      data: { category: input.category, consentVersion: CURRENT_CONSENT_VERSION },
    });
    const { seekerToken } = this.createSession(input, aggregate, null);
    this.metrics.increment('session.triggered');
    return {
      sessionId,
      state: 'PENDING',
      activationCountdownMs: this.config.activationCountdownMs,
      seekerToken,
    };
  }

  /**
   * Arms a journey watch (timed check-in). Creates a WATCHING session with
   * a deadline; nobody is alerted yet. If the user checks in safe before
   * the deadline it resolves quietly; if the deadline passes (or a duress
   * check-in is given) it escalates to a real ACTIVE emergency.
   */
  startWatch(input: TriggerInput, etaMs: number): WatchReceipt {
    validateTrigger(input);
    if (!Number.isFinite(etaMs) || etaMs < this.config.minWatchMs || etaMs > this.config.maxWatchMs) {
      throw new InvalidInputError('watch ETA is out of range');
    }
    const sessionId = randomUUID();
    const at = this.clock.now().toISOString();
    this.crypto.provisionSession(sessionId);
    const aggregate = SessionAggregate.watch({
      sessionId,
      at,
      data: { category: input.category, consentVersion: CURRENT_CONSENT_VERSION },
    });
    const watchDeadlineIso = new Date(Date.parse(at) + etaMs).toISOString();
    const { seekerToken } = this.createSession(input, aggregate, watchDeadlineIso);
    this.metrics.increment('watch.armed');
    return { sessionId, state: 'WATCHING', seekerToken, watchDeadline: watchDeadlineIso };
  }

  /**
   * Journey check-in. Mirrors the duress discipline of cancel: the safe PIN
   * ends the watch quietly (RESOLVED, nobody alerted); the duress PIN
   * returns the identical response while silently escalating to ACTIVE and
   * alerting the circle (invariant 4); a wrong PIN is rejected.
   */
  async checkInSafe(sessionId: string, pin: string): Promise<CheckInResponse> {
    const record = this.mustGet(sessionId);
    if (record.aggregate.state !== 'WATCHING') {
      throw new WatchActionNotAllowedError();
    }
    const at = this.clock.now().toISOString();
    if (matchesHash(pin, record.pinSafeHash)) {
      record.aggregate.apply('CHECKIN_SAFE', at, { reason: 'reached_safely' });
      record.watchDeadlineIso = null;
      this.persist(record);
      this.metrics.increment('watch.checkin_safe');
      return { status: 'safe', sessionId };
    }
    if (matchesHash(pin, record.pinDuressHash)) {
      record.aggregate.apply('WATCH_ESCALATED', at, { reason: 'duress' });
      record.duressMask = { atIso: at, benign: 'RESOLVED' };
      record.watchDeadlineIso = null;
      this.persist(record);
      this.metrics.increment('watch.escalated');
      await this.notifyContacts(record, { duress: true, escalation: false, watchExpired: false });
      return { status: 'safe', sessionId };
    }
    throw new InvalidPinError();
  }

  /** Pushes a journey watch deadline further out. WATCHING only. */
  extendWatch(sessionId: string, addMs: number): ClientStatus {
    const record = this.mustGet(sessionId);
    if (record.aggregate.state !== 'WATCHING') {
      throw new WatchActionNotAllowedError();
    }
    if (!Number.isFinite(addMs) || addMs <= 0 || addMs > this.config.maxWatchMs) {
      throw new InvalidInputError('watch extension is out of range');
    }
    const base = record.watchDeadlineIso ?? this.clock.now().toISOString();
    record.watchDeadlineIso = new Date(Date.parse(base) + addMs).toISOString();
    record.aggregate.apply('WATCH_EXTENDED', this.clock.now().toISOString(), { addMs });
    this.persist(record);
    return this.clientStatus(sessionId);
  }

  /** Explicit user confirmation: skip the countdown and activate now. */
  async confirm(sessionId: string): Promise<ClientStatus> {
    const record = this.mustGet(sessionId);
    record.aggregate.apply('ACTIVATED', this.clock.now().toISOString(), {
      reason: 'confirmed',
    });
    this.persist(record);
    this.metrics.increment('session.activated');
    await this.notifyContacts(record, { duress: false, escalation: false, watchExpired: false });
    return this.clientStatus(sessionId);
  }

  /**
   * Cancel with PIN. The state gate runs before the PIN is examined, so
   * every PIN gets the identical error outside PENDING. A duress PIN
   * returns a response byte-identical in shape to a real cancel while the
   * session silently activates (invariants 3 and 4).
   */
  async cancel(sessionId: string, pin: string): Promise<CancelResponse> {
    const record = this.mustGet(sessionId);
    if (record.aggregate.state !== 'PENDING') {
      throw new CancelNotAllowedError();
    }
    const at = this.clock.now().toISOString();
    if (matchesHash(pin, record.pinSafeHash)) {
      record.aggregate.apply('CANCEL_CONFIRMED', at, { reason: 'user_cancelled' });
      this.persist(record);
      this.metrics.increment('session.cancelled');
      return { status: 'cancelled', sessionId };
    }
    if (matchesHash(pin, record.pinDuressHash)) {
      record.aggregate.apply('ACTIVATED', at, { reason: 'duress' });
      record.duressMask = { atIso: at, benign: 'CANCELLED' };
      this.persist(record);
      this.metrics.increment('session.activated');
      await this.notifyContacts(record, { duress: true, escalation: false, watchExpired: false });
      return { status: 'cancelled', sessionId };
    }
    throw new InvalidPinError();
  }

  /**
   * What the helpseeker's device is told. For duress-masked sessions this
   * simulates the timeline the faked benign outcome would have shown
   * (CANCELLED or RESOLVED → CLOSED → PURGED on the same schedule), so the
   * view stays indistinguishable at any later time (invariant 4).
   */
  clientStatus(sessionId: string): ClientStatus {
    const record = this.mustGet(sessionId);
    if (record.duressMask !== null) {
      return {
        sessionId,
        state: this.simulatedMaskedState(record.duressMask, this.clock.now()),
      };
    }
    const status: ClientStatus = { sessionId, state: record.aggregate.state };
    if (record.aggregate.state === 'WATCHING' && record.watchDeadlineIso !== null) {
      status.watchDeadline = record.watchDeadlineIso;
    }
    return status;
  }

  private simulatedMaskedState(mask: DuressMask, now: Date): SessionState {
    const elapsed = now.getTime() - Date.parse(mask.atIso);
    const closeMs =
      mask.benign === 'CANCELLED' ? this.config.closeAfterCancelMs : this.config.closeAfterResolveMs;
    if (elapsed >= closeMs + this.config.purgeAfterCloseMs) {
      return 'PURGED';
    }
    if (elapsed >= closeMs) {
      return 'CLOSED';
    }
    return mask.benign;
  }

  /** Server-side view for audit/ops. Never exposed to client devices. */
  opsView(sessionId: string): { state: SessionState; events: readonly SessionEvent[] } {
    const record = this.mustGet(sessionId);
    return { state: record.aggregate.state, events: record.aggregate.events };
  }

  /**
   * Most recent session for a user (by genesis time), masked or not.
   * Channel gateways use this to route STATUS/CANCEL/SAFE commands; the
   * caller still goes through clientStatus, so the duress mask holds.
   */
  latestSessionIdForUser(userId: string): string | null {
    const userRef = sha256(userId);
    let latest: { id: string; at: number } | null = null;
    for (const record of this.sessions.values()) {
      if (record.userRef !== userRef) {
        continue;
      }
      const at = Date.parse(record.aggregate.events[0].at);
      if (latest === null || at > latest.at) {
        latest = { id: record.aggregate.sessionId, at };
      }
    }
    return latest?.id ?? null;
  }

  /** Sessions a contact (by hashed address) can currently dispatch for. */
  dispatchableSessionIdsForContact(contactAddress: string): string[] {
    const ref = contactRefOf(contactAddress);
    const out: string[] = [];
    for (const record of this.sessions.values()) {
      if (record.contactRefs.includes(ref) && record.aggregate.state === 'ACTIVE') {
        out.push(record.aggregate.sessionId);
      }
    }
    return out;
  }

  /** Live view for the helpseeker's trusted contacts (real state). */
  contactView(sessionId: string): ContactView {
    const record = this.mustGet(sessionId);
    const state = record.aggregate.state;
    let location: PreciseLocation | null = null;
    let locationAgeMs: number | null = null;
    let displayName = '';
    let placeNote: string | null = null;
    if (!this.crypto.isShredded(sessionId) && record.encryptedPii !== null) {
      const pii = JSON.parse(this.crypto.decrypt(record.encryptedPii)) as SessionPii;
      displayName = pii.displayName;
      if (CONTACT_VISIBLE_STATES.includes(state)) {
        placeNote = pii.placeNote ?? null;
      }
      // A WATCHING session is pre-alert: contacts are not involved yet, so
      // no location is exposed until it escalates to a real emergency.
      if (CONTACT_VISIBLE_STATES.includes(state) && record.encryptedLocations.length > 0) {
        const latest = record.encryptedLocations[record.encryptedLocations.length - 1];
        location = JSON.parse(this.crypto.decrypt(latest)) as PreciseLocation;
        locationAgeMs = Math.max(0, this.clock.now().getTime() - Date.parse(location.capturedAt));
      }
    }
    return {
      sessionId,
      state,
      duress: record.duressMask !== null,
      category: record.category,
      helpseekerDisplayName: displayName,
      location,
      locationAgeMs,
      placeNote,
    };
  }

  /**
   * Live view for a responder who received an offer. Real state (the
   * duress mask is only for the coerced device), but identity-free:
   * alias and coarse cell, with precise location only post-acceptance.
   */
  responderView(sessionId: string, responderId: string): ResponderView {
    const record = this.mustGet(sessionId);
    // Offers only go out once a cell is known, so a null cell means this
    // responder was never offered the session.
    if (!record.offeredResponderIds.has(responderId) || record.coarseCell === null) {
      throw new ResponderNotAuthorizedError();
    }
    const state = record.aggregate.state;
    let location: PreciseLocation | null = null;
    if (
      state === 'DISPATCHED' &&
      record.acceptedResponderId === responderId &&
      record.encryptedLocations.length > 0
    ) {
      const latest = record.encryptedLocations[record.encryptedLocations.length - 1];
      location = JSON.parse(this.crypto.decrypt(latest)) as PreciseLocation;
    }
    return {
      sessionId,
      state,
      alias: record.alias,
      category: record.category,
      coarseCell: record.coarseCell,
      location,
    };
  }

  recordLocation(sessionId: string, lat: number, lng: number): void {
    const record = this.mustGet(sessionId);
    const state = record.aggregate.state;
    if (!LOCATION_STATES.includes(state)) {
      throw new LocationRejectedError(state);
    }
    const ping: PreciseLocation = {
      sessionId,
      lat,
      lng,
      capturedAt: this.clock.now().toISOString(),
    };
    record.encryptedLocations.push(this.crypto.encrypt(sessionId, JSON.stringify(ping)));
    // A session started without a location becomes matchable on its first fix.
    if (record.coarseCell === null) {
      record.coarseCell = cellId(toCell(lat, lng));
    }
    this.persist(record);
  }

  /**
   * Runs deterministic matching and sends identity-free offers to the top
   * candidates. Returns the candidates with their explanations.
   */
  async dispatch(sessionId: string, roster: readonly ResponderProfile[]): Promise<MatchCandidate[]> {
    const record = this.mustGet(sessionId);
    if (record.aggregate.state !== 'ACTIVE') {
      throw new IllegalTransitionError(record.aggregate.state, 'RESPONDER_ACCEPTED');
    }
    const cell = record.coarseCell;
    if (cell === null) {
      throw new LocationUnknownError();
    }
    const candidates = this.matching.match(cell, roster, this.config.maxResponderOffers);
    const sentAt = this.clock.now().toISOString();
    for (const candidate of candidates) {
      record.offeredResponderIds.add(candidate.responderId);
      await this.notifier.sendResponderOffer({
        kind: 'responder_offer',
        sessionId,
        to: candidate.responderId,
        alias: record.alias,
        coarseCell: cell,
        category: record.category,
        sentAt,
      });
    }
    this.persist(record);
    this.metrics.increment('session.dispatched');
    return candidates;
  }

  accept(sessionId: string, responderId: string): ClientStatus {
    const record = this.mustGet(sessionId);
    if (!record.offeredResponderIds.has(responderId)) {
      throw new ResponderNotAuthorizedError();
    }
    record.aggregate.apply('RESPONDER_ACCEPTED', this.clock.now().toISOString(), {
      responderId,
    });
    record.acceptedResponderId = responderId;
    record.arrivalCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
    record.arrivalAttempts = 0;
    this.persist(record);
    return { sessionId, state: record.aggregate.state };
  }

  /**
   * Voluntary withdrawal by the accepted responder. The session returns
   * to ACTIVE for re-dispatch; the withdrawn responder loses the offer
   * and cannot re-accept.
   */
  withdraw(sessionId: string, responderId: string): ClientStatus {
    const record = this.mustGet(sessionId);
    if (record.aggregate.state !== 'DISPATCHED' || record.acceptedResponderId !== responderId) {
      throw new ResponderNotAuthorizedError();
    }
    this.applyWithdrawal(record, responderId, 'responder_withdrew');
    return { sessionId, state: record.aggregate.state };
  }

  private applyWithdrawal(record: StoredSession, responderId: string, reason: string): void {
    record.aggregate.apply('RESPONDER_WITHDREW', this.clock.now().toISOString(), {
      responderId,
      reason,
    });
    record.offeredResponderIds.delete(responderId);
    record.acceptedResponderId = null;
    record.arrivalCode = null;
    record.arrivalAttempts = 0;
    this.persist(record);
  }

  /** Shown on the helpseeker's screen; the responder reads it in person. */
  getArrivalCode(sessionId: string): string {
    const record = this.mustGet(sessionId);
    if (record.arrivalCode === null) {
      throw new ResponderNotAuthorizedError();
    }
    return record.arrivalCode;
  }

  /**
   * Precise location release: only the accepted responder, only while
   * DISPATCHED, fetched through this authenticated call — never pushed in
   * a notification payload.
   */
  getDispatchLocation(sessionId: string, responderId: string): PreciseLocation {
    const record = this.mustGet(sessionId);
    if (record.aggregate.state !== 'DISPATCHED' || record.acceptedResponderId !== responderId) {
      throw new ResponderNotAuthorizedError();
    }
    const latest = record.encryptedLocations[record.encryptedLocations.length - 1];
    return JSON.parse(this.crypto.decrypt(latest)) as PreciseLocation;
  }

  verifyArrival(sessionId: string, responderId: string, code: string): ClientStatus {
    const record = this.mustGet(sessionId);
    if (record.aggregate.state !== 'DISPATCHED' || record.acceptedResponderId !== responderId) {
      throw new ResponderNotAuthorizedError();
    }
    if (record.arrivalAttempts >= this.config.maxArrivalAttempts) {
      throw new ArrivalCodeLockedError();
    }
    if (record.arrivalCode !== code) {
      record.arrivalAttempts += 1;
      this.persist(record);
      throw new InvalidArrivalCodeError();
    }
    record.aggregate.apply('RESPONDER_ARRIVED', this.clock.now().toISOString(), { responderId });
    this.persist(record);
    return { sessionId, state: record.aggregate.state };
  }

  /**
   * "I'm safe" on a live emergency, with PIN. Same discipline as cancel and
   * check-in (invariant 4): the safe PIN resolves; the duress PIN returns
   * the identical response and shows a benign RESOLVED timeline on the
   * device, while the session stays live and the circle gets a duress
   * alert (a coerced "all clear"); a wrong PIN is rejected. The state gate
   * runs first, so outside a live emergency every PIN gets the same error.
   */
  async resolve(sessionId: string, pin: string): Promise<ClientStatus> {
    const record = this.mustGet(sessionId);
    const state = record.aggregate.state;
    if (!RESOLVABLE_STATES.includes(state)) {
      throw new IllegalTransitionError(state, 'SESSION_RESOLVED');
    }
    const at = this.clock.now().toISOString();
    if (matchesHash(pin, record.pinSafeHash)) {
      record.aggregate.apply('SESSION_RESOLVED', at, { reason: 'helpseeker_confirmed_safe' });
      this.persist(record);
      this.metrics.increment('session.resolved');
      return { sessionId, state: record.aggregate.state };
    }
    if (matchesHash(pin, record.pinDuressHash)) {
      // Recorded as a re-alert of the circle (self-loop): the real state,
      // and any helper on the way, are untouched.
      record.aggregate.apply('ESCALATION_RAISED', at, { reason: 'duress_resolve' });
      // A device already showing a benign timeline keeps it unchanged.
      record.duressMask ??= { atIso: at, benign: 'RESOLVED' };
      this.persist(record);
      // The public counters move exactly as for a real resolve.
      this.metrics.increment('session.resolved');
      await this.notifyContacts(record, { duress: true, escalation: false, watchExpired: false });
      return { sessionId, state: 'RESOLVED' };
    }
    throw new InvalidPinError();
  }

  /**
   * The single timer sweep. All time-driven behavior lives here and is
   * driven by the `now` the caller passes in — production calls it on an
   * interval with the real clock, tests call it with a manual clock.
   */
  async evaluateTimers(now: Date): Promise<void> {
    const nowIso = now.toISOString();
    for (const record of this.sessions.values()) {
      // Re-alerts (ESCALATION_RAISED self-loops) do not restart the clocks
      // below: a duress "I'm safe" must not delay a no-show withdrawal.
      const sinceLastEvent = now.getTime() - Date.parse(lastLifecycleEvent(record.aggregate.events).at);
      switch (record.aggregate.state) {
        case 'WATCHING':
          // Deadline missed with no check-in → escalate to a real emergency
          // and alert the circle.
          if (record.watchDeadlineIso !== null && now.getTime() >= Date.parse(record.watchDeadlineIso)) {
            record.aggregate.apply('WATCH_ESCALATED', nowIso, { reason: 'watch_expired' });
            record.watchDeadlineIso = null;
            this.persist(record);
            this.metrics.increment('watch.escalated');
            await this.notifyContacts(record, {
              duress: false,
              escalation: false,
              watchExpired: true,
            });
          }
          break;
        case 'PENDING':
          if (sinceLastEvent >= this.config.activationCountdownMs) {
            record.aggregate.apply('ACTIVATED', nowIso, { reason: 'countdown_elapsed' });
            this.persist(record);
            this.metrics.increment('session.activated');
            await this.notifyContacts(record, {
              duress: false,
              escalation: false,
              watchExpired: false,
            });
          }
          break;
        case 'ACTIVE':
          if (
            sinceLastEvent >= this.config.escalationAfterMs &&
            !record.aggregate.events.some(
              (e) => e.type === 'ESCALATION_RAISED' && e.data.reason === 'no_responder_accepted',
            )
          ) {
            record.aggregate.apply('ESCALATION_RAISED', nowIso, {
              reason: 'no_responder_accepted',
            });
            this.persist(record);
            await this.notifyContacts(record, {
              duress: record.duressMask !== null,
              escalation: true,
              watchExpired: false,
            });
          }
          break;
        case 'DISPATCHED':
          if (
            sinceLastEvent >= this.config.responderArrivalTimeoutMs &&
            record.acceptedResponderId !== null
          ) {
            this.applyWithdrawal(record, record.acceptedResponderId, 'arrival_timeout');
          }
          break;
        case 'RESOLVED':
          if (sinceLastEvent >= this.config.closeAfterResolveMs) {
            record.aggregate.apply('SESSION_CLOSED', nowIso, { reason: 'auto_close_after_resolve' });
            this.persist(record);
          }
          break;
        case 'CANCELLED':
          if (sinceLastEvent >= this.config.closeAfterCancelMs) {
            record.aggregate.apply('SESSION_CLOSED', nowIso, { reason: 'auto_close_after_cancel' });
            this.persist(record);
          }
          break;
        case 'CLOSED':
          if (sinceLastEvent >= this.config.purgeAfterCloseMs) {
            this.purge(record, nowIso);
          }
          break;
        default:
          break;
      }
    }
  }

  /**
   * Purge = key destruction (invariant 7). The per-session key is shredded
   * first, making every blob unreadable, then the transition is recorded.
   */
  private purge(record: StoredSession, atIso: string): void {
    this.crypto.shred(record.aggregate.sessionId);
    record.aggregate.apply('DATA_PURGED', atIso, { method: 'crypto-shred' });
    record.encryptedPii = null;
    record.encryptedLocations.length = 0;
    record.encryptedContactToken = null;
    record.arrivalCode = null;
    this.persist(record);
    this.metrics.increment('session.purged');
  }

  private async notifyContacts(
    record: StoredSession,
    flags: { duress: boolean; escalation: boolean; watchExpired: boolean },
  ): Promise<void> {
    if (record.encryptedPii === null || record.encryptedContactToken === null) {
      return;
    }
    const pii = JSON.parse(this.crypto.decrypt(record.encryptedPii)) as SessionPii;
    const contactToken = this.crypto.decrypt(record.encryptedContactToken);
    const sessionId = record.aggregate.sessionId;
    const sentAt = this.clock.now().toISOString();
    for (const contact of pii.contacts) {
      await this.notifier.sendContactAlert({
        kind: 'contact_alert',
        sessionId,
        to: contact.address,
        helpseekerDisplayName: pii.displayName,
        category: record.category,
        liveSessionLink: `${this.config.publicBaseUrl}/lite/c/${sessionId}?t=${contactToken}`,
        duress: flags.duress,
        escalation: flags.escalation,
        watchExpired: flags.watchExpired,
        locationKnown: record.coarseCell !== null,
        placeNote: pii.placeNote ?? null,
        sentAt,
      });
    }
  }

  private persist(record: StoredSession): void {
    const snapshot: SessionSnapshot = {
      sessionId: record.aggregate.sessionId,
      alias: record.alias,
      coarseCell: record.coarseCell,
      category: record.category,
      userRef: record.userRef,
      encryptedPii: record.encryptedPii,
      encryptedLocations: [...record.encryptedLocations],
      encryptedContactToken: record.encryptedContactToken,
      contactRefs: [...record.contactRefs],
      duressMask: record.duressMask,
      watchDeadlineIso: record.watchDeadlineIso,
      offeredResponderIds: [...record.offeredResponderIds],
      acceptedResponderId: record.acceptedResponderId,
      arrivalCode: record.arrivalCode,
      arrivalAttempts: record.arrivalAttempts,
      seekerTokenHash: record.seekerTokenHash,
      contactTokenHash: record.contactTokenHash,
      pinSafeHash: record.pinSafeHash,
      pinDuressHash: record.pinDuressHash,
      events: [...record.aggregate.events],
    };
    this.repository.save(snapshot);
  }

  private mustGet(sessionId: string): StoredSession {
    const record = this.sessions.get(sessionId);
    if (record === undefined) {
      throw new SessionNotFoundError(sessionId);
    }
    return record;
  }
}
