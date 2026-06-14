import { createHash } from 'node:crypto';
import { WAITLIST_CONSENT_VERSION } from '../domain/consent';
import { InvalidInputError } from '../domain/errors';
import { Clock } from '../domain/types';

/**
 * Pre-launch waitlist. This is ordinary marketing-signup data — NOT
 * safety data — and is kept well away from the session machinery: no
 * location, no link to any session, recorded under its own consent
 * version (invariant 11). Emails are de-duplicated by a hash so a repeat
 * signup is idempotent and the raw list stays small.
 */
export interface WaitlistEntry {
  emailRef: string;
  email: string;
  country: string | null;
  consentVersion: string;
  joinedAt: string;
}

export interface WaitlistStore {
  save(entry: WaitlistEntry): void;
  has(emailRef: string): boolean;
  count(): number;
}

export class InMemoryWaitlistStore implements WaitlistStore {
  private readonly entries = new Map<string, WaitlistEntry>();

  save(entry: WaitlistEntry): void {
    this.entries.set(entry.emailRef, entry);
  }

  has(emailRef: string): boolean {
    return this.entries.has(emailRef);
  }

  count(): number {
    return this.entries.size;
  }
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

// Deliberately liberal: just enough to reject obvious non-emails.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class WaitlistService {
  constructor(
    private readonly store: WaitlistStore,
    private readonly clock: Clock,
  ) {}

  join(email: string, country?: string): { ok: true; alreadyJoined: boolean; count: number } {
    const normalized = (email ?? '').trim().toLowerCase();
    if (!EMAIL_SHAPE.test(normalized)) {
      throw new InvalidInputError('a valid email is required');
    }
    const emailRef = sha256(normalized);
    const alreadyJoined = this.store.has(emailRef);
    if (!alreadyJoined) {
      this.store.save({
        emailRef,
        email: normalized,
        country: country?.trim() ? country.trim().slice(0, 2).toUpperCase() : null,
        consentVersion: WAITLIST_CONSENT_VERSION,
        joinedAt: this.clock.now().toISOString(),
      });
    }
    return { ok: true, alreadyJoined, count: this.store.count() };
  }

  count(): number {
    return this.store.count();
  }
}
