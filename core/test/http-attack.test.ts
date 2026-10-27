import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postLimiter, POSTS_PER_MINUTE } from '../src/api/http-setup';

/**
 * The real server, started on a random port and attacked over HTTP the way
 * someone on the internet would: broken and oversized bodies, wrong types,
 * stolen tokens, many requests at once, script injection, code guessing.
 * The other tests call the services directly; these go through everything
 * a real request touches (routing, body parsing, filters, headers).
 */

let app: INestApplication;
let base = '';

beforeAll(async () => {
  // The app reads its settings when first loaded: an in-memory database,
  // and the default demo mode (simulators on, no real SMS).
  process.env.AEGIRA_DB = ':memory:';
  const { AppModule } = await import('../src/api/app.module');
  const { configureHttp } = await import('../src/api/http-setup');
  const nest = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger: false });
  // The flood limit is tested on its own below; here it would stop the
  // thousand-request fuzz long before the handlers are reached.
  configureHttp(nest, { postsPerMinute: Number.POSITIVE_INFINITY });
  await nest.listen(0, '127.0.0.1');
  app = nest;
  base = await nest.getUrl();
  base = base.replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
});

type Json = Record<string, unknown>;

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string; json: Json; headers: Headers }> {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    // HTML pages
  }
  return { status: res.status, text, json, headers: res.headers };
}

let userCounter = 0;
function person(extra: Json = {}): Json {
  userCounter += 1;
  return {
    userId: `http-user-${userCounter}`,
    displayName: 'Meera Krishnan',
    contacts: [{ id: 'c1', address: '+919876543210' }],
    location: { lat: 12.971634, lng: 77.594612 },
    category: 'personal_safety',
    ...extra,
  };
}

async function startSession(extra: Json = {}): Promise<{ id: string; token: string }> {
  const res = await call('POST', '/sessions', person(extra));
  expect(res.status).toBe(201);
  return { id: res.json.sessionId as string, token: res.json.seekerToken as string };
}

const seeker = (token: string) => ({ authorization: `Bearer ${token}` });

