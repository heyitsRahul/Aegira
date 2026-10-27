import { InvalidInputError } from './errors';

/**
 * Phone-number normalization to E.164, working for every country — not just
 * India. A number is stored and compared as `+<country code><subscriber>`
 * with no separators, so the same person matches across channels (app, SMS,
 * lite) regardless of how they typed it.
 *
 * Rules:
 *  - leading `+`            -> already international, take the digits
 *  - leading `00`           -> international access prefix, take the rest
 *  - otherwise             -> a national number: drop a trunk `0`, then
 *                            prepend the default country's dial code
 *
 * The default dial code only applies to numbers typed in national form; a
 * `+1...` US number entered on an Indian phone still normalizes to the US.
 * India (91) is the default so local demo data "just works", but no value
 * here is India-specific.
 */

/** Default country dial code: India. Configurable per call. */
export const DEFAULT_DIAL_CODE = '91';

// E.164 allows at most 15 digits including the country code; the practical
// floor (country code + a short subscriber number) is around 8.
const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

export function normalizePhone(raw: string, defaultDialCode: string = DEFAULT_DIAL_CODE): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new InvalidInputError('phone number is required');
  }
  const cleaned = raw.trim().replace(/[^\d+]/g, '');
  let digits: string;
  if (cleaned.startsWith('+')) {
    digits = cleaned.slice(1).replace(/\D/g, '');
  } else if (cleaned.startsWith('00')) {
    digits = cleaned.slice(2).replace(/\D/g, '');
  } else {
    const national = cleaned.replace(/\D/g, '').replace(/^0+/, '');
    digits = defaultDialCode.replace(/\D/g, '') + national;
  }
  if (digits.length < E164_MIN_DIGITS || digits.length > E164_MAX_DIGITS) {
    throw new InvalidInputError('that phone number does not look right. Use 10 digits, or + and the country code');
  }
  return `+${digits}`;
}

/** Bare digits, for tolerant suffix comparison in clients. */
export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** True if two numbers are the same line, however they were formatted. */
export function samePhone(a: string, b: string, defaultDialCode: string = DEFAULT_DIAL_CODE): boolean {
  try {
    return normalizePhone(a, defaultDialCode) === normalizePhone(b, defaultDialCode);
  } catch {
    return false;
  }
}
