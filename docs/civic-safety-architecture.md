# Aegira — Civic Safety Architecture Blueprint

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

### §3.1 Journey watch (timed check-in)

A second genesis path for the "get home safe" use case common to bSafe,
Noonlight, Kitestring, and ride-hailing safety toolkits. `WATCH_ARMED` creates a
session in **WATCHING** with a deadline; **nobody is alerted yet**.

* `CHECKIN_SAFE → RESOLVED` — the user arrives and checks in; the session ends
  quietly and is cleaned up on the normal RESOLVED → CLOSED → PURGED schedule.
  Contacts were never contacted.
* `WATCH_EXTENDED → WATCHING` — push the deadline out ("running late").
* `WATCH_ESCALATED → ACTIVE` — the deadline passed with no check-in, **or** a
  duress check-in was given. From here it is an ordinary emergency: contacts are
  alerted and responders can be dispatched.

There is deliberately **no WATCHING → CANCELLED edge**: CANCELLED stays reachable
only from PENDING (invariant 3). A watch ends benignly through CHECKIN_SAFE, not
a cancel. Location is recorded (encrypted, session-scoped) during WATCHING so the
latest fix is available the instant it escalates, but a watch is invisible to
contacts until escalation — they are not part of a journey that is going fine.

Duress discipline carries over (§8.7): a check-in with the duress PIN returns the
byte-identical response to a safe check-in and shows the coerced device a
benign **RESOLVED** timeline, while the session silently escalates to ACTIVE and
the circle is alerted with the duress flag.

### §3.2 Sessions with no location (basic-phone SOS)

A basic phone texting SOS to an ordinary SIM number gives the platform **no
position at all**: no GPS, and no carrier location without a telecom
integration. Refusing the SOS would fail exactly the users the SMS channel
exists for, so a session may start without coordinates:

* **Trusted contacts are still alerted**, told plainly "location unknown — call
  them" (just "location unknown" on a duress alert, where calling is unsafe).
* **No stranger is summoned blind.** Dispatch needs a coarse cell to match on;
  without one it fails with `LocationUnknownError`, and every channel says so
  instead of claiming help is coming. The contact SMS drops its "Reply SEND" line.
* **The first location fix makes it matchable.** If coordinates arrive later
  (e.g. an app user's GPS), the coarse cell is set and dispatch works.
* **A place in the user's own words** (`SOS near Andheri station`, a box in the
  lite and app forms) is carried as `placeNote`: at most 140 characters, stored
  inside the session's encrypted PII, shown only to trusted contacts, never in a
  responder payload or the event log, destroyed with the key on purge.

What this deliberately does **not** do is fall back to a stored location: there
is still no home area, last-known position or registration address anywhere
(invariant 1). Unknown means unknown.

### §3.3 Sound recording as evidence (opt-in, consent v8)

Comparable apps (bSafe, Himmat Plus, Google Personal Safety) capture audio or
video during an SOS, because what was said is often the only evidence. Aegira
records **sound only, only inside a session, only if the helpseeker turned it
on** at setup, where the v8 text is shown (during an emergency, the same
person can restart a stopped recording with one tap; nobody else is offered
it). This is not the
deferred "voice activation" of §2: nothing listens outside a session, and
nothing is triggered by sound.

* **When.** From the SOS press itself (browsers need that tap to open the
  microphone; pieces wait on the phone until the session exists, and are
  dropped if the SOS fails) through PENDING, ACTIVE, DISPATCHED and ARRIVED.
  Never during a journey watch: nobody has been alerted yet.
* **How it is stored.** The phone sends a piece every 5 seconds, so a snatched
  or smashed phone still leaves what was already sent. Each piece is encrypted
  under the session key (`session_audio`, incident-scoped, ciphertext only,
  `session_id NOT NULL`). Purge (CLOSED → PURGED, key destruction) makes it
  unreadable; the timer tick then sweeps the dead rows.
* **Who can listen.** The helpseeker, and trusted contacts while the emergency
  is live (they already see the precise location). Responders have no route at
  all: a voice identifies a person (invariant 6). Tests assert the negative.
* **Keeping it.** Evidence and crypto-mortality pull in opposite directions.
  The resolution: the helpseeker can save a copy to their own phone from the
  "You are safe" screen, at any time before purge. The platform keeps nothing
  past purge. A longer "evidence hold" for a police complaint would need a
  design pass (who may extend it, for how long, who can be compelled to hand
  it over) and stays out of scope.
* **Duress.** The phone stops recording (sending its last piece) before any
  PIN is sent, for the real PIN and the secret one alike, so the two still look
  identical. Uploads and listings are judged by the state the device is shown,
  so a masked session refuses and lists exactly like the benign outcome it
  pretends to be. The sound recorded up to a forced cancel is exactly what the
  circle most needs, and they keep it.
* **Limits.** 64 kB per piece, 1,440 pieces (about two hours) and 30
  recordings per session; known audio formats only; duplicates are ignored so
  retries are harmless.

### §3.4 Device-only tools: loud alarm and fake call

Two tools that never touch the server, so they collect nothing and need no
consent: a **loud alarm** (wailing tone at full volume, flashing screen,
vibration, screen kept awake) and a **fake call** (a realistic incoming call
from a name the user picks, now or after 10/30 seconds; when answered, a
synthetic voice talks with pauses). Both are on the home screen and on the
live-emergency screen.

### §3.5 Battery level for contacts (consent v7)

