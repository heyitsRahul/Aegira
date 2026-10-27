import { createHmac } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AndroidGatewayWiring, GatewayController } from '../src/api/gateway.controller';
import { NotAuthenticatedError } from '../src/domain/errors';
import { openDatabase, SqliteSmsOptInStore } from '../src/persistence/sqlite';
import {
  AndroidGatewaySmsTransport,
  androidGatewayConfigFromEnv,
  DEFAULT_ANDROID_GATEWAY_URL,
  ensureAndroidWebhook,
  parseAndroidWebhook,
  verifyAndroidGatewaySignature,
} from '../src/services/android-gateway';
import { InMemoryMetrics } from '../src/services/metrics';
import { StubNotifier } from '../src/services/notification.service';
import { InMemoryRegistrationStore, RegistrationService } from '../src/services/registration.service';
import { CompositeNotifier, SmsNotifier, SmsTransport, StubSmsTransport } from '../src/services/sms';
import { SmsGatewayService } from '../src/services/sms-gateway.service';
import { GuardedSmsTransport, SmsGuard } from '../src/services/sms-guard';
import { InMemorySmsOptInStore, SmsOptInService } from '../src/services/sms-optin.service';
import { ManualClock } from './helpers/manual-clock';

const KEY = 'signing-key-from-the-app';
const NOW = 1_793_000_000;
const sign = (body: string, ts: string, key = KEY) =>
  createHmac('sha256', key).update(body + ts).digest('hex');

describe('Android gateway webhook signatures', () => {
  const body = '{"event":"sms:received","payload":{"sender":"+919000012345","message":"SOS"}}';
  const ts = String(NOW);

  it('accepts the exact body signed with the key', () => {
    expect(verifyAndroidGatewaySignature(KEY, body, ts, sign(body, ts), NOW)).toBe(true);
  });

  it('rejects a tampered body, a wrong key, or missing headers', () => {
    expect(verifyAndroidGatewaySignature(KEY, body.replace('SOS', 'STOP'), ts, sign(body, ts), NOW)).toBe(false);
    expect(verifyAndroidGatewaySignature(KEY, body, ts, sign(body, ts, 'other'), NOW)).toBe(false);
    expect(verifyAndroidGatewaySignature(KEY, body, undefined, sign(body, ts), NOW)).toBe(false);
    expect(verifyAndroidGatewaySignature(KEY, body, ts, undefined, NOW)).toBe(false);
  });

  it('rejects replays outside a five-minute window', () => {
    const old = String(NOW - 301);
    expect(verifyAndroidGatewaySignature(KEY, body, old, sign(body, old), NOW)).toBe(false);
    const recent = String(NOW - 299);
    expect(verifyAndroidGatewaySignature(KEY, body, recent, sign(body, recent), NOW)).toBe(true);
  });
});

