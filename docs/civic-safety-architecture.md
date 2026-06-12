# Sahay — Civic Safety Architecture Blueprint

Design rationale for the privacy-first emergency coordination platform. CLAUDE.md
holds the condensed invariants; this document explains why they exist and how the
pieces fit. Section numbers are stable — CLAUDE.md references §2 (deferred
features) and §8 (threat model) by number.

## §1 Core thesis: capability is session-shaped

Every dangerous capability in this system — seeing someone's location, summoning a
stranger to them, reading their name — exists only inside an emergency session
that is:

* **consented** — created by the helpseeker's own trigger, under a versioned
  consent text recorded in the genesis event;
* **time-boxed** — driven to closure by timers (`evaluateTimers(now)`), never
  open-ended;
* **cryptographically mortal** — all sensitive payloads are encrypted under a
  per-session key whose destruction (crypto-shredding) is the purge mechanism.

There is no "platform-level" location store, no standing track of anyone, no
ambient visibility. If a feature seems to need a location outside a session, the
feature actually needs a session.

## §2 Deliberately deferred features

Each of these is deferred because its harm modes need a design pass, not because
it is hard to build. Do not implement without a written design note reviewed
against §8.

| Feature | Why deferred |
| --- | --- |
| Disaster/broadcast mode | One-to-many alerts invert the consent model and create panic/vigilantism amplification paths. |
| Child geofencing / guardian hierarchy | Persistent tracking of a person who did not consent themselves; guardianship disputes become surveillance disputes. |
| Numeric trust scores | Hidden aggregates are unappealable and discriminatory in practice; strikes (discrete, reviewable) are the chosen mechanism. |
| Voice activation | Always-on microphones are a standing privacy cost for a rare benefit; false-trigger rate weaponizes dispatch. |
| Medical profiles | Durable sensitive health data outlives sessions by definition; contradicts crypto-mortality until a separate vault design exists. |
| Government integrations | Data-sharing pressure, subpoena surface, and mission creep; needs a legal/policy review first. |
| Community heatmaps | Aggregated incident locations re-identify neighborhoods and individuals; also a vigilantism map. |

## §3 Session lifecycle

States: `PENDING → ACTIVE → DISPATCHED → ARRIVED → RESOLVED → CLOSED → PURGED`,
with `PENDING → CANCELLED → CLOSED → PURGED` as the only cancel path.

* **PENDING** is the cancel window (default 30 s). It exists so accidental
  triggers cost nothing. It auto-activates on countdown so an interrupted victim
  still gets help.
* **CANCELLED is reachable only from PENDING.** After activation there is no
  visible cancel: if a cancel-after-activation existed, an attacker's first demand
  would be "cancel it." Resolution requires the flow a coercer cannot fake
  silently (responder arrival / contact involvement).
* **Duress PIN** (§8.3): entering the duress PIN where the safe PIN is expected
  returns a response byte-identical to success, while the session silently
  activates and contacts are alerted with a duress flag. The coerced device's view
  simulates the full timeline a genuine cancel would show (CANCELLED, then CLOSED,
  then PURGED on schedule).
* **CLOSED → PURGED** is a state-machine transition whose handler destroys the
  per-session key. Purge is auditable in the event chain; deletion is never a
  bare DELETE or an out-of-band cron.

The transition table in `core/src/domain/state-machine.ts` is the single source
of truth; the test suite asserts every legal transition and proves every other
(state, event) pair throws.

## §4 Event log

Append-only, hash-chained (SHA-256 over canonical JSON, each event carrying the
previous hash). The chain survives purge — it carries no identity and no
coordinates, only lifecycle facts — so audits remain possible after the data is
cryptographically dead. Tampering or dropping any recorded event breaks
verification.

## §5 Data classes and retention

Every table declares one of three retention classes in its migration (CI-enforced):

* **durable** — lifecycle audit chain, responder directory, strikes, consent
  texts. Carries no identity-linked location, ever.
* **incident-scoped** — session rows, encrypted PII, encrypted location pings.
  Readable only while the session key lives; swept after PURGED.
* **ephemeral** — caches and queues; never the system of record.

Location rows have `session_id NOT NULL` and store only ciphertext. There are no
plaintext coordinate columns anywhere in the schema.

## §6 Dispatch

Matching is deterministic and explainable: filter (identity-verified, no open or
upheld strike, within N coarse cells), order by cell distance with lexicographic
id tie-break, cap at the offer limit. Every candidate carries human-readable
reasons. No model may block, reorder, or close dispatch — risk models, if added,
are advisory and live in a separate service.

Responders see: session alias (`helpseeker-xxxxxxxx`), coarse ~1 km cell,
category. Precise location is released only to the single accepted responder,
only while DISPATCHED, through an authenticated pull — never in a notification
payload. Arrival is verified by a code physically shown by the helpseeker.

## §7 Notifications

Two payload types, both closed shapes (no index signatures):

* **Contact alert** — to the helpseeker's own trusted contacts: name (contacts
  know them), category, a session-scoped live link, duress flag. Never raw
  coordinates: an SMS at rest must not carry a position.
* **Responder offer** — alias, coarse cell, category. Identity-free by
  construction and by privacy-negative tests.

## §8 Threat model

1. **Stalker / abusive partner** — wants standing location access. Mitigated by:
   no location outside sessions, session mortality, contact lists chosen by the
   helpseeker alone.
2. **Vigilante mob** — wants to know "what's happening near me." Mitigated by: no
   incident feed of any kind, responder offers only to dispatched, vetted
   responders, coarse cells pre-acceptance.
3. **Coercer present at the device** — forces cancellation or "I'm safe"
   signals. Mitigated by: no cancel after activation, duress PIN with
   indistinguishable responses, masked timeline simulation.
4. **Predatory responder** — uses the platform to reach victims. Mitigated by:
   identity verification, no helpseeker identity pre-arrival, arrival codes,
   discrete reviewable strikes, dispatch radius limits.
5. **Data breach / subpoena of the platform itself** — mitigated by per-session
   envelope encryption and crypto-shredding: what the platform cannot decrypt,
   it cannot leak or surrender.
6. **Insider misuse** — mitigated by the same session-scoped keys, the
   append-only audit chain, and ops views that never include payload plaintext.

## §9 Open questions (tracked, not yet designed)

* Auto-resolution / escalation for sessions stuck in ACTIVE with no responder
  acceptance (currently they wait for human resolution).
* Duress semantics on the resolve flow (coerced "I'm safe"): likely a duress
  variant of resolve mirroring the cancel design.
* Production KMS adapter and key-destruction attestation.
* Offline/SMS-fallback trigger paths for low-connectivity areas.
