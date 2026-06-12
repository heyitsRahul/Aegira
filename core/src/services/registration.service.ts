import { createHash } from 'node:crypto';
import { SMS_REGISTRATION_CONSENT_VERSION } from '../domain/consent';
import { InvalidInputError } from '../domain/errors';
import { Clock } from '../domain/types';

/**
 * Registration for channels that have no app to keep a profile in (SMS,
 * lite web). Account-class identity data: name, trusted contact numbers,
 * PIN hashes, consent version. Deliberately stored WITHOUT any location —
 * location only ever enters the system with a session trigger
 * (invariant 1). Recorded under consent v2 (invariant 11).
 */
export interface RegistrationRecord {
  /** sha256 of the normalized phone number — the lookup key. */
  phoneRef: string;
  displayName: string;
  contacts: Array<{ id: string; address: string }>;
  pinSafeHash: string;
  pinDuressHash: string;
  consentVersion: string;
  registeredAt: string;
}

export interface RegistrationStore {
  save(record: RegistrationRecord): void;
  get(phoneRef: string): RegistrationRecord | undefined;
  delete(phoneRef: string): void;
}

export class InMemoryRegistrationStore implements RegistrationStore {
  private readonly records = new Map<string, RegistrationRecord>();

  save(record: RegistrationRecord): void {
    this.records.set(record.phoneRef, structuredClone(record));
  }

  get(phoneRef: string): RegistrationRecord | undefined {
    const record = this.records.get(phoneRef);
    return record === undefined ? undefined : structuredClone(record);
  }

  delete(phoneRef: string): void {
    this.records.delete(phoneRef);
  }
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 10) {
    throw new InvalidInputError('phone number must have at least 10 digits');
  }
  return digits.slice(-12);
}

export const phoneRefOf = (raw: string): string => sha256(normalizePhone(raw));

const PIN_SHAPE = /^\d{4,6}$/;

export class RegistrationService {
  constructor(
    private readonly store: RegistrationStore,
    private readonly clock: Clock,
  ) {}

  register(
    phone: string,
    displayName: string,
    contactPhone: string,
    pinSafe: string,
    pinDuress: string,
  ): RegistrationRecord {
    if (displayName.trim().length === 0) {
      throw new InvalidInputError('a name is required');
    }
    if (!PIN_SHAPE.test(pinSafe) || !PIN_SHAPE.test(pinDuress)) {
      throw new InvalidInputError('pins must be 4-6 digits');
    }
    if (pinSafe === pinDuress) {
      throw new InvalidInputError('safe and duress pins must differ');
    }
    const contactNormalized = normalizePhone(contactPhone);
    const record: RegistrationRecord = {
      phoneRef: phoneRefOf(phone),
      displayName: displayName.trim(),
      contacts: [{ id: `c-${sha256(contactNormalized).slice(0, 8)}`, address: contactNormalized }],
      pinSafeHash: sha256(pinSafe),
      pinDuressHash: sha256(pinDuress),
      consentVersion: SMS_REGISTRATION_CONSENT_VERSION,
      registeredAt: this.clock.now().toISOString(),
    };
    this.store.save(record);
    return record;
  }

  find(phone: string): RegistrationRecord | undefined {
    return this.store.get(phoneRefOf(phone));
  }

  /** Texting STOP must really delete — consent v2 promises it. */
  unregister(phone: string): boolean {
    const record = this.find(phone);
    if (record === undefined) {
      return false;
    }
    this.store.delete(record.phoneRef);
    return true;
  }

  /**
   * PIN check for SMS/lite actions. Never tells the caller which of the
   * two PINs failed — 'invalid' is all a wrong PIN ever looks like.
   */
  verifyPin(phone: string, pin: string): 'safe' | 'duress' | 'invalid' {
    const record = this.find(phone);
    if (record === undefined) {
      return 'invalid';
    }
    const presented = sha256(pin);
    if (presented === record.pinSafeHash) {
      return 'safe';
    }
    if (presented === record.pinDuressHash) {
      return 'duress';
    }
    return 'invalid';
  }
}
