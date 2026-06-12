import { ResponderProfile } from '../services/matching.service';

/**
 * Dev-only in-memory responder roster used by the dispatch endpoint.
 * Production replaces this with the verified-responder directory. Note
 * what is NOT here: no precise locations, only coarse availability cells.
 */
export class ResponderRegistry {
  private readonly responders = new Map<string, ResponderProfile>();

  upsert(profile: ResponderProfile): void {
    this.responders.set(profile.id, profile);
  }

  all(): ResponderProfile[] {
    return [...this.responders.values()];
  }
}
