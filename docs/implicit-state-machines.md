# Implicit state machines in Aegira

Aegira has one official state machine: the emergency session lifecycle in
`core/src/domain/state-machine.ts` (WATCHING, PENDING, ACTIVE, DISPATCHED,
ARRIVED, RESOLVED, CANCELLED, CLOSED, PURGED). Every change to it goes
through a transition table, and the tests prove every legal and illegal move.

An *implicit* state machine is anything else that moves through states over
time, held in flags, counters, timers or phone storage instead of that table.
They are where bugs hide, because nothing checks their moves. This is the full
list as of 2026-11-12, what drives each one, and what the audit found.

Result: 20 found. 6 had bugs (7 in all), each fixed with tests. 1 open design question.

## On the server

| # | Machine | Where | States and what moves them | Verdict |
| --- | --- | --- | --- | --- |
| 1 | **Duress mask** (the fake timeline a coerced phone sees) | `session.service.ts` `duressMask`, `simulatedMaskedState` | none, then CANCELLED or RESOLVED, then CLOSED, then PURGED, moved only by time since the duress PIN | **Fixed.** Hand-made requests could tell a fake ending from a real one (see below). |
| 2 | **Helper assignment** | `offeredResponderIds`, `acceptedResponderId`, `arrivalCode`, `arrivalAttempts` | not offered, offered, accepted (code issued), then arrived or withdrawn (by choice or arrival timeout). Locked after 3 wrong codes | OK. Moves only alongside lifecycle events. One open question for duress sessions (below). |
| 3 | **Journey deadline** | `watchDeadlineIso` | set at start, pushed out by "more time", cleared by check-in or escalation | OK |
| 4 | **"Nobody accepted" re-alert** | timer sweep, read from the event log | not sent, sent; once per session | OK. Deliberately once only. |
| 5 | **Location window** | `recordLocation` | accepted while the phone shows a live state, refused after | OK (fixed in an earlier round) |
| 6 | **Recording window** | `evidence.service.ts` | accepting, closed, unreadable after purge, swept | OK |
| 7 | **Session key** | `crypto/shredder.ts` | live, shredded (purge), then its leftovers swept | OK |
| 8 | **Strike review** | `strike.service.ts` | open, then upheld or dismissed; upheld goes back to open only by appeal | **Fixed.** A decision could be silently flipped, and appealing a dismissed strike reopened it, taking the helper off dispatch again. |
| 9 | **Daily SMS budget** | `sms-guard.ts` | counters per number and in total, reset at UTC midnight | **Fixed.** Replies to anyone who texts us could spend the whole day's texts, leaving none for a real emergency alert. Alerts now keep a reserve (30 of 100). |
| 10 | **SMS sign-up and JOIN** | `registration.service.ts`, `sms-optin.service.ts` | not registered, registered, deleted by STOP; contact not joined, joined | OK |
| 11 | **One live emergency per person** | `createSession` | blocked while a real one is live; a faked ending never blocks | OK |

## On the phone (`core/public/app.html`)

| # | Machine | States and what moves them | Verdict |
| --- | --- | --- | --- |
| 12 | **Which screen** | role picker, setup, edit circle, home, emergency, contact, helper; moved by taps and the address bar | OK |
| 13 | **The phone's copy of the emergency** (`aegira.session` in phone storage) | asked for a helper, no helpers near, a helper was on the way, how it ended, recorded | **Fixed twice.** If a helper backed out, "Ask a trained helper" never came back; and after "I am safe", the screen later said "Cancelled. Nobody was told." |
| 14 | **Recorder** | off, recording before the session exists (pieces wait), attached, stopping, stopped; always stops before a PIN is sent | OK |
| 15 | **Following GPS** | off, following while live, off | OK, with a known trade-off: after a duress cancel the phone must look cancelled, so it stops sending location. Contacts keep the last fix. |
| 16 | **Helper's job screen** | offer, accepted with map, taken by someone else, arrived, done | **Fixed.** A helper withdrawn by the server (arrival timeout) kept seeing the map and code box forever. It now says the job is no longer theirs and stops asking. |
| 17 | **Fake call** | idle, waiting to ring, ringing, talking, ended | **Fixed.** A waiting call could not be stopped, two could stack, and one could ring over a fresh SOS screen. Pressing SOS now stops a call that has not rung yet. |
| 18 | **Loud alarm** | off, on (screen kept awake) | OK |
| 19 | **Contact's listen panel** | players added as recordings arrive, kept across refreshes | OK |
| 20 | **Before-you-go card** | typed destination, warning shown; never stored or sent | OK |

## The serious one: telling a fake ending from a real one

The secret (duress) PIN makes the phone show a normal ending while help keeps
coming. The phone's own status was protected, but other requests were not.
Someone holding the phone after a forced cancel could send "I am safe" with
the same PIN, by app, the basic web page or SMS. After a real cancel that is
refused. After a forced one it answered "You are safe". Asking for a helper,
confirming, and reading the arrival code leaked the same way.

Now every request the phone can make answers exactly as it would after a real
ending, at every point of the timeline. `test/duress-hand-made.test.ts`
checks every route side by side, real against forced, over a week of simulated
time. The new tests fail on the old code and pass on the new. Two exceptions
are deliberate and invisible to the person holding the phone:

- The person's real safe PIN still ends the live emergency for good.
- Using the secret PIN again quietly warns their people again.

## Open question

**A helper's arrival after a forced cancel.** The arrival code is shown on the
person's phone, and after a forced cancel that phone shows "Cancelled", so it
never shows a code. A helper sent by a contact can reach the person but cannot
record that they arrived, and is withdrawn when the arrival timer runs out.
This needs a way to confirm arrival that does not go through the coerced
phone, for example through the contact who sent the helper. Tracked in §9 of
`civic-safety-architecture.md`.

## Keeping it this way

- New behaviour over time on a session is a new event in the official state
  machine, not a new flag (invariant 2).
- Anything the helpseeker's phone can ask must answer by the state the phone
  is shown (`clientStatus`), never the real one. Add the new route to
  `probe()` in `test/duress-hand-made.test.ts`.
- On the phone, store facts the server cannot be asked again (how it ended),
  and reset them from what the server says, never from local guesses.
