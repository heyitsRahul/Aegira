import { EncryptedBlob } from '../crypto/shredder';
import { SessionCategory, SessionEvent } from '../domain/types';

/**
 * Persistence port for session state. The snapshot carries the full
 * hash-chained event log; SessionAggregate.rehydrate() verifies the chain
 * on load, so a tampered store refuses to come back up. Sensitive payloads
 * (PII, locations, the contact link token) are stored only as
 * session-key-encrypted blobs — the repository never sees plaintext.
 */
export interface SessionSnapshot {
  sessionId: string;
  alias: string;
  coarseCell: string;
  category: SessionCategory;
  /** sha256 of the user id — concurrency index only, not identity. */
  userRef: string;
  encryptedPii: EncryptedBlob | null;
  encryptedLocations: EncryptedBlob[];
  encryptedContactToken: EncryptedBlob | null;
  /** sha256 of each contact address — reply-routing index, not identity. */
  contactRefs: string[];
  /** Faked-benign mask for a duress cancel/check-in; null otherwise. */
  duressMask: { atIso: string; benign: 'CANCELLED' | 'RESOLVED' } | null;
  /** Journey-watch deadline (WATCHING), null for SOS sessions. */
  watchDeadlineIso: string | null;
  offeredResponderIds: string[];
  acceptedResponderId: string | null;
  arrivalCode: string | null;
  arrivalAttempts: number;
  seekerTokenHash: string;
  contactTokenHash: string;
  pinSafeHash: string;
  pinDuressHash: string;
  events: SessionEvent[];
}

export interface SessionRepository {
  save(snapshot: SessionSnapshot): void;
  loadAll(): SessionSnapshot[];
}

/** Default repository: process-lifetime only. Used by unit tests. */
export class InMemorySessionRepository implements SessionRepository {
  private readonly snapshots = new Map<string, SessionSnapshot>();

  save(snapshot: SessionSnapshot): void {
    this.snapshots.set(snapshot.sessionId, structuredClone(snapshot));
  }

  loadAll(): SessionSnapshot[] {
    return [...this.snapshots.values()].map((s) => structuredClone(s));
  }
}
