import { cellDistance, parseCellId } from '../domain/geo';

/**
 * Deterministic, explainable responder matching. No ML in the dispatch
 * path (invariant 9): the same inputs always produce the same ranking, and
 * every candidate carries a human-readable explanation of why and where it
 * ranked. Risk models, if any, are advisory and live elsewhere — they can
 * never block or reorder dispatch.
 */

export interface ResponderProfile {
  readonly id: string;
  readonly verified: boolean;
  /** Coarse availability cell (~1 km grid id), not a precise location. */
  readonly availabilityCell: string;
  /** Discrete strike check, never a numeric score (invariant 10). */
  readonly hasOpenStrike: boolean;
}

export interface MatchCandidate {
  readonly responderId: string;
  readonly rank: number;
  readonly distanceCells: number;
  readonly explanation: readonly string[];
}

export class MatchingService {
  constructor(private readonly radiusCells: number) {}

  match(
    sessionCell: string,
    roster: readonly ResponderProfile[],
    maxResults: number,
  ): MatchCandidate[] {
    const origin = parseCellId(sessionCell);
    const eligible = roster
      .filter((r) => r.verified && !r.hasOpenStrike)
      .map((r) => ({ r, distance: cellDistance(origin, parseCellId(r.availabilityCell)) }))
      .filter((x) => x.distance <= this.radiusCells)
      .sort(
        (a, b) =>
          a.distance - b.distance || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0),
      );

    return eligible.slice(0, maxResults).map((x, i) => ({
      responderId: x.r.id,
      rank: i + 1,
      distanceCells: x.distance,
      explanation: [
        'identity-verified responder',
        'no open strike records',
        `availability cell is ${x.distance} cells from the session cell (limit ${this.radiusCells})`,
        'ranked by cell distance, ties broken by responder id',
      ],
    }));
  }
}