/** Signs of an internal error message escaping to the caller. */
const LEAK = /node_modules|\.ts:\d|\bat [A-Za-z.<>]+ \(|TypeError|ReferenceError|SQLITE/;

async function contactToken(sessionId: string): Promise<string> {
  const outbox = await call('GET', '/dev/outbox');
  const alerts = outbox.json.contactAlerts as Array<{ sessionId: string; liveSessionLink: string }>;
  const alert = alerts.find((a) => a.sessionId === sessionId);
  expect(alert).toBeDefined();
  return new URL(alert!.liveSessionLink).searchParams.get('t')!;
}

describe('garbage input never crashes the server', () => {
  const WEIRD: unknown[] = [null, 0, -1, '', [], ['a'], {}, { a: 1 }, true, 'x'.repeat(5000), '__proto__'];
  const ROUTES: Array<[string, string[]]> = [
    ['/sessions', ['userId', 'displayName', 'contacts', 'location', 'placeNote', 'category', 'pins']],
    ['/sessions/watch', ['userId', 'displayName', 'contacts', 'etaMinutes', 'pins']],
    ['/waitlist', ['email', 'country']],
    ['/languages/vote', ['code']],
    ['/lite/register', ['phone', 'name', 'contact', 'pinSafe', 'pinDuress', 'dial']],
    ['/lite/sos', ['phone', 'area', 'place', 'category', 'dial']],
    ['/lite/watch', ['phone', 'place', 'minutes', 'dial']],
    ['/lite/cancel', ['phone', 'pin', 'dial']],
    ['/lite/status', ['phone', 'pin', 'dial']],
    ['/lite/safe', ['phone', 'pin', 'dial']],
    ['/lite/extend', ['phone', 'pin', 'minutes', 'dial']],
    ['/dev/phone/sms', ['from', 'text']],
  ];
  const valid: Json = {
    ...person(),
    etaMinutes: 30,
    email: 'a@b.co',
    code: 'bn',
    phone: '9876543210',
    name: 'Asha',
    contact: '9123456789',
    pinSafe: '1234',
    pinDuress: '9999',
    dial: '91',
    from: '+919876543210',
    text: 'HELP',
    minutes: '10',
    pin: '1234',
  };

  it('every field of every form, filled with the wrong type, gets a polite "no"', async () => {
    const failures: string[] = [];
    for (const [path, fields] of ROUTES) {
      for (const field of fields) {
        for (const value of WEIRD) {
          const res = await call('POST', path, { ...valid, userId: `fuzz-${++userCounter}`, [field]: value });
          if (res.status >= 500 || LEAK.test(res.text)) {
            failures.push(`${res.status} ${path} ${field}=${JSON.stringify(value).slice(0, 20)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('broken JSON is a 400, an oversized body a 413, and neither leaks internals', async () => {
    const broken = await call('POST', '/sessions', '{"userId": ');
    expect(broken.status).toBe(400);
    const huge = await call('POST', '/sessions', JSON.stringify({ x: 'a'.repeat(300_000) }));
    expect(huge.status).toBe(413);
    for (const res of [broken, huge]) {
      expect(res.text).not.toMatch(LEAK);
    }
  });

  it('paths that try to climb out of the site folder find nothing', async () => {
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/sw.js/../../package.json', '/%2e%2e%2f.env']) {
      const res = await call('GET', path);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('"dependencies"');
    }
  });
});

describe('browser protections on every page', () => {
  it('sets the security headers and hides the server type', async () => {
    for (const path of ['/', '/app', '/lite', '/guide', '/healthz']) {
      const { headers } = await call('GET', path);
      expect(headers.get('x-powered-by')).toBeNull();
      expect(headers.get('x-content-type-options')).toBe('nosniff');
      expect(headers.get('x-frame-options')).toBe('DENY');
      expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  it('answers that can carry session data are never cached', async () => {
    const s = await startSession();
    for (const res of [await call('GET', `/sessions/${s.id}`, undefined, seeker(s.token)), await call('GET', '/lite')]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });
});

describe('flood limit', () => {
  function rig(limit: number) {
    let clock = 0;
    const limiter = postLimiter(limit, () => clock);
    const send = (ip: string, path = '/sessions', method = 'POST') => {
      const sent = { status: 200, body: '' as unknown, passed: false };
      const res = {
        setHeader() {},
        status(code: number) { sent.status = code; return res; },
        type() { return res; },
        json(body: unknown) { sent.body = body; },
        send(body: unknown) { sent.body = body; },
      };
      limiter({ method, path, ip } as never, res as never, () => { sent.passed = true; });
      return sent;
    };
    return { send, tick: (ms: number) => { clock += ms; } };
  }

  it('one address gets the limit, then a 429 that still says "call 112"', () => {
    const { send } = rig(3);
    expect([1, 2, 3].map(() => send('1.1.1.1').passed)).toEqual([true, true, true]);
    const blocked = send('1.1.1.1');
    expect(blocked.passed).toBe(false);
    expect(blocked.status).toBe(429);
    expect(JSON.stringify(blocked.body)).toContain('112');
  });

  it('other people are not affected, and the count resets each minute', () => {
    const { send, tick } = rig(1);
    send('1.1.1.1');
    expect(send('1.1.1.1').passed).toBe(false);
    expect(send('2.2.2.2').passed).toBe(true);
    tick(60_000);
    expect(send('1.1.1.1').passed).toBe(true);
  });

  it('pages, the old-phone site answer in HTML, and signed SMS webhooks are never limited', () => {
    const { send } = rig(0);
    expect(send('1.1.1.1', '/app', 'GET').passed).toBe(true);
    expect(send('1.1.1.1', '/gateway/android').passed).toBe(true);
    const lite = send('1.1.1.1', '/lite/sos');
    expect(lite.status).toBe(429);
    expect(String(lite.body)).toContain('<html');
    expect(String(lite.body)).toContain('112');
  });

  it('the real server is set to a limit no person tapping would reach', () => {
    expect(POSTS_PER_MINUTE).toBeGreaterThanOrEqual(100);
  });
});

describe('tokens: only the right key opens the right door', () => {
  it('no token, a malformed token or a huge token is refused', async () => {
    const s = await startSession();
    for (const auth of [undefined, 'Bearer', 'Bearer ', `bearer ${s.token}`, `Basic ${s.token}`, `Bearer ${'a'.repeat(10_000)}`]) {
      const res = await call('GET', `/sessions/${s.id}`, undefined, auth === undefined ? {} : { authorization: auth });
      expect(res.status).toBe(401);
    }
  });

  it("one person's token never opens another person's session", async () => {
    const a = await startSession();
    const b = await startSession();
    expect((await call('GET', `/sessions/${b.id}`, undefined, seeker(a.token))).status).toBe(401);
    expect((await call('POST', `/sessions/${b.id}/cancel`, { pin: '1234' }, seeker(a.token))).status).toBe(401);
  });

  it('contact and seeker tokens are not interchangeable', async () => {
    const s = await startSession();
    await call('POST', `/sessions/${s.id}/confirm`, {}, seeker(s.token));
    const contact = await contactToken(s.id);
    expect((await call('GET', `/sessions/${s.id}`, undefined, seeker(contact))).status).toBe(401);
    expect((await call('GET', `/sessions/${s.id}/contact-view?t=${s.token}`)).status).toBe(401);
    expect((await call('GET', `/sessions/${s.id}/contact-view?t=${contact}`)).status).toBe(200);
  });

  it('the founder dashboard and the SMS webhook stay locked without their secrets', async () => {
    expect((await call('GET', '/admin/data')).status).toBe(401);
    expect((await call('GET', '/admin/data', undefined, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await call('POST', '/gateway/sms', { from: '+919876543210', text: 'SOS' })).status).toBe(401);
    expect((await call('POST', '/gateway/android', {})).status).toBe(404);
  });
});

describe('no public list of emergencies (invariant 5)', () => {
  it('there is no way to ask "who needs help near here?"', async () => {
    await startSession();
    for (const path of ['/sessions', '/sessions?near=12.97,77.59', '/incidents', '/sessions/recent', '/sessions/nearby']) {
      const res = await call('GET', path);
      expect([401, 404]).toContain(res.status);
      expect(res.text).not.toContain('Meera');
    }
  });
});

describe('the secret alarm PIN, seen from outside (invariant 4)', () => {
  it('a duress cancel looks exactly like a real cancel: same status, same body, same headers', async () => {
    const real = await startSession();
    const duress = await startSession();
    const a = await call('POST', `/sessions/${real.id}/cancel`, { pin: '1234' }, seeker(real.token));
    const b = await call('POST', `/sessions/${duress.id}/cancel`, { pin: '9999' }, seeker(duress.token));
    expect(b.status).toBe(a.status);
    expect(b.text.replace(duress.id, 'ID')).toBe(a.text.replace(real.id, 'ID'));
    expect(b.headers.get('content-length')).toBe(a.headers.get('content-length'));
    expect(b.headers.get('content-type')).toBe(a.headers.get('content-type'));
    // The phone keeps saying "cancelled" afterwards too...
    const after = await call('GET', `/sessions/${duress.id}`, undefined, seeker(duress.token));
    expect(after.json.state).toBe('CANCELLED');
    // ...while the trusted contact sees the truth.
    const contact = await contactToken(duress.id);
    const view = await call('GET', `/sessions/${duress.id}/contact-view?t=${contact}`);
    expect(view.json.state).toBe('ACTIVE');
    expect(view.json.duress).toBe(true);
  });
});

describe('many requests at the same moment', () => {
  it('25 SOS taps at once from one person start exactly one emergency', async () => {
    const body = person();
    const results = await Promise.all(Array.from({ length: 25 }, () => call('POST', '/sessions', body)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(24);
  });

  it('30 different people at once all get their own session and token', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => call('POST', '/sessions', person())));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.json.sessionId)).size).toBe(30);
    expect(new Set(results.map((r) => r.json.seekerToken)).size).toBe(30);
  });

  it('10 cancels at once: exactly one succeeds', async () => {
    const s = await startSession();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => call('POST', `/sessions/${s.id}/cancel`, { pin: '1234' }, seeker(s.token))),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
  });
});

describe('helpers (responders) over HTTP', () => {
  const asha = { 'x-responder-token': 'asha-dev-token' };

  async function dispatched(): Promise<{ id: string; token: string }> {
    const s = await startSession();
    await call('POST', `/sessions/${s.id}/confirm`, {}, seeker(s.token));
    const offers = await call('POST', `/sessions/${s.id}/dispatch`, {}, seeker(s.token));
    expect(offers.status).toBe(201);
    return s;
  }

  it('before accepting, a helper sees no name, no phone and no exact spot', async () => {
    const s = await dispatched();
    const view = await call('GET', `/sessions/${s.id}/responder-view/responder-asha`, undefined, asha);
    expect(view.status).toBe(200);
    expect(view.text).not.toMatch(/Meera|Krishnan|9876543210|12\.9716|77\.5946/);
    expect(view.json.alias).toMatch(/^helpseeker-/);
    expect(view.json.location).toBeNull();
    // and cannot ask for the exact spot until they accept
    expect((await call('GET', `/sessions/${s.id}/dispatch-location/responder-asha`, undefined, asha)).status).toBe(403);
  });

  it('a helper cannot pretend to be another helper', async () => {
    const s = await dispatched();
    const res = await call('POST', `/sessions/${s.id}/accept`, { responderId: 'responder-vikram' }, asha);
    expect(res.status).toBe(401);
  });

  it('guessing the arrival code locks after 5 tries, even for the right code', async () => {
    const s = await dispatched();
    expect((await call('POST', `/sessions/${s.id}/accept`, { responderId: 'responder-asha' }, asha)).status).toBe(201);
    const right = (await call('GET', `/sessions/${s.id}/arrival-code`, undefined, seeker(s.token))).json.code as string;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', `/sessions/${s.id}/arrival`, { responderId: 'responder-asha', code: wrong }, asha)).status).toBe(403);
    }
    const locked = await call('POST', `/sessions/${s.id}/arrival`, { responderId: 'responder-asha', code: right }, asha);
    expect(locked.status).toBe(403);
  });
});

describe('script injection is shown as text, never run', () => {
  const EVIL = '<img src=x onerror=alert(1)>';

  async function form(path: string, fields: Record<string, string>): Promise<string> {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    return res.text();
  }

  it('a name or place with HTML in it is escaped on every page that shows it', async () => {
    const phone = '9000012345';
    const signup = await form('/lite/register', {
      phone, name: EVIL, contact: '9123400000', pinSafe: '2468', pinDuress: '1357', dial: '91',
    });
    expect(signup).not.toContain(EVIL);
    expect(signup).toContain('&lt;img');

    await form('/lite/sos', { phone, dial: '91', area: '', place: EVIL });
    // Let the 30-second cancel window pass, so the contact is alerted.
    const { SESSION_SERVICE } = await import('../src/api/session.controller');
    const sessions = app.get<{ evaluateTimers(now: Date): Promise<void> }>(SESSION_SERVICE);
    await sessions.evaluateTimers(new Date(Date.now() + 60_000));
    const outbox = await call('GET', '/dev/outbox');
    const alerts = outbox.json.contactAlerts as Array<{ liveSessionLink: string; helpseekerDisplayName: string }>;
    const alert = alerts.filter((a) => a.helpseekerDisplayName.includes('<img')).pop();
    expect(alert).toBeDefined();
    const page = await (await fetch(alert!.liveSessionLink.replace(/^https?:\/\/[^/]+/, base))).text();
    expect(page).not.toContain(EVIL);
    expect(page).toContain('&lt;img');
  });
});
