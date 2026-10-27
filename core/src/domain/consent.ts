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
  v2:
    'By registering for Sahay over SMS you consent to: (1) Sahay storing ' +
    'your name, your trusted contact numbers, and hashed PINs until you ' +
    'text STOP; (2) emergency sessions being triggered by texting SOS, ' +
    'using your approximate network location at that moment only; (3) the ' +
    'session terms of consent v1 applying to every session you trigger. ' +
    'No location is stored with your registration.',
  v3:
    'By joining the Sahay waitlist you consent to Sahay storing your email ' +
    'address (and optional country) to contact you about early access. No ' +
    'location and no emergency-session data are involved. You can ask us to ' +
    'delete it at any time.',
  // v4/v5: same scope as v2/v3, re-issued under the product's new name
  // (Sahay → Aegira). Wording otherwise unchanged; no scope expansion.
  v4:
    'By registering for Aegira over SMS you consent to: (1) Aegira storing ' +
    'your name, your trusted contact numbers, and hashed PINs until you ' +
    'text STOP; (2) emergency sessions being triggered by texting SOS, ' +
    'using your approximate network location at that moment only; (3) the ' +
    'session terms of consent v1 applying to every session you trigger. ' +
    'No location is stored with your registration.',
  v5:
    'By joining the Aegira waitlist you consent to Aegira storing your email ' +
    'address (and optional country) to contact you about early access. No ' +
    'location and no emergency-session data are involved. You can ask us to ' +
    'delete it at any time.',
  v6:
    'By texting JOIN you agree to Aegira texting this number when someone ' +
    'who lists you as a trusted contact needs help. Aegira stores only a ' +
    'one-way hash of this number and the time you joined: no name, no ' +
    'location. Text STOP at any time to opt out.',
});

export const CURRENT_CONSENT_VERSION = 'v1';
export const SMS_OPT_IN_CONSENT_VERSION = 'v6';
export const SMS_REGISTRATION_CONSENT_VERSION = 'v4';
export const WAITLIST_CONSENT_VERSION = 'v5';

export function consentText(version: string): string {
  const text = CONSENT_RECORD[version];
  if (text === undefined) {
    throw new Error(`unknown consent version: ${version}`);
  }
  return text;
}
