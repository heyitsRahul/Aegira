import { createHash, randomInt, randomUUID } from 'node:crypto';
import { CURRENT_CONSENT_VERSION } from '../domain/consent';
import {
  CancelNotAllowedError,
  InvalidArrivalCodeError,
  InvalidPinError,
  LocationRejectedError,
  ResponderNotAuthorizedError,
  SessionNotFoundError,
} from '../domain/errors';
import { cellId, toCell } from '../domain/geo';
import { SessionAggregate } from '../domain/session';
import { IllegalTransitionError } from '../domain/state-machine';
import { Clock, PreciseLocation, SessionCategory, SessionEvent, SessionState } from '../domain/types';
import { EncryptedBlob, SessionCrypto } from '../crypto/shredder';
import { MatchCandidate, MatchingService, ResponderProfile } from './matching.service';
import { Notifier } from './notification.service';

export interface SessionServiceConfig {
  /** PENDING auto-activates after this long (the cancel window). */
  activationCountdownMs: number;
  closeAfterResolveMs: number;
  closeAfterCancelMs: number;
  purgeAfterCloseMs: number;
  maxResponderOffers: number;
  pins: { safe: string; duress: string };
}

export interface TriggerInput {
  userId: string;
  displayName: string;
  contacts: ReadonlyArray<{ id: string; address: string }>;
  location: { lat: number; lng: number };
  category: SessionCategory;
}

export interface TriggerReceipt {
  sessionId: string;
  state: SessionState;
  activationCountdownMs: number;
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
  encryptedPii: EncryptedBlob | null;
  encryptedLocations: EncryptedBlob[];
  /** Set when a duress PIN faked a cancel; drives the masked client view. */
  duressActivatedAtIso: string | null;
  offeredResponderIds: Set<string>;
  acceptedResponderId: string | null;
  arrivalCode: string | null;
}

/**
 * Orchestrates the session lifecycle. Owns no wall clock: time comes from
 * the injected Clock for event stamping, and ALL timer behavior runs
 * through the explicit evaluateTimers(now) sweep so it is fully testable
 * with a manual clock. Every state change goes through the aggregate's
 * state machine.
 */
export class SessionService {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(
    private readonly clock: Clock,
    private readonly crypto: SessionCrypto,
    private readonly notifier: Notifier,
    private readonly matching: MatchingService,
    private readonly config: SessionServiceConfig,
  ) {}

  trigger(input: TriggerInput): TriggerReceipt {
    const sessionId = randomUUID();
    const at = this.clock.now().toISOString();
    this.crypto.provisionSession(sessionId);

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
      alias: `helpseeker-${createHash('sha256').update(sessionId).digest('hex').slice(0, 8)}`,
      coarseCell: cellId(toCell(input.location.lat, input.location.lng)),
      category: input.category,
      encryptedPii: this.crypto.encrypt(sessionId, JSON.stringify(pii)),
      encryptedLocations: [this.crypto.encrypt(sessionId, JSON.stringify(initialLocation))],
      duressActivatedAtIso: null,
      offeredResponderIds: new Set(),
      acceptedResponderId: null,
      arrivalCode: null,
    };
    this.sessions.set(sessionId, record);

    return {
      sessionId,
      state: record.aggregate.state,
      activationCountdownMs: this.config.activationCountdownMs,
    };
  }

  /** Explicit user confirmation: skip the countdown and activate now. */
  async confirm(sessionId: string): Promise<ClientStatus> {
    const record = this.mustGet(sessionId);
    record.aggregate.apply('ACTIVATED', this.clock.now().toISOString(), {
      reason: 'confirmed',
    });
    await this.notifyContacts(record, false);
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
    if (pin === this.config.pins.safe) {
      record.aggregate.apply('CANCEL_CONFIRMED', at, { reason: 'user_cancelled' });
      return { status: 'cancelled', sessionId };
    }
    if (pin === this.config.pins.duress) {
      record.aggregate.apply('ACTIVATED', at, { reason: 'duress' });
      record.duressActivatedAtIso = at;
      await this.notifyContacts(record, true);
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

  /** Live view for the helpseeker's trusted contacts (real state). */
  contactView(sessionId: string): ContactView {
    const record = this.mustGet(sessionId);
    const state = record.aggregate.state;
    const live =
      state === 'PENDING' || state === 'ACTIVE' || state === 'DISPATCHED' || state === 'ARRIVED';
    let location: PreciseLocation | null = null;
    let displayName = '';
    if (!this.crypto.isShredded(sessionId) && record.encryptedPii !== null) {
      const pii = JSON.parse(this.crypto.decrypt(record.encryptedPii)) as SessionPii;
      displayName = pii.displayName;
      if (live && record.encryptedLocations.length > 0) {
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
    if (state !== 'PENDING' && state !== 'ACTIVE' && state !== 'DISPATCHED' && state !== 'ARRIVED') {
      throw new LocationRejectedError(state);
    }
    const ping: PreciseLocation = {
      sessionId,
      lat,
      lng,
      capturedAt: this.clock.now().toISOString(),
    };
    record.encryptedLocations.push(this.crypto.encrypt(sessionId, JSON.stringify(ping)));
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
    return { sessionId, state: record.aggregate.state };
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
    if (record.arrivalCode !== code) {
      throw new InvalidArrivalCodeError();
    }
    record.aggregate.apply('RESPONDER_ARRIVED', this.clock.now().toISOString(), { responderId });
    return { sessionId, state: record.aggregate.state };
  }

  resolve(sessionId: string): ClientStatus {
    const record = this.mustGet(sessionId);
    record.aggregate.apply('SESSION_RESOLVED', this.clock.now().toISOString(), {
      reason: 'helpseeker_confirmed_safe',
    });
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
            await this.notifyContacts(record, false);
          }
          break;
        case 'RESOLVED':
          if (sinceLastEvent >= this.config.closeAfterResolveMs) {
            record.aggregate.apply('SESSION_CLOSED', nowIso, { reason: 'auto_close_after_resolve' });
          }
          break;
        case 'CANCELLED':
          if (sinceLastEvent >= this.config.closeAfterCancelMs) {
            record.aggregate.apply('SESSION_CLOSED', nowIso, { reason: 'auto_close_after_cancel' });
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
    record.arrivalCode = null;
  }

  private async notifyContacts(record: StoredSession, duress: boolean): Promise<void> {
    if (record.encryptedPii === null) {
      return;
    }
    const pii = JSON.parse(this.crypto.decrypt(record.encryptedPii)) as SessionPii;
    const sessionId = record.aggregate.sessionId;
    const sentAt = this.clock.now().toISOString();
    for (const contact of pii.contacts) {
      await this.notifier.sendContactAlert({
        kind: 'contact_alert',
        sessionId,
        to: contact.address,
        helpseekerDisplayName: pii.displayName,
        category: record.category,
        liveSessionLink: `https://app.sahay.example/live/${sessionId}`,
        duress,
        sentAt,
      });
    }
  }

  private mustGet(sessionId: string): StoredSession {
    const record = this.sessions.get(sessionId);
    if (record === undefined) {
      throw new SessionNotFoundError(sessionId);
    }
    return record;
  }
}
