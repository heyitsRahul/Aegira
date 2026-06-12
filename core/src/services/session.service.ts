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
  NotAuthenticatedError,
  ResponderNotAuthorizedError,
  SessionNotFoundError,
} from '../domain/errors';
import { cellId, toCell } from '../domain/geo';
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
  location: { lat: number; lng: number };
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

export interface ClientStatus {
  sessionId: string;
  state: SessionState;
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
}

interface StoredSession {
  aggregate: SessionAggregate;
  alias: string;
  coarseCell: string;
  category: SessionCategory;
  userRef: string;
  encryptedPii: EncryptedBlob | null;
  encryptedLocations: EncryptedBlob[];
  encryptedContactToken: EncryptedBlob | null;
  /** sha256 of each contact address — reply-routing index, not identity. */
  contactRefs: string[];
  /** Set when a duress PIN faked a cancel; drives the masked client view. */
  duressActivatedAtIso: string | null;
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

/** Constant-time comparison of a presented secret against a stored hash. */
function matchesHash(presented: string | null | undefined, storedHash: string): boolean {
  if (typeof presented !== 'string' || presented.length === 0) {
    return false;
  }
  return timingSafeEqual(Buffer.from(sha256(presented), 'hex'), Buffer.from(storedHash, 'hex'));
}

const LIVE_STATES: readonly SessionState[] = ['PENDING', 'ACTIVE', 'DISPATCHED', 'ARRIVED'];
const VALID_CATEGORIES: readonly SessionCategory[] = [
  'personal_safety',
  'medical',
  'accident',
  'other',
];

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
  const { lat, lng } = input.location ?? {};
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new InvalidInputError('location.lat must be a number in [-90, 90]');
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new InvalidInputError('location.lng must be a number in [-180, 180]');
  }
  if (!VALID_CATEGORIES.includes(input.category)) {
    throw new InvalidInputError('unknown category');
  }
  if (input.pins !== undefined && input.pinHashes !== undefined) {
    throw new InvalidInputError('provide pins or pinHashes, not both');
  }
  if (input.pins !== undefined) {
    const pinShape = /^\d{4,6}$/;
    if (!pinShape.test(input.pins.safe) || !pinShape.test(input.pins.duress)) {
      throw new InvalidInputError('pins must be 4-6 digits');
    }
    if (input.pins.safe === input.pins.duress) {
      throw new InvalidInputError('safe and duress pins must differ');
    }
  }
  if (input.pinHashes !== undefined) {
    const hashShape = /^[0-9a-f]{64}$/;
    if (!hashShape.test(input.pinHashes.safe) || !hashShape.test(input.pinHashes.duress)) {
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
        duressActivatedAtIso: snapshot.duressActivatedAtIso,
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

  trigger(input: TriggerInput): TriggerReceipt {
    validateTrigger(input);
    const userRef = sha256(input.userId);
    // One live session per user — but duress-masked sessions don't count:
    // refusing a new trigger after a "successful" cancel would expose the
    // mask to a coercer (invariant 4).
    for (const existing of this.sessions.values()) {
      if (
        existing.userRef === userRef &&
        existing.duressActivatedAtIso === null &&
        LIVE_STATES.includes(existing.aggregate.state)
      ) {
        throw new ActiveSessionExistsError();
      }
    }

    const sessionId = randomUUID();
    const at = this.clock.now().toISOString();
    this.crypto.provisionSession(sessionId);

    const seekerToken = randomBytes(24).toString('hex');
    const contactToken = randomBytes(24).toString('hex');
    const fallbackPins = input.pins ?? this.config.pins;
    const pinSafeHash = input.pinHashes?.safe ?? sha256(fallbackPins.safe);
    const pinDuressHash = input.pinHashes?.duress ?? sha256(fallbackPins.duress);
    const pii: SessionPii = {
      userId: input.userId,
      displayName: input.displayName,
      contacts: [...input.contacts],
    };
    const initialLocation: PreciseLocation = {
      sessionId,
      lat: input.location.lat,
      lng: input.location.lng,
      capturedAt: at,
    };

    const record: StoredSession = {
      // Identity and precise location never enter the durable event log:
      // the genesis event carries only category + consent version.
      aggregate: SessionAggregate.trigger({
        sessionId,
        at,
        data: { category: input.category, consentVersion: CURRENT_CONSENT_VERSION },
      }),
      alias: `helpseeker-${sha256(sessionId).slice(0, 8)}`,
      coarseCell: cellId(toCell(input.location.lat, input.location.lng)),
      category: input.category,
      userRef,
      encryptedPii: this.crypto.encrypt(sessionId, JSON.stringify(pii)),
      encryptedLocations: [this.crypto.encrypt(sessionId, JSON.stringify(initialLocation))],
      encryptedContactToken: this.crypto.encrypt(sessionId, contactToken),
      contactRefs: input.contacts.map((c) => sha256(c.address)),
      duressActivatedAtIso: null,
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

    return {
      sessionId,
      state: record.aggregate.state,
      activationCountdownMs: this.config.activationCountdownMs,
      seekerToken,
    };
  }

  /** Explicit user confirmation: skip the countdown and activate now. */
  async confirm(sessionId: string): Promise<ClientStatus> {
    const record = this.mustGet(sessionId);
    record.aggregate.apply('ACTIVATED', this.clock.now().toISOString(), {
      reason: 'confirmed',
    });
    this.persist(record);
    await this.notifyContacts(record, { duress: false, escalation: false });
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
      return { status: 'cancelled', sessionId };
    }
    if (matchesHash(pin, record.pinDuressHash)) {
      record.aggregate.apply('ACTIVATED', at, { reason: 'duress' });
      record.duressActivatedAtIso = at;
      this.persist(record);
      await this.notifyContacts(record, { duress: true, escalation: false });
      return { status: 'cancelled', sessionId };
    }
    throw new InvalidPinError();
  }

  /**
   * What the helpseeker's device is told. For duress-masked sessions this
   * simulates the timeline a genuinely cancelled session would have shown
   * (CANCELLED → CLOSED → PURGED on the same schedule), so the view stays
   * indistinguishable at any later time.
   */
  clientStatus(sessionId: string): ClientStatus {
    const record = this.mustGet(sessionId);
    if (record.duressActivatedAtIso !== null) {
      return {
        sessionId,
        state: this.simulatedCancelledState(record.duressActivatedAtIso, this.clock.now()),
      };
    }
    return { sessionId, state: record.aggregate.state };
  }

  private simulatedCancelledState(cancelledAtIso: string, now: Date): SessionState {
    const elapsed = now.getTime() - Date.parse(cancelledAtIso);
    if (elapsed >= this.config.closeAfterCancelMs + this.config.purgeAfterCloseMs) {
      return 'PURGED';
    }
    if (elapsed >= this.config.closeAfterCancelMs) {
      return 'CLOSED';
    }
    return 'CANCELLED';
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
    const ref = sha256(contactAddress);
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
    let displayName = '';
    if (!this.crypto.isShredded(sessionId) && record.encryptedPii !== null) {
      const pii = JSON.parse(this.crypto.decrypt(record.encryptedPii)) as SessionPii;
      displayName = pii.displayName;
      if (LIVE_STATES.includes(state) && record.encryptedLocations.length > 0) {
        const latest = record.encryptedLocations[record.encryptedLocations.length - 1];
        location = JSON.parse(this.crypto.decrypt(latest)) as PreciseLocation;
      }
    }
    return {
      sessionId,
      state,
      duress: record.duressActivatedAtIso !== null,
      category: record.category,
      helpseekerDisplayName: displayName,
      location,
    };
  }

  /**
   * Live view for a responder who received an offer. Real state (the
   * duress mask is only for the coerced device), but identity-free:
   * alias and coarse cell, with precise location only post-acceptance.
   */
  responderView(sessionId: string, responderId: string): ResponderView {
    const record = this.mustGet(sessionId);
    if (!record.offeredResponderIds.has(responderId)) {
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
    if (!LIVE_STATES.includes(state)) {
      throw new LocationRejectedError(state);
    }
    const ping: PreciseLocation = {
      sessionId,
      lat,
      lng,
      capturedAt: this.clock.now().toISOString(),
    };
    record.encryptedLocations.push(this.crypto.encrypt(sessionId, JSON.stringify(ping)));
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
    const candidates = this.matching.match(
      record.coarseCell,
      roster,
      this.config.maxResponderOffers,
    );
    const sentAt = this.clock.now().toISOString();
    for (const candidate of candidates) {
      record.offeredResponderIds.add(candidate.responderId);
      await this.notifier.sendResponderOffer({
        kind: 'responder_offer',
        sessionId,
        to: candidate.responderId,
        alias: record.alias,
        coarseCell: record.coarseCell,
        category: record.category,
        sentAt,
      });
    }
    this.persist(record);
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

  resolve(sessionId: string): ClientStatus {
    const record = this.mustGet(sessionId);
    record.aggregate.apply('SESSION_RESOLVED', this.clock.now().toISOString(), {
      reason: 'helpseeker_confirmed_safe',
    });
    this.persist(record);
    return { sessionId, state: record.aggregate.state };
  }

  /**
   * The single timer sweep. All time-driven behavior lives here and is
   * driven by the `now` the caller passes in — production calls it on an
   * interval with the real clock, tests call it with a manual clock.
   */
  async evaluateTimers(now: Date): Promise<void> {
    const nowIso = now.toISOString();
    for (const record of this.sessions.values()) {
      const sinceLastEvent = now.getTime() - Date.parse(record.aggregate.lastEvent.at);
      switch (record.aggregate.state) {
        case 'PENDING':
          if (sinceLastEvent >= this.config.activationCountdownMs) {
            record.aggregate.apply('ACTIVATED', nowIso, { reason: 'countdown_elapsed' });
            this.persist(record);
            await this.notifyContacts(record, { duress: false, escalation: false });
          }
          break;
        case 'ACTIVE':
          if (
            sinceLastEvent >= this.config.escalationAfterMs &&
            !record.aggregate.events.some((e) => e.type === 'ESCALATION_RAISED')
          ) {
            record.aggregate.apply('ESCALATION_RAISED', nowIso, {
              reason: 'no_responder_accepted',
            });
            this.persist(record);
            await this.notifyContacts(record, {
              duress: record.duressActivatedAtIso !== null,
              escalation: true,
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
  }

  private async notifyContacts(
    record: StoredSession,
    flags: { duress: boolean; escalation: boolean },
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
      duressActivatedAtIso: record.duressActivatedAtIso,
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
