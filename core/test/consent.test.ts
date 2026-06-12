import { describe, expect, it } from 'vitest';
import { CONSENT_RECORD, consentText, CURRENT_CONSENT_VERSION } from '../src/domain/consent';
import { buildRig, TRIGGER_FIXTURE } from './helpers/build-service';

describe('versioned consent (invariant 11)', () => {
  it('the current consent version has a published text', () => {
    expect(consentText(CURRENT_CONSENT_VERSION).length).toBeGreaterThan(50);
  });

  it('unknown versions are rejected', () => {
    expect(() => consentText('v999')).toThrow();
  });

  it('the consent registry is frozen — no silent edits', () => {
    expect(Object.isFrozen(CONSENT_RECORD)).toBe(true);
  });

  it('every session records the consent version it was created under', () => {
    const { service } = buildRig();
    const { sessionId } = service.trigger(TRIGGER_FIXTURE);
    const genesis = service.opsView(sessionId).events[0];
    expect(genesis.type).toBe('TRIGGERED');
    expect(genesis.data.consentVersion).toBe(CURRENT_CONSENT_VERSION);
  });
});
