import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/domain/errors';
import { normalizePhone, phoneDigits, samePhone } from '../src/domain/phone';

describe('global phone normalization (E.164)', () => {
  it('keeps an explicit international number, stripping formatting', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+1 (415) 555-1234')).toBe('+14155551234');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('+61 2 9374 4000')).toBe('+61293744000');
  });

  it('treats 00 as the international access prefix', () => {
    expect(normalizePhone('0091 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('001 415 555 1234')).toBe('+14155551234');
  });

  it('prepends the default country dial code for national numbers', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    // a trunk 0 is dropped before the dial code is applied
    expect(normalizePhone('098765 43210')).toBe('+919876543210');
  });

  it('honors a non-Indian default dial code for national numbers', () => {
    expect(normalizePhone('415 555 1234', '1')).toBe('+14155551234');
    expect(normalizePhone('020 7946 0958', '44')).toBe('+442079460958');
  });

  it('an explicit + number ignores the default dial code', () => {
    expect(normalizePhone('+14155551234', '91')).toBe('+14155551234');
  });

  it('the SAME line matches across every format and channel', () => {
    const forms = ['+91 98765 43210', '098765 43210', '98765-43210', '0091-9876543210'];
    const canonical = normalizePhone(forms[0]);
    for (const f of forms) {
      expect(normalizePhone(f)).toBe(canonical);
      expect(samePhone(f, forms[0])).toBe(true);
    }
  });

  it('rejects garbage and out-of-range lengths', () => {
    expect(() => normalizePhone('')).toThrow(InvalidInputError);
    expect(() => normalizePhone('abc')).toThrow(InvalidInputError);
    expect(() => normalizePhone('12')).toThrow(InvalidInputError);
    expect(() => normalizePhone('+1234567890123456789')).toThrow(InvalidInputError);
  });

  it('phoneDigits and samePhone are format-tolerant helpers', () => {
    expect(phoneDigits('+91-98765 43210')).toBe('919876543210');
    expect(samePhone('not a phone', '+919876543210')).toBe(false);
  });
});
