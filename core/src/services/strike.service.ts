import { Clock, StrikeRecord } from '../domain/types';

/**
 * Strikes, not scores (invariant 10). Misbehavior creates a discrete,
 * human-reviewable, appealable record. There is intentionally no method
 * here that aggregates strikes into a number — eligibility checks are
 * boolean rules over individual records.
 */
export class StrikeService {
  private readonly strikes = new Map<string, StrikeRecord>();
  private counter = 0;

  constructor(private readonly clock: Clock) {}

  file(responderId: string, reason: string): StrikeRecord {
    this.counter += 1;
    const record: StrikeRecord = {
      id: `strike-${this.counter}`,
      responderId,
      reason,
      createdAt: this.clock.now().toISOString(),
      status: 'open',
      appealNote: null,
    };
    this.strikes.set(record.id, record);
    return record;
  }

  /** Human review outcome: uphold or dismiss. */
  review(strikeId: string, decision: 'upheld' | 'dismissed'): StrikeRecord {
    const record = this.mustGet(strikeId);
    record.status = decision;
    return record;
  }

  appeal(strikeId: string, note: string): StrikeRecord {
    const record = this.mustGet(strikeId);
    record.appealNote = note;
    record.status = 'open';
    return record;
  }

  listFor(responderId: string): StrikeRecord[] {
    return [...this.strikes.values()].filter((s) => s.responderId === responderId);
  }

  /** Boolean eligibility rule used by dispatch — not a score. */
  hasOpenOrUpheldStrike(responderId: string): boolean {
    return this.listFor(responderId).some((s) => s.status === 'open' || s.status === 'upheld');
  }

  private mustGet(strikeId: string): StrikeRecord {
    const record = this.strikes.get(strikeId);
    if (record === undefined) {
      throw new Error(`strike ${strikeId} not found`);
    }
    return record;
  }
}
