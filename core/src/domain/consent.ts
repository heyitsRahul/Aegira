/**
 * CONSENT_RECORD: versioned consent texts. New data collection requires a
 * new version here — no silent scope expansion (invariant 11). Versions are
 * append-only; never edit a published text.
 */

export const CONSENT_RECORD: Readonly<Record<string, string>> = Object.freeze({
  v1:
    'By triggering an emergency session you consent to: (1) your precise ' +
    'location being shared with your chosen trusted contacts for the ' +
    'duration of this session only; (2) your approximate (~1 km) area and a ' +
    'session alias being shared with verified responders; (3) your exact ' +
    'location being shared with the one responder you accept; (4) all of ' +
    'this data being destroyed when the session is purged.',
});

export const CURRENT_CONSENT_VERSION = 'v1';

export function consentText(version: string): string {
  const text = CONSENT_RECORD[version];
  if (text === undefined) {
    throw new Error(`unknown consent version: ${version}`);
  }
  return text;
}