The phone's battery level (where the browser reports it) rides along with each
location fix, inside the same encrypted ping. Contacts see it with the
location and are warned at 15% or less: a dot that stops moving means
something different when the phone was at 4%. It is stripped from everything a
responder can see. Consent v7 replaces v1 as the session terms; it differs only
in naming the battery level.

### §3.6 Check the way before you go (link-out, no data)

Requested: public camera feeds along the route, and reviews of places, so a
person knows a place before going. Design note, reviewed against §2 and §8:

* **What ships.** On the "Going somewhere" screen, the person types where they
  are going and taps: the route, photos and reviews of the place, or the
  nearest police station, hospital, metro/bus stop or late-open petrol pump
  near it. Each tap opens Google Maps in a new tab. The destination lives only
  in a page variable: it is never sent to Aegira, never written to the phone's
  storage, and never logged. There is no location outside a session
  (invariant 1) because Aegira never receives one.
* **Public camera links: refused.** Indian Safe City camera feeds go to police
  control rooms, not the public. The "live public camera" sites that exist list
  privately owned cameras left on default passwords (the Insecam pattern);
  linking them would make Aegira a tool for watching people, women included,
  without their knowledge. Showing where cameras are also tells an attacker
  where they are not.
* **Aegira-hosted place reviews: not built.** Safety ratings written by our
  users are the community heatmap of §2 under another name: they stigmatise
  neighbourhoods (often along caste, religion or class lines), invite fake
  reviews and defamation, and map isolated spots for an attacker. They also
  need accounts and moderation we do not have. Google's existing reviews cover
  "what is this place like" without Aegira holding any of it.
* **Not during an emergency.** The card is on the planning screen only. During
  a live session, leaving the app can pause location updates and sound
  recording on some phones, so the live screen keeps the helplines and the
  device-only tools instead.
* **Honest limits.** Reviews and Street View photos can be years old and are
  not safety ratings. The card says so.

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
* **incident-scoped** — session rows, encrypted PII, encrypted location pings,
  encrypted sound recordings. Readable only while the session key lives; swept
  after PURGED.
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
7. **Coercer forcing a journey check-in** (§3.1) — an attacker who knows the
   victim armed a watch may force them to "check in safe." Mitigated exactly like
   the duress cancel: the duress PIN at check-in returns the identical response
   and shows a benign RESOLVED timeline, while the session silently escalates to
   ACTIVE and the circle is alerted.
8. **Coercer forcing "I'm safe" mid-emergency** — once help is in motion, the
   attacker's remaining lever is a forced "all clear". Resolving a live
   emergency (ACTIVE, DISPATCHED, ARRIVED) therefore always needs a PIN, on
   every channel (app, lite, SMS); a device token alone cannot end it. The
   safe PIN resolves. The duress PIN returns the identical response and shows
   the benign RESOLVED timeline on the device, while the real state is
   unchanged (any helper keeps coming), an `ESCALATION_RAISED` self-loop with
   `reason: duress_resolve` is recorded, and the circle gets a duress alert.
   Re-alert self-loops do not restart the escalation or arrival-timeout
   clocks, and public counters move exactly as for a real resolve.
   (Earlier drafts answered a duress PIN here as a "wrong PIN"; that was
   distinguishable from success, so it failed invariant 4.)
9. **Coercer probing the device after a duress PIN** — someone holding the
   phone sends a location update or a sound piece by hand to see whether the
   session is "really" over. Both routes answer by the state the device is
   shown, so a masked session refuses exactly like a real cancel or resolve
   (earlier, a location after a real cancel crashed with a 500 while a masked
   one was accepted: distinguishable). A location that still reaches a live
   emergency is kept for the contacts.
10. **Recording turned against the helpseeker** — mitigated by: opt-in only,
   never outside a session, contacts chosen by the helpseeker alone, no
   responder access, destroyed at purge, and the "save a copy" button being the
   only way it outlives the session.

## §9 Open questions (tracked, not yet designed)

Resolved since first draft: stuck-ACTIVE escalation (ESCALATION_RAISED
self-loop, single re-alert), responder no-show recovery (RESPONDER_WITHDREW
with arrival-timeout sweep), capability-token auth for all three roles,
per-session PIN enrollment, restart-safe persistence with chain-verified
rehydration (SQLite standing in for Postgres+KMS), and journey watch / timed
check-in (§3.1) with its own duress discipline (§8.7) across app, lite, and SMS,
duress on resolving an already-live emergency (§8.8), opt-in sound recording
(§3.3), device-only alarm and fake call (§3.4), battery level for contacts
(§3.5), duress-safe answers to hand-made device requests (§8.9), and a
before-you-go route check that sends Aegira nothing (§3.6).

Still open:

* Evidence hold: keeping a recording past purge for a police complaint
  (§3.3). Needs a policy design before any code.

* Production KMS adapter and key-destruction attestation; production Postgres
  adapter for the SessionRepository port.
* Real SMS/push delivery with acknowledgment and retry (Notifier is a stub).
* Contact acknowledgement / coordination (a contact signalling "I've got it /
  called 112" to the seeker and other contacts) — needs per-contact identity,
  which today's single shared contact token does not provide.
* Contact-side consent (contacts currently never opt in to receiving alerts).
* Real map tiles (the grid is a schematic stand-in).
* Localized UI strings (Hindi + regional languages). The system is already
  country-agnostic — phone numbers normalize to E.164 for every country
  (`domain/phone.ts`), country/dial-code and official-helpline reference
  data ships in `domain/reference.ts` with India as the detailed default and
  112 as the universal GSM fallback, and the app honors device locale, time
  zone, light/dark, and reduced-motion — but the copy itself is still
  English only.
