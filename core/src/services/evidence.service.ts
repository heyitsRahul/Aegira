import { AUDIO_CONSENT_VERSION } from '../domain/consent';
import { InvalidInputError, RecordingRejectedError } from '../domain/errors';
import { Clock, SessionState } from '../domain/types';
import { SessionCrypto } from '../crypto/shredder';
import { AudioPiece, AudioStore } from '../persistence/audio-store';
import { SessionService } from './session.service';

/**
 * Opt-in sound recording during an emergency (consent v8): evidence that
 * lives and dies with its session.
 *
 *  - Pieces arrive every few seconds from the helpseeker's device, so a
 *    snatched or smashed phone still leaves what was already sent.
 *  - Each piece is encrypted under the session key; purging the session
 *    (CLOSED -> PURGED, key destruction) makes it unreadable, and sweep()
 *    then removes the dead ciphertext (invariant 7).
 *  - The helpseeker's device is answered by the state it is shown, so under
 *    a duress mask uploads and listings behave exactly like the benign
 *    outcome being faked (invariant 4).
 *  - Trusted contacts can listen while the emergency is live. Responders
 *    have no route here at all: a voice identifies a person (invariant 6).
 */

export interface EvidenceLimits {
  /**
   * Decoded bytes per piece: several seconds of compressed speech, and small
   * enough that its base64 form fits the server's 100 kB request limit.
   */
  maxPieceBytes: number;
  maxPiecesPerSession: number;
  maxSegmentsPerSession: number;
}

export const DEFAULT_EVIDENCE_LIMITS: EvidenceLimits = {
  maxPieceBytes: 64 * 1024,
  // About two hours at one piece every 5 seconds.
  maxPiecesPerSession: 1440,
  maxSegmentsPerSession: 30,
};

export interface AudioUpload {
  segment: unknown;
  seq: unknown;
  mime: unknown;
  data: unknown;
  consent: unknown;
}

export interface ClipInfo {
  segment: string;
  startedAt: string;
  updatedAt: string;
  pieces: number;
}

export interface Clip {
  mime: string;
  bytes: Buffer;
}

/** The device can only be recording while it shows a live emergency. */
const RECORDING_STATES: readonly SessionState[] = ['PENDING', 'ACTIVE', 'DISPATCHED', 'ARRIVED'];
/** Same window in which contacts may see the live location. */
const CONTACT_LISTEN_STATES: readonly SessionState[] = ['PENDING', 'ACTIVE', 'DISPATCHED', 'ARRIVED'];
/** Formats MediaRecorder produces in current browsers; parameters stripped. */
const ALLOWED_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/mpeg'];
const SEGMENT_PATTERN = /^[a-z0-9]{6,32}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

interface PiecePayload {
  mime: string;
  data: string;
}

export class EvidenceService {
  constructor(
    private readonly clock: Clock,
    private readonly crypto: SessionCrypto,
    private readonly sessions: SessionService,
    private readonly store: AudioStore,
    private readonly limits: EvidenceLimits = DEFAULT_EVIDENCE_LIMITS,
  ) {}

