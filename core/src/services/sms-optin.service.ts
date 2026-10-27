import { SMS_OPT_IN_CONSENT_VERSION } from '../domain/consent';
import { Clock } from '../domain/types';
import { phoneRefOf } from './registration.service';

/**
 * Numbers that agreed (by texting JOIN) to receive Aegira alert SMS.
 * Recorded under consent v6. Stores only the hash of the normalized number,
 * which is all the outbound guard needs: it already holds the destination
 * and just asks "did this number agree?".
 */
export interface SmsOptIn {
  phoneRef: string;
  consentVersion: string;
  joinedAt: string;
}

export interface SmsOptInStore {
  save(entry: SmsOptIn): void;
  has(phoneRef: string): boolean;
  delete(phoneRef: string): boolean;
}

export class InMemorySmsOptInStore implements SmsOptInStore {
  private readonly entries = new Map<string, SmsOptIn>();

  save(entry: SmsOptIn): void {
    this.entries.set(entry.phoneRef, { ...entry });
  }

  has(phoneRef: string): boolean {
    return this.entries.has(phoneRef);
  }

  delete(phoneRef: string): boolean {
    return this.entries.delete(phoneRef);
  }
}

export class SmsOptInService {
  constructor(
    private readonly store: SmsOptInStore,
    private readonly clock: Clock,
  ) {}

  join(phone: string): void {
    this.store.save({
      phoneRef: phoneRefOf(phone),
      consentVersion: SMS_OPT_IN_CONSENT_VERSION,
      joinedAt: this.clock.now().toISOString(),
    });
  }

  /** STOP must really delete, as consent v6 promises. */
  leave(phone: string): boolean {
    return this.store.delete(phoneRefOf(phone));
  }

  hasJoined(phone: string): boolean {
    try {
      return this.store.has(phoneRefOf(phone));
    } catch {
      return false; // not a phone number at all
    }
  }
}
