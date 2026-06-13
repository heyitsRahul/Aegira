import { describe, expect, it } from 'vitest';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  HELPLINES,
  helplinesFor,
  UNIVERSAL_HELPLINE,
} from '../src/domain/reference';

describe('reference data', () => {
  it('defaults to India and lists India first', () => {
    expect(DEFAULT_COUNTRY).toBe('IN');
    expect(COUNTRIES[0].code).toBe('IN');
    expect(COUNTRIES[0].dial).toBe('91');
  });

  it('India carries the real unified and service helplines', () => {
    const numbers = HELPLINES.IN.map((h) => h.number);
    expect(numbers).toContain('112'); // unified emergency
    expect(numbers).toContain('100'); // police
    expect(numbers).toContain('108'); // ambulance
    expect(numbers).toContain('1091'); // women
  });

  it('every country code is unique and every dial code is digits', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of COUNTRIES) {
      expect(c.dial).toMatch(/^\d{1,4}$/);
    }
  });

  it('falls back to the universal GSM emergency number for unknown countries', () => {
    expect(helplinesFor('ZZ')).toEqual([UNIVERSAL_HELPLINE]);
    expect(UNIVERSAL_HELPLINE.number).toBe('112');
  });

  it('known countries resolve their own helplines', () => {
    expect(helplinesFor('US').some((h) => h.number === '911')).toBe(true);
    expect(helplinesFor('GB').some((h) => h.number === '999')).toBe(true);
  });
});
