import { createHmac, timingSafeEqual } from 'node:crypto';
import { SmsTransport } from './sms';

/**
 * A real phone number from an ordinary Android phone and SIM, via the open
 * source "SMS Gateway for Android" app (docs.sms-gate.app) in cloud mode.
 * The cheapest way to get a number people in India can text from any
 * phone: no telecom contract, no DLT registration for person-to-person
 * texts. Selected only when the SMSGATE_* env vars are set.
 *
 *  - Outbound: POST {base}/messages with Basic auth.
 *  - Inbound: the app calls our webhook for each received SMS, signed with
 *    HMAC-SHA256 over the raw body + X-Timestamp.
 */
export interface AndroidGatewayConfig {
  baseUrl: string;
  username: string;
  password: string;
  /** Webhook signing key (app: Settings → Webhooks → Signing Key). */
  signingKey: string | null;
}

export const DEFAULT_ANDROID_GATEWAY_URL = 'https://api.sms-gate.app/3rdparty/v1';

export function androidGatewayConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): AndroidGatewayConfig | null {
  const username = env.SMSGATE_USERNAME?.trim();
  const password = env.SMSGATE_PASSWORD?.trim();
  if (!username || !password) {
    return null;
  }
  return {
    baseUrl: (env.SMSGATE_BASE_URL?.trim() || DEFAULT_ANDROID_GATEWAY_URL).replace(/\/+$/, ''),
    username,
    password,
    signingKey: env.SMSGATE_SIGNING_KEY?.trim() || null,
  };
}

export class AndroidGatewaySmsTransport implements SmsTransport {
  constructor(
    private readonly config: AndroidGatewayConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(to: string, text: string): Promise<void> {
    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    const res = await this.fetchImpl(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify({ textMessage: { text }, phoneNumbers: [to] }),
    });
    if (!res.ok) {
      // Status only: the response may echo the recipient number.
      throw new Error(`SMS gateway send failed: HTTP ${res.status}`);
    }
  }
}

/**
 * Makes sure the gateway forwards received texts to us, so nobody has to
 * register the webhook by hand. Idempotent: does nothing if it is already
 * there. Returns what happened, for a one-line startup log (no secrets).
 */
export async function ensureAndroidWebhook(
  config: AndroidGatewayConfig,
  webhookUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<'registered' | 'already-registered'> {
  const auth = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  const list = await fetchImpl(`${config.baseUrl}/webhooks`, { headers: { authorization: auth } });
  if (!list.ok) {
    throw new Error(`could not list gateway webhooks: HTTP ${list.status}`);
  }
  const existing = (await list.json()) as Array<{ url?: string; event?: string }>;
  if (existing.some((w) => w.url === webhookUrl && w.event === 'sms:received')) {
    return 'already-registered';
  }
  const created = await fetchImpl(`${config.baseUrl}/webhooks`, {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, event: 'sms:received' }),
  });
  if (!created.ok) {
    throw new Error(`could not register gateway webhook: HTTP ${created.status}`);
  }
  return 'registered';
}

/** Accept webhooks signed within this window, to blunt replays. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function verifyAndroidGatewaySignature(
  signingKey: string,
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
  nowSeconds: number,
): boolean {
  if (typeof timestamp !== 'string' || typeof signature !== 'string' || !/^\d+$/.test(timestamp)) {
    return false;
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }
  const expected = createHmac('sha256', signingKey).update(rawBody + timestamp).digest('hex');
  const presented = signature.trim().toLowerCase();
  if (presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

/** The part of an `sms:received` webhook we use. */
export interface AndroidInboundSms {
  envelopeId: string;
  sender: string;
  message: string;
}

/** Parses a webhook body; null for other events or malformed input. */
export function parseAndroidWebhook(body: unknown): AndroidInboundSms | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const b = body as { event?: unknown; id?: unknown; payload?: unknown };
  if (b.event !== 'sms:received' || typeof b.payload !== 'object' || b.payload === null) {
    return null;
  }
  const p = b.payload as { sender?: unknown; message?: unknown; messageId?: unknown };
  if (typeof p.sender !== 'string' || typeof p.message !== 'string') {
    return null;
  }
  const envelopeId =
    typeof b.id === 'string' ? b.id : typeof p.messageId === 'string' ? p.messageId : '';
  return { envelopeId, sender: p.sender, message: p.message };
}