describe('Android gateway config and transport', () => {
  it('is off unless both credentials are set', () => {
    expect(androidGatewayConfigFromEnv({})).toBeNull();
    expect(androidGatewayConfigFromEnv({ SMSGATE_USERNAME: 'u' })).toBeNull();
    const config = androidGatewayConfigFromEnv({ SMSGATE_USERNAME: 'u', SMSGATE_PASSWORD: 'p' });
    expect(config).toEqual({ baseUrl: DEFAULT_ANDROID_GATEWAY_URL, username: 'u', password: 'p', signingKey: null });
  });

  it('sends one text through the phone with basic auth', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 202 });
    }) as unknown as typeof fetch;
    const transport = new AndroidGatewaySmsTransport(
      { baseUrl: 'https://gw.example/3rdparty/v1', username: 'u', password: 'p', signingKey: null },
      fakeFetch,
    );
    await transport.send('+919876543210', 'hello');
    expect(calls[0].url).toBe('https://gw.example/3rdparty/v1/messages');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('u:p').toString('base64')}`,
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      textMessage: { text: 'hello' },
      phoneNumbers: ['+919876543210'],
    });
  });

  it('reports a failed send by status only, never echoing the number', async () => {
    const fakeFetch = (async () => new Response('+919876543210 rejected', { status: 500 })) as unknown as typeof fetch;
    const transport = new AndroidGatewaySmsTransport(
      { baseUrl: 'https://gw.example', username: 'u', password: 'p', signingKey: null },
      fakeFetch,
    );
    await expect(transport.send('+919876543210', 'x')).rejects.toThrow(/^SMS gateway send failed: HTTP 500$/);
  });

  it('registers its own webhook once, so nobody has to do it by hand', async () => {
    const hooks: Array<{ url: string; event: string }> = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        hooks.push(JSON.parse(String(init.body)));
        return new Response('{}', { status: 201 });
      }
      return new Response(JSON.stringify(hooks), { status: 200 });
    }) as unknown as typeof fetch;
    const config = { baseUrl: 'https://gw.example', username: 'u', password: 'p', signingKey: 'k' };
    const url = 'https://aegira.onrender.com/gateway/android';
    expect(await ensureAndroidWebhook(config, url, fakeFetch)).toBe('registered');
    expect(await ensureAndroidWebhook(config, url, fakeFetch)).toBe('already-registered');
    expect(hooks).toEqual([{ url, event: 'sms:received' }]);
  });

  it('parses received texts and ignores every other event', () => {
    expect(
      parseAndroidWebhook({ id: 'e1', event: 'sms:received', payload: { sender: '+91900', message: 'SOS', messageId: 'm' } }),
    ).toEqual({ envelopeId: 'e1', sender: '+91900', message: 'SOS' });
    expect(parseAndroidWebhook({ event: 'sms:delivered', payload: {} })).toBeNull();
    expect(parseAndroidWebhook({ event: 'sms:received', payload: { sender: 5 } })).toBeNull();
    expect(parseAndroidWebhook('nope')).toBeNull();
  });
});

describe('SMS opt-in (JOIN, consent v6)', () => {
  it('stores only a hash of the number, and STOP deletes it', () => {
    const store = new InMemorySmsOptInStore();
    const saved: string[] = [];
    const spy = { ...store, save: (e: { phoneRef: string }) => { saved.push(JSON.stringify(e)); store.save(e as never); }, has: (r: string) => store.has(r), delete: (r: string) => store.delete(r) };
    const optIns = new SmsOptInService(spy, new ManualClock(new Date('2026-10-27T10:00:00Z')));
    optIns.join('98765 43210');
    expect(saved[0]).not.toContain('9876543210');
    expect(saved[0]).toContain('"consentVersion":"v6"');
    expect(optIns.hasJoined('+91 98765 43210')).toBe(true);
    expect(optIns.leave('+919876543210')).toBe(true);
    expect(optIns.hasJoined('+919876543210')).toBe(false);
  });

  it('a non-number is never treated as opted in', () => {
    const optIns = new SmsOptInService(new InMemorySmsOptInStore(), new ManualClock(new Date()));
    expect(optIns.hasJoined('responder-asha')).toBe(false);
  });

  it('persists in SQLite', () => {
    const store = new SqliteSmsOptInStore(openDatabase(':memory:'));
    store.save({ phoneRef: 'abc', consentVersion: 'v6', joinedAt: '2026-10-27T10:00:00.000Z' });
    expect(store.has('abc')).toBe(true);
    expect(store.delete('abc')).toBe(true);
    expect(store.delete('abc')).toBe(false);
  });

  it('JOIN and STOP over SMS', async () => {
    const clock = new ManualClock(new Date('2026-10-27T10:00:00Z'));
    const optIns = new SmsOptInService(new InMemorySmsOptInStore(), clock);
    const gateway = new SmsGatewayService(
      {} as never,
      new RegistrationService(new InMemoryRegistrationStore(), clock),
      () => [],
      optIns,
    );
    expect(await gateway.handle('+919876543210', 'join')).toContain('consent v6');
    expect(optIns.hasJoined('+919876543210')).toBe(true);
    expect(await gateway.handle('+919876543210', 'STOP')).toContain('deleted');
    expect(optIns.hasJoined('+919876543210')).toBe(false);
  });

  it('registration warns when the contact still has to JOIN', async () => {
    const clock = new ManualClock(new Date('2026-10-27T10:00:00Z'));
    const optIns = new SmsOptInService(new InMemorySmsOptInStore(), clock);
    const registrations = new RegistrationService(new InMemoryRegistrationStore(), clock);
    const gateway = new SmsGatewayService({} as never, registrations, () => [], optIns, true);
    expect(await gateway.handle('+919000011111', 'REG Asha 9876500002 1234 9999')).toContain('text JOIN');
    await gateway.handle('+919876500002', 'JOIN');
    expect(await gateway.handle('+919000033333', 'REG Uma 9876500002 1234 9999')).not.toContain('JOIN');
  });
});

describe('real-SMS guard for a public demo', () => {
  function rig(optedIn: string[] = []) {
    const clock = new ManualClock(new Date('2026-10-27T10:00:00Z'));
    const metrics = new InMemoryMetrics();
    const guard = new SmsGuard(clock, { perNumberPerDay: 3, totalPerDay: 5 }, (to) => optedIn.includes(to), metrics);
    const sent = new StubSmsTransport();
    return {
      clock,
      metrics,
      sent,
      alerts: new GuardedSmsTransport(sent, guard, 'alert'),
      replies: new GuardedSmsTransport(sent, guard, 'reply'),
    };
  }

  it('alerts reach only numbers that agreed', async () => {
    const { alerts, sent, metrics } = rig(['+919000000001']);
    await alerts.send('+919000000001', 'alert', 't');
    await alerts.send('+919000000002', 'alert', 't');
    expect(sent.messages.map((m) => m.to)).toEqual(['+919000000001']);
    expect(metrics.snapshot()['sms.blocked_not_opted_in']).toBe(1);
  });

  it('replies to someone who texted us need no opt-in', async () => {
    const { replies, sent } = rig();
    await replies.send('+919000000003', 'help text', 't');
    expect(sent.messages).toHaveLength(1);
  });

  it('caps texts per number and in total each day, then resets', async () => {
    const { replies, sent, clock, metrics } = rig();
    for (let i = 0; i < 5; i++) await replies.send('+919000000004', 'x', 't');
    expect(sent.messages).toHaveLength(3);
    await replies.send('+919000000005', 'x', 't');
    await replies.send('+919000000006', 'x', 't');
    await replies.send('+919000000007', 'x', 't');
    expect(sent.messages).toHaveLength(5);
    expect(metrics.snapshot()['sms.blocked_daily_cap']).toBe(3);
    clock.advance(24 * 60 * 60 * 1000);
    await replies.send('+919000000004', 'x', 't');
    expect(sent.messages).toHaveLength(6);
  });
});

describe('notification resilience', () => {
  const failing: SmsTransport = { send: async () => { throw new Error('carrier down'); } };
  const alert = {
    kind: 'contact_alert' as const, sessionId: 's', to: '+919000000001', helpseekerDisplayName: 'Meera',
    category: 'personal_safety' as const, liveSessionLink: 'http://x', duress: false, escalation: false,
    watchExpired: false, locationKnown: true, placeNote: null, sentAt: '2026-10-27T10:00:00.000Z',
  };

  it('a failing channel never stops the others or the emergency', async () => {
    const app = new StubNotifier();
    let failures = 0;
    const notifier = new CompositeNotifier(new SmsNotifier(failing), app).onChannelFailure(() => { failures += 1; });
    await expect(notifier.sendContactAlert(alert)).resolves.toBeUndefined();
    expect(app.contactAlerts).toHaveLength(1);
    expect(failures).toBe(1);
  });

  it('real carriers never get responder offers addressed by responder id', async () => {
    const sms = new StubSmsTransport();
    await new SmsNotifier(sms, { responderOffers: false }).sendResponderOffer({
      kind: 'responder_offer', sessionId: 's', to: 'responder-asha', alias: 'helpseeker-1',
      coarseCell: 'cell:1:1', category: 'personal_safety', sentAt: 't',
    });
    expect(sms.messages).toHaveLength(0);
  });
});

describe('POST /gateway/android', () => {
  const clock = { now: () => new Date(NOW * 1000) };
  function controller(signingKey: string | null, allowUnsigned: boolean, android = true) {
    const handled: Array<{ from: string; text: string }> = [];
    const replies = new StubSmsTransport();
    const gateway = {
      handle: async (from: string, text: string) => { handled.push({ from, text }); return 'Aegira: ok'; },
    } as unknown as SmsGatewayService;
    const wiring: AndroidGatewayWiring | null = android
      ? { config: { baseUrl: 'x', username: 'u', password: 'p', signingKey }, reply: replies }
      : null;
    const c = new GatewayController(gateway, 's', null, 'https://x', allowUnsigned, wiring, clock);
    return { c, handled, replies };
  }
  const body = { id: 'env-1', event: 'sms:received', payload: { sender: '+919000012345', message: 'SOS' } };
  const raw = JSON.stringify(body);
  const req = (r = raw) => ({ rawBody: Buffer.from(r) }) as never;

  it('handles a signed text and replies through the phone', async () => {
    const { c, handled, replies } = controller(KEY, false);
    await c.androidInbound(req(), body, sign(raw, String(NOW)), String(NOW));
    expect(handled).toEqual([{ from: '+919000012345', text: 'SOS' }]);
    expect(replies.messages[0]).toMatchObject({ to: '+919000012345', text: 'Aegira: ok' });
  });

  it('rejects a bad signature', async () => {
    const { c, handled } = controller(KEY, true);
    await expect(c.androidInbound(req(), body, 'deadbeef', String(NOW))).rejects.toThrow(NotAuthenticatedError);
    expect(handled).toHaveLength(0);
  });

  it('rejects unsigned webhooks in production', async () => {
    const { c } = controller(null, false);
    await expect(c.androidInbound(req(), body)).rejects.toThrow(NotAuthenticatedError);
  });

  it('acts once on a retried delivery', async () => {
    const { c, handled } = controller(KEY, false);
    await c.androidInbound(req(), body, sign(raw, String(NOW)), String(NOW));
    await c.androidInbound(req(), body, sign(raw, String(NOW)), String(NOW));
    expect(handled).toHaveLength(1);
  });

  it('ignores delivery reports', async () => {
    const report = { id: 'env-2', event: 'sms:delivered', payload: {} };
    const r = JSON.stringify(report);
    const { c, handled } = controller(KEY, false);
    await c.androidInbound(req(r), report, sign(r, String(NOW)), String(NOW));
    expect(handled).toHaveLength(0);
  });

  it('does not exist unless configured', async () => {
    const { c } = controller(null, true, false);
    await expect(c.androidInbound(req(), body)).rejects.toThrow(NotFoundException);
  });
});
