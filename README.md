# Aegira — privacy-first emergency coordination

[![ci](https://github.com/heyitsRahul/Aegira/actions/workflows/ci.yml/badge.svg)](https://github.com/heyitsRahul/Aegira/actions/workflows/ci.yml)

**Help on any phone, without becoming a surveillance system.**

Aegira turns an SOS into a consented, time-boxed, *cryptographically mortal*
session. The power to see someone's location or summon a stranger exists only
inside that session, and is destroyed when it ends. It works as a smartphone
app, as a no-JavaScript web page for old browsers, and over plain SMS for
phones with no internet at all.

**Live demo:** _coming soon_ · **Design doc:** [civic-safety-architecture.md](docs/civic-safety-architecture.md) · **Pitch:** [pitch.md](docs/pitch.md)

> ⚠️ **This is a working prototype, not an emergency service.** No real
> responders are connected and no real SMS is sent. In danger, call your local
> emergency number (112 in India and the EU).

<p>
  <img src="docs/screenshots/app-home.jpg" width="200" alt="Role picker: I need help, I watch over someone, I'm a verified helper">
  <img src="docs/screenshots/app-sos.jpg" width="200" alt="SOS screen with category chips and local helplines">
  <img src="docs/screenshots/app-countdown.jpg" width="200" alt="30-second countdown with PIN cancel">
  <img src="docs/screenshots/phone-sms.jpg" width="200" alt="Basic-phone SMS simulator">
</p>

---

## Try it in two minutes

Open the live demo (or run it locally, below), then:

1. **Call for help** — open `/app`, pick a language (English or हिंदी), choose
   *I need help*, and press **SOS**. A 30-second countdown starts; enter PIN
   `1234` to cancel it, or let it run.
2. **See the duress PIN lie** — trigger SOS again and "cancel" with PIN `9999`.
   The screen says *cancelled*. Now open `/console`: the server truth shows the
   session is still live and your contacts were told it's a duress alert.
3. **Use it with no smartphone** — open `/phone`, a basic-phone simulator.
   Text `REG Asha 9876543210 1234 9999`, then `SOS`. Switch the number to
   `9876543210` to see the alert your trusted contact receives.
4. **Try the journey watch** — in the app, choose *Watch my journey*. If you
   don't check in before the timer ends, your contacts are alerted.
5. **Old browser?** `/lite` is the same flow with zero JavaScript.

## What makes it different

| Principle | How it's enforced |
|---|---|
| **No location outside a session** | No table, cache, log or analytics event holds a location without a session id. Tests scan for it. |
| **Deletion you can trust** | Each session has its own AES-256-GCM key. Purging destroys the key (crypto-shredding), so the data is unreadable even in backups. |
| **Duress by design** | A duress PIN returns a response byte-for-byte identical to a real cancel or check-in, while silently escalating. |
| **No cancel after activation** | Once help is in motion there is no "cancel" button an attacker can force you to press. |
| **Responders never see identity** | Before accepting, responders see an alias and a ~1 km area only. Privacy-negative tests assert names, numbers and exact coordinates never appear. |
| **No vigilante feed, no trust scores** | No API lists nearby incidents. Misbehaviour creates reviewable strikes, never a hidden score. Matching is deterministic, no ML. |
| **Works for everyone** | PWA, zero-JS web, SMS gateway; E.164 phone handling and helplines for every country; Hindi + English UI with icon-first screens and spoken prompts. |

These are written down as [11 non-negotiable invariants](CLAUDE.md) and
enforced by the test suite in CI.

## Engineering highlights

- **Exhaustive state machine.** 9 session states, 14 event types. Every legal
  transition is asserted and every illegal pair is proven to throw.
- **Hash-chained event log.** Sessions are rebuilt from an append-only,
  hash-chained log; tampering fails verification on reload.
- **Deterministic time.** Countdowns, escalation, auto-close and purge all run
  off an injected clock, so every timer is tested without sleeping.
- **Capability tokens, not accounts.** Help-seeker, contact and responder each
  get a scoped token, stored hashed and compared in constant time.
- **Production lock-down.** In production, secrets have no dev fallbacks, the
  ops console and simulators can be switched off, and a public demo can never
  send real SMS.
- **310 tests**, typecheck and build in GitHub Actions on every push.

**Stack:** TypeScript (strict), NestJS, Node 22 built-in SQLite, Vitest,
vanilla JS PWA, Twilio adapter, Docker, Render / Fly.io.

## Architecture

```
core/src/domain/       pure TS, zero framework imports: state machine, session aggregate, phone/geo
core/src/crypto/       per-session envelope encryption + crypto-shred (KMS-shaped interface)
core/src/services/     orchestration, deterministic matching, notifications, SMS gateway, metrics
core/src/persistence/  repository port + SQLite adapter (Postgres-shaped)
core/src/api/          thin NestJS controllers, runtime config
core/public/           landing, PWA, feature-phone simulator, ops console, founder dashboard
core/test/             Vitest: state machine, privacy-negative, hygiene, clock-driven timers
```

## Run it locally

```bash
cd core
npm install
npm test                      # 310 tests
npm run build && npm start    # http://localhost:3000
```

Requires Node 22+. Demo PINs: safe `1234`, duress `9999`.

## Deploy

- **Free public demo:** [render.yaml](render.yaml) — on render.com choose
  *New → Blueprint* and pick this repo. See [docs/publish.md](docs/publish.md).
- **Durable deployment:** [fly.toml](fly.toml) with a persistent volume. See
  [docs/deploy.md](docs/deploy.md).

| Env var | Effect |
|---|---|
| `AEGIRA_DEMO` | `off` hides the ops console, simulators and dev endpoints (default on) |
| `AEGIRA_ADMIN_TOKEN` | password for `/admin`; in production, unset = dashboard locked |
| `AEGIRA_GATEWAY_SECRET` | secret for the JSON SMS webhook; in production, unset = closed |
| `AEGIRA_BASE_URL` | base URL for contact links (auto-detected on Render) |
| `AEGIRA_DB` | SQLite path (`:memory:` for throwaway) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | real SMS (ignored in demo mode) |

## What's real and what's a stand-in

| Real and tested | Stand-in (interface ready to swap) |
|---|---|
| Session lifecycle and state machine | Responder network (two seeded demo responders) |
| Per-session crypto-shredding | KMS (`KeyVault` backed by SQLite) |
| Capability-token auth for 3 roles | SMS delivery (stub; Twilio adapter built) |
| Duress for cancel and journey check-in | Push notifications |
| Journey watch with timed check-in | Postgres (SQLite adapter today) |
| Phone numbers and helplines for every country | Official 112 integration |
| Restart-safe, chain-verified persistence | — |

## License

All rights reserved. The code is public for review; please ask before reuse.
