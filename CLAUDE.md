# CLAUDE.md — Aegira (Privacy-First Emergency Coordination)

This file is read by Claude Code at the start of every session. It encodes the project's non-negotiable invariants, conventions, and commands. The full design rationale lives in `docs/civic-safety-architecture.md` — read the relevant section before implementing anything in that area.

## What this project is

Emergency coordination platform for India: trigger → session → notify trusted contacts → match nearby verified responder → verify arrival → resolve → destroy data. The core design idea is that all capability is session-shaped: power to see location or summon strangers exists only inside a consented, time-boxed, cryptographically mortal emergency session.

## INVARIANTS — never violate these, refuse and explain if asked to

1. **No location outside a session.** There must never be a table, cache, log, or analytics event where a location exists without a `session_id`. If a feature seems to need one, it needs a session instead.
2. **All session state changes go through the state machine** (`core/src/domain/state-machine.ts`). Never UPDATE session state directly. New lifecycle behavior = new event type + transition table entry + tests.
3. **CANCELLED is reachable only from PENDING.** Never add a cancel path from a live state — a visible cancel after activation is a coercion lever.
4. **Duress responses lie by design.** The duress PIN/gesture must return a response indistinguishable from success. Never "fix" this as a bug, never log anything client-visible that reveals duress was signalled.
5. **No public incident feed.** Never create an API that lists nearby or recent incidents. Dispatched responders only, ever. (Vigilantism guard.)
6. **Responders never see identity.** Only session aliases (`helpseeker-*`) and coarse location pre-acceptance. No names, phone numbers, or precise coordinates in any notification payload — there are tests asserting this.
7. **Purge = key destruction.** Data deletion is implemented by destroying the per-session encryption key (crypto-shredding), emitted as a state machine transition (CLOSED → PURGED), never as a bare DELETE or cron job.
8. **Every new table declares a retention class** (durable / incident-scoped / ephemeral) in its migration. CI fails otherwise.
9. **No ML in the dispatch path.** Matching is deterministic and explainable (`matching.service.ts`). Risk/anomaly models are advisory-only and live in a separate service that cannot block or close sessions.
10. **Strikes, not scores.** Misbehavior creates discrete, human-reviewable, appealable strike records. Never aggregate into a hidden numeric reputation.
11. **New data collection requires a versioned consent text** recorded in `CONSENT_RECORD`. No silent scope expansion.

## Architecture map

* `core/src/domain/` — pure TypeScript, ZERO framework imports. State machine, session aggregate (hash-chained event log), types. Fully unit-testable.
* `core/src/crypto/` — per-session AES-256-GCM envelope encryption (`shredder.ts`). In-memory vault stands in for KMS; same interface.
* `core/src/services/` — orchestration (SessionService owns timers via injected Clock + explicit `evaluateTimers(now)`), deterministic matching, notification (stub implements the production `Notifier` interface).
* `core/src/api/` — thin NestJS controllers. No logic in controllers.
* `core/test/` — vitest. State machine tests are EXHAUSTIVE (every legal transition asserted, every illegal pair proven to throw). Keep it that way: any transition-table change must update `legalTransitions()` assertions.

## Commands

```bash
cd core
npm install            # fresh install; node_modules is never committed
npm test               # vitest — must be green before any commit
npm run typecheck      # tsc --noEmit
npm run build && npm start   # boots on :3000
```

Dev PINs (dev wiring only, `app.module.ts`): safe=1234, duress=9999.

## Conventions

* Domain layer stays dependency-free; if you need a framework import in `domain/`, the design is wrong.
* Time is injected (`Clock`), never `Date.now()` inside domain/services — all timer behavior must be testable with a manual clock.
* Events are append-only and hash-chained; never mutate a recorded event.
* Tests for any privacy property assert on the NEGATIVE (what must not appear in payloads), not just the positive.
* Prefer extending an existing event with properties over inventing near-duplicate event types.
* TypeScript strict mode; no `any` in domain or services.

## What is deliberately NOT built yet (do not add without a design pass)

Disaster/broadcast mode, child geofencing/guardian hierarchy, numeric trust scores, voice activation, medical profiles, government integrations, community heatmaps. Each is deferred in §2 of the blueprint with reasons. If asked to add one, first re-read §2 and the threat model (§8), then write a short design note before any code.

## Definition of done for any PR

1. `npm test` and `npm run typecheck` green.
2. New transitions/timers covered by deterministic clock tests.
3. No invariant above violated (re-read the list).
4. If a notification payload changed: privacy-negative tests updated.
5. If schema changed: retention class declared + purge path verified.
