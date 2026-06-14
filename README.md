# Sahay — privacy-first emergency coordination

**Help, on any phone, without becoming a surveillance system.** Sahay turns a
trigger into a consented, time-boxed, cryptographically mortal *session*: the
power to see someone's location or summon a stranger exists only inside that
session, and is destroyed when it ends.

> Status: working prototype. The domain, lifecycle, crypto-shredding, auth, and
> three access channels are real and tested (282 tests). The SMS provider, KMS,
> and responder network are pluggable stubs — see [What's real vs. stub](#whats-real-vs-stub).

## Why it's different

- **Session-shaped capability.** No location ever exists outside a session — not
  in a table, cache, log, or analytics event. ([invariants](CLAUDE.md))
- **Crypto-mortal data.** Deletion = destroying the per-session key
  (crypto-shredding). What the platform can't decrypt, it can't leak or be
  subpoenaed for.
- **Duress by design.** A duress PIN returns a response *indistinguishable* from
  success while silently escalating — for cancel and for journey check-in.
- **Works on every phone.** Smartphone app (PWA), a zero-JavaScript web version
  for old browsers, and a full **SMS gateway** for phones with no browser at all.
- **No vigilante feed, no trust scores, deterministic dispatch.** Coordination,
  not surveillance.

## Three ways to use it

| Channel | For | Route |
|---|---|---|
| App (PWA) | smartphones | `/app` |
| Lite web (no JS) | old/low-end browsers | `/lite` |
| SMS | any phone, no internet | `POST /gateway/sms` (sim at `/phone`) |

Plus an ops console at `/console` showing the server-truth view (duress mask vs.
reality) — dev only.

## Quickstart

```bash
cd core
npm install
npm test            # 282 tests
npm run build && npm start    # http://localhost:3000
```

Node 22+ required (uses the built-in `node:sqlite`). Dev PINs: safe `1234`,
duress `9999`.

## Deploy a live instance

```bash
# Docker (build context = repo root)
docker build -t sahay . && docker run -p 3000:3000 sahay

# Fly.io
fly launch --copy-config --now    # uses fly.toml
```

Set these to go from demo to real:

| Env var | Effect |
|---|---|
| `SAHAY_DB` | SQLite path (default `core/var/sahay.db`; `:memory:` for ephemeral) |
| `SAHAY_BASE_URL` | base for contact live-links in alerts |
| `SAHAY_GATEWAY_SECRET` | shared secret for the JSON SMS webhook |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | real outbound SMS; Twilio inbound webhook at `/gateway/twilio` |

With no Twilio env set, SMS falls back to the in-memory stub (the `/phone`
simulator) so the demo still works.

## Architecture

```
core/src/domain/      pure TS: state machine, hash-chained session log, phone/geo/reference
core/src/crypto/      per-session AES-256-GCM envelope encryption + crypto-shred
core/src/services/    orchestration, deterministic matching, notification, SMS, registration, metrics
core/src/persistence/ SessionRepository port + SQLite adapter (Postgres-shaped)
core/src/api/         thin NestJS controllers (app, lite, gateway, reference, waitlist, metrics)
core/public/          landing, app, lite assets, feature-phone simulator, ops console
core/test/            vitest — exhaustive state machine + privacy-negative + hygiene tests
```

Full design rationale and threat model: [docs/civic-safety-architecture.md](docs/civic-safety-architecture.md).
The pitch: [docs/pitch.md](docs/pitch.md).

## What's real vs. stub

| Real & tested | Stubbed (pluggable interface ready) |
|---|---|
| Session lifecycle + exhaustive state machine | SMS delivery (`StubSmsTransport` / Twilio adapter ready) |
| Per-session crypto-shredding | KMS (`InMemoryKeyVault`; same `KeyVault` interface) |
| Capability-token auth (3 roles) | Responder network (seeded roster) |
| Duress (cancel + journey check-in) | Push notifications |
| Journey watch / timed check-in | Production Postgres (SQLite adapter today) |
| E.164 phone, country/helpline data | Official-services (112) integration |
| Restart-safe persistence, chain-verified | — |

## License

Not yet licensed — all rights reserved pending a decision. (See [docs/yc-application.md](docs/yc-application.md).)
