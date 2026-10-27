#!/usr/bin/env node
// Checks the LIVE demo from the outside, like a visitor or an attacker would.
// Usage: node scripts/live-check.mjs [https://aegira.onrender.com]
// Uses only fake demo data. The demo never sends real SMS.

const BASE = (process.argv[2] ?? 'https://aegira.onrender.com').replace(/\/$/, '');
let passed = 0;
const failed = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed.push(name);
    console.log(`  FAIL ${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function call(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* a page */ }
  return { status: res.status, text, json, headers: res.headers };
}

const fakePerson = () => ({
  userId: `live-check-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  displayName: 'Live Check',
  contacts: [{ id: 'c1', address: '+919876543210' }],
  location: { lat: 12.9716, lng: 77.5946 },
  category: 'other',
});

console.log(`Checking ${BASE}\n`);

// Wake a sleeping free server first.
for (let i = 0; i < 12; i++) {
  const ok = await fetch(`${BASE}/healthz`).then((r) => r.ok).catch(() => false);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 10_000));
}

console.log('Pages');
for (const [path, type] of [['/', 'text/html'], ['/app', 'text/html'], ['/lite', 'text/html'], ['/guide', 'text/html'],
  ['/healthz', 'application/json'], ['/manifest.webmanifest', ''], ['/sw.js', 'javascript'], ['/icon-192.png', 'image/png']]) {
  await check(`${path} loads`, async () => {
    const res = await call('GET', path);
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes(type), `type ${res.headers.get('content-type')}`);
  });
}
for (const path of ['/', '/app', '/lite']) {
  await check(`${path} says it is a demo and to call 112`, async () => {
    const { text } = await call('GET', path);
    assert(/demo/i.test(text) && text.includes('112'), 'demo warning missing');
  });
}

console.log('\nProtection');
await check('security headers on, server type hidden', async () => {
  const { headers } = await call('GET', '/');
  assert(headers.get('x-powered-by') === null, 'X-Powered-By present');
  assert(headers.get('x-frame-options') === 'DENY', 'can be framed');
  assert(headers.get('referrer-policy') === 'no-referrer', 'referrer leaks');
  assert(headers.get('x-content-type-options') === 'nosniff', 'nosniff missing');
});
await check('founder dashboard is locked', async () => {
  assert((await call('GET', '/admin/data')).status === 401, 'admin open');
  assert((await call('GET', '/admin/data', undefined, { authorization: 'Bearer dev-admin-token' })).status === 401, 'dev token works on live');
});
await check('SMS webhook is locked', async () => {
  assert((await call('POST', '/gateway/sms', { from: '+919876543210', text: 'SOS' })).status === 401, 'webhook open');
});
await check('no list of emergencies exists', async () => {
  for (const path of ['/sessions', '/incidents', '/sessions/nearby']) {
    assert([401, 404].includes((await call('GET', path)).status), `${path} answered`);
  }
});
await check('broken, oversized and wrong-type input is refused politely (no 500)', async () => {
  const results = [
    await call('POST', '/sessions', '{"userId": '),
    await call('POST', '/sessions', JSON.stringify({ x: 'a'.repeat(300_000) })),
    await call('POST', '/sessions', { ...fakePerson(), pins: null }),
    await call('POST', '/waitlist', { email: ['a@b.co'] }),
    await call('POST', '/lite/sos', { phone: { a: 1 }, place: 5 }),
  ];
  for (const r of results) {
    assert(r.status < 500, `got ${r.status}`);
    assert(!/node_modules|\.ts:\d|TypeError/.test(r.text), 'internals leaked');
  }
});

console.log('\nThe real flow, with fake data');
await check('a stolen token does not open someone else\'s session', async () => {
  const a = (await call('POST', '/sessions', fakePerson())).json;
  const b = (await call('POST', '/sessions', fakePerson())).json;
  const res = await call('GET', `/sessions/${b.sessionId}`, undefined, { authorization: `Bearer ${a.seekerToken}` });
  assert(res.status === 401, `status ${res.status}`);
  await call('POST', `/sessions/${a.sessionId}/cancel`, { pin: '1234' }, { authorization: `Bearer ${a.seekerToken}` });
  await call('POST', `/sessions/${b.sessionId}/cancel`, { pin: '1234' }, { authorization: `Bearer ${b.seekerToken}` });
});
await check('the secret alarm PIN looks exactly like a normal cancel', async () => {
  const real = (await call('POST', '/sessions', fakePerson())).json;
  const duress = (await call('POST', '/sessions', fakePerson())).json;
  const a = await call('POST', `/sessions/${real.sessionId}/cancel`, { pin: '1234' }, { authorization: `Bearer ${real.seekerToken}` });
  const b = await call('POST', `/sessions/${duress.sessionId}/cancel`, { pin: '9999' }, { authorization: `Bearer ${duress.seekerToken}` });
  assert(a.status === b.status, 'different status');
  assert(a.text.replace(real.sessionId, 'ID') === b.text.replace(duress.sessionId, 'ID'), 'different body');
  const after = await call('GET', `/sessions/${duress.sessionId}`, undefined, { authorization: `Bearer ${duress.seekerToken}` });
  assert(after.json.state === 'CANCELLED', `phone shows ${after.json.state}`);
});
await check('"I am safe" needs a PIN, and the secret PIN looks exactly like the real one', async () => {
  const start = async () => {
    const s = (await call('POST', '/sessions', fakePerson())).json;
    await call('POST', `/sessions/${s.sessionId}/confirm`, {}, { authorization: `Bearer ${s.seekerToken}` });
    return s;
  };
  const real = await start();
  const forced = await start();
  const auth = (s) => ({ authorization: `Bearer ${s.seekerToken}` });
  assert((await call('POST', `/sessions/${real.sessionId}/resolve`, {}, auth(real))).status === 403, 'no-PIN resolve allowed');
  const a = await call('POST', `/sessions/${real.sessionId}/resolve`, { pin: '1234' }, auth(real));
  const b = await call('POST', `/sessions/${forced.sessionId}/resolve`, { pin: '9999' }, auth(forced));
  assert(a.status === b.status, 'different status');
  assert(a.text.replace(real.sessionId, 'ID') === b.text.replace(forced.sessionId, 'ID'), 'different body');
  const after = await call('GET', `/sessions/${forced.sessionId}`, undefined, auth(forced));
  assert(after.json.state === 'RESOLVED', `phone shows ${after.json.state}`);
});
await check('5 SOS taps at once start only one emergency', async () => {
  const person = fakePerson();
  const results = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/sessions', person)));
  const ok = results.filter((r) => r.status === 201);
  assert(ok.length === 1, `${ok.length} started`);
  await call('POST', `/sessions/${ok[0].json.sessionId}/cancel`, { pin: '1234' }, { authorization: `Bearer ${ok[0].json.seekerToken}` });
});
await check('HTML typed into a form is shown as text, never run', async () => {
  const res = await fetch(`${BASE}/lite/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ phone: '12', name: '<img src=x onerror=alert(1)>', contact: '1', pinSafe: '1', pinDuress: '2' }).toString(),
  });
  const page = await res.text();
  assert(!page.includes('<img src=x'), 'HTML was not escaped');
});

console.log(`\n${passed} passed, ${failed.length} failed`);
process.exit(failed.length === 0 ? 0 : 1);
