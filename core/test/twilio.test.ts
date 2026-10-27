import { describe, expect, it } from 'vitest';
import {
  twilioConfigFromEnv,
  twilioSignature,
  twimlMessage,
  verifyTwilioSignature,
} from '../src/services/twilio';

describe('twilio config from env', () => {
  it('returns null unless all three vars are present', () => {
    expect(twilioConfigFromEnv({})).toBeNull();
    expect(twilioConfigFromEnv({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't' })).toBeNull();
    expect(
      twilioConfigFromEnv({
        TWILIO_ACCOUNT_SID: 'AC',
        TWILIO_AUTH_TOKEN: 't',
        TWILIO_FROM_NUMBER: '+1',
      }),
    ).toEqual({ accountSid: 'AC', authToken: 't', fromNumber: '+1' });
  });
});

describe('twilio inbound signature verification', () => {
  const token = 'test-auth-token';
  const url = 'https://aegira.example/gateway/twilio';
  const params = { From: '+919876543210', Body: 'SOS', MessageSid: 'SM123' };

  it('accepts a correctly signed request', () => {
    const sig = twilioSignature(token, url, params);
    expect(verifyTwilioSignature(token, url, params, sig)).toBe(true);
  });

  it('rejects a tampered body, url, missing or wrong signature', () => {
    const sig = twilioSignature(token, url, params);
    expect(verifyTwilioSignature(token, url, { ...params, Body: 'CANCEL' }, sig)).toBe(false);
    expect(verifyTwilioSignature(token, 'https://evil.example/x', params, sig)).toBe(false);
    expect(verifyTwilioSignature(token, url, params, undefined)).toBe(false);
    expect(verifyTwilioSignature(token, url, params, 'deadbeef')).toBe(false);
    expect(verifyTwilioSignature('other-token', url, params, sig)).toBe(false);
  });

  it('is order-independent in the params (sorted by key)', () => {
    const a = twilioSignature(token, url, { a: '1', b: '2' });
    const b = twilioSignature(token, url, { b: '2', a: '1' });
    expect(a).toBe(b);
  });
});

describe('TwiML reply', () => {
  it('wraps and XML-escapes the message', () => {
    expect(twimlMessage('checked in safe')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>checked in safe</Message></Response>',
    );
    expect(twimlMessage('a & b <c> "d"')).toContain('a &amp; b &lt;c&gt; &quot;d&quot;');
  });
});
