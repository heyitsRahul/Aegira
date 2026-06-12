import { createHash, timingSafeEqual } from 'node:crypto';
import { NotAuthenticatedError } from '../domain/errors';
import { ResponderProfile } from '../services/matching.service';

interface EnrolledResponder {
  profile: ResponderProfile;
  tokenHash: string;
  /** Plaintext kept ONLY so the dev roster endpoint can hand it to the
   *  demo UI. Production enrollment never stores plaintext tokens. */
  devToken: string;
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

/**
 * Dev-only in-memory responder roster used by the dispatch endpoint, now
 * also the authenticator for responder capability tokens. Production
 * replaces this with the verified-responder directory backed by real
 * enrollment. Note what is NOT here: no precise locations, only coarse
 * availability cells.
 */
export class ResponderRegistry {
  private readonly responders = new Map<string, EnrolledResponder>();

  enroll(profile: ResponderProfile, devToken: string): void {
    this.responders.set(profile.id, { profile, tokenHash: sha256(devToken), devToken });
  }

  /** Throws unless the token matches the enrolled responder. */
  authenticate(responderId: string, token: string | null | undefined): void {
    const entry = this.responders.get(responderId);
    if (entry === undefined || typeof token !== 'string' || token.length === 0) {
      throw new NotAuthenticatedError();
    }
    const presented = Buffer.from(sha256(token), 'hex');
    const stored = Buffer.from(entry.tokenHash, 'hex');
    if (!timingSafeEqual(presented, stored)) {
      throw new NotAuthenticatedError();
    }
  }

  all(): ResponderProfile[] {
    return [...this.responders.values()].map((e) => e.profile);
  }

  /** Profiles plus plaintext tokens — for the dev roster endpoint only. */
  devRoster(): Array<ResponderProfile & { devToken: string }> {
    return [...this.responders.values()].map((e) => ({ ...e.profile, devToken: e.devToken }));
  }
}
