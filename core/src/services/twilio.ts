import { createHmac, timingSafeEqual } from 'node:crypto';
import { SmsTransport } from './sms';

/**
 * Real outbound SMS via Twilio's REST API — no SDK dependency, just fetch and
 * node:crypto. Selected at wiring time only when the TWILIO_* env vars are set;
 * otherwise the in-memory stub is used so the demo still runs.
 */
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export function twilioConfigFromEnv(env: NodeJS.ProcessEnv): TwilioConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const fromNumber = env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    return null;
  }
  return { accountSid, authToken, fromNumber };
}

export class TwilioSmsTransport implements SmsTransport {
  constructor(private readonly config: TwilioConfig) {}

  async send(to: string, text: string): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
    const body = new URLSearchParams({ To: to, From: this.config.fromNumber, Body: text });
    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`twilio send failed: ${res.status}`);
    }
  }
}

/**
 * Verifies Twilio's X-Twilio-Signature on an inbound webhook: base64 of
 * HMAC-SHA1(authToken, fullUrl + each POST param appended as key+value in
 * lexicographic key order). Lets the inbound route trust that a request really
 * came from Twilio rather than relying on a shared secret in production.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join('');
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
): boolean {
  if (typeof signature !== 'string' || signature.length === 0) {
    return false;
  }
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** A minimal TwiML reply Twilio reads back to the sender as an SMS. */
export function twimlMessage(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}
