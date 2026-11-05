import { EncryptedBlob } from '../crypto/shredder';

/**
 * Persistence port for opt-in sound recordings (consent v8). Each row is one
 * piece of one recording, bound to a session and encrypted under that
 * session's key: the store never sees sound or its format in plaintext.
 */
export interface AudioPiece {
  sessionId: string;
  /** One recording on one device; its pieces join into one playable file. */
  segment: string;
  seq: number;
  recordedAt: string;
  /** Encrypts JSON { mime, data(base64) } under the session key. */
  blob: EncryptedBlob;
}

export interface AudioStore {
  /** Returns false (and stores nothing) if this segment/seq already exists. */
  save(piece: AudioPiece): boolean;
  /** Ordered by segment start, then seq. */
  list(sessionId: string): AudioPiece[];
  /** Sweep of dead ciphertext after the session key was shredded. */
  deleteSession(sessionId: string): number;
  sessionIds(): string[];
}

export class InMemoryAudioStore implements AudioStore {
  private readonly pieces: AudioPiece[] = [];

  save(piece: AudioPiece): boolean {
    if (
      this.pieces.some(
        (p) => p.sessionId === piece.sessionId && p.segment === piece.segment && p.seq === piece.seq,
      )
    ) {
      return false;
    }
    this.pieces.push(structuredClone(piece));
    return true;
  }

  list(sessionId: string): AudioPiece[] {
    return orderPieces(this.pieces.filter((p) => p.sessionId === sessionId)).map((p) =>
      structuredClone(p),
    );
  }

  deleteSession(sessionId: string): number {
    let removed = 0;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      if (this.pieces[i].sessionId === sessionId) {
        this.pieces.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  sessionIds(): string[] {
    return [...new Set(this.pieces.map((p) => p.sessionId))];
  }
}

/** Segments in the order they started; pieces within a segment by seq. */
export function orderPieces(pieces: AudioPiece[]): AudioPiece[] {
  const started = new Map<string, string>();
  for (const p of pieces) {
    const first = started.get(p.segment);
    if (first === undefined || p.recordedAt < first) {
      started.set(p.segment, p.recordedAt);
    }
  }
  return [...pieces].sort(
    (a, b) =>
      (started.get(a.segment) ?? '').localeCompare(started.get(b.segment) ?? '') ||
      a.segment.localeCompare(b.segment) ||
      a.seq - b.seq,
  );
}