  /** A piece from the helpseeker's device. Idempotent on (segment, seq). */
  append(sessionId: string, upload: AudioUpload): { stored: boolean } {
    const visible = this.sessions.clientStatus(sessionId).state;
    if (!RECORDING_STATES.includes(visible)) {
      throw new RecordingRejectedError(visible);
    }
    if (upload.consent !== AUDIO_CONSENT_VERSION) {
      throw new InvalidInputError(`sound recording needs consent ${AUDIO_CONSENT_VERSION}`);
    }
    const { segment, seq, data } = upload;
    if (typeof segment !== 'string' || !SEGMENT_PATTERN.test(segment)) {
      throw new InvalidInputError('segment must be 6-32 lowercase letters or digits');
    }
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq >= this.limits.maxPiecesPerSession) {
      throw new InvalidInputError('seq out of range');
    }
    const mime = typeof upload.mime === 'string' ? upload.mime.split(';')[0].trim().toLowerCase() : '';
    if (!ALLOWED_MIME.includes(mime)) {
      throw new InvalidInputError('unsupported sound format');
    }
    if (typeof data !== 'string' || data.length === 0 || !BASE64_PATTERN.test(data)) {
      throw new InvalidInputError('data must be base64');
    }
    if (Buffer.byteLength(data, 'base64') > this.limits.maxPieceBytes) {
      throw new InvalidInputError('piece too large');
    }
    const existing = this.store.list(sessionId);
    if (existing.some((p) => p.segment === segment && p.seq === seq)) {
      return { stored: false };
    }
    if (existing.length >= this.limits.maxPiecesPerSession) {
      throw new InvalidInputError('recording limit reached for this session');
    }
    const segments = new Set(existing.map((p) => p.segment));
    if (!segments.has(segment) && segments.size >= this.limits.maxSegmentsPerSession) {
      throw new InvalidInputError('too many recordings for this session');
    }
    const payload: PiecePayload = { mime, data };
    const stored = this.store.save({
      sessionId,
      segment,
      seq,
      recordedAt: this.clock.now().toISOString(),
      blob: this.crypto.encrypt(sessionId, JSON.stringify(payload)),
    });
    return { stored };
  }

  /**
   * The helpseeker's own recordings, judged by the state the device is
   * shown: gone once that state is PURGED, real or simulated.
   */
  listForSeeker(sessionId: string): ClipInfo[] {
    if (this.sessions.clientStatus(sessionId).state === 'PURGED') {
      return [];
    }
    return this.describe(sessionId);
  }

  /** Contacts listen only while the emergency is live (real state). */
  listForContact(sessionId: string): ClipInfo[] {
    if (!CONTACT_LISTEN_STATES.includes(this.sessions.opsView(sessionId).state)) {
      return [];
    }
    return this.describe(sessionId);
  }

  clipForSeeker(sessionId: string, segment: string): Clip | null {
    return this.listForSeeker(sessionId).some((c) => c.segment === segment)
      ? this.join(sessionId, segment)
      : null;
  }

  clipForContact(sessionId: string, segment: string): Clip | null {
    return this.listForContact(sessionId).some((c) => c.segment === segment)
      ? this.join(sessionId, segment)
      : null;
  }

  /**
   * Removes ciphertext whose session key has been destroyed. Purge itself
   * is the key destruction; this only clears what can no longer be read.
   */
  sweep(): number {
    let removed = 0;
    for (const sessionId of this.store.sessionIds()) {
      if (this.crypto.isShredded(sessionId)) {
        removed += this.store.deleteSession(sessionId);
      }
    }
    return removed;
  }

  private describe(sessionId: string): ClipInfo[] {
    if (this.crypto.isShredded(sessionId)) {
      return [];
    }
    const bySegment = new Map<string, ClipInfo>();
    for (const piece of this.store.list(sessionId)) {
      const info = bySegment.get(piece.segment);
      if (info === undefined) {
        bySegment.set(piece.segment, {
          segment: piece.segment,
          startedAt: piece.recordedAt,
          updatedAt: piece.recordedAt,
          pieces: 1,
        });
      } else {
        info.pieces++;
        if (piece.recordedAt > info.updatedAt) {
          info.updatedAt = piece.recordedAt;
        }
      }
    }
    return [...bySegment.values()];
  }

  /** Pieces of one recording, in order, as one playable file. */
  private join(sessionId: string, segment: string): Clip | null {
    if (this.crypto.isShredded(sessionId)) {
      return null;
    }
    const pieces: AudioPiece[] = this.store.list(sessionId).filter((p) => p.segment === segment);
    if (pieces.length === 0) {
      return null;
    }
    const decoded = pieces.map((p) => JSON.parse(this.crypto.decrypt(p.blob)) as PiecePayload);
    return {
      mime: decoded[0].mime,
      bytes: Buffer.concat(decoded.map((d) => Buffer.from(d.data, 'base64'))),
    };
  }
}
