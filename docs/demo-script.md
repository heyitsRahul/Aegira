# Demo & founder video scripts

YC wants two short videos. Keep both unpolished and fast — phone-recorded is
fine. Substance over production value.

---

## A. Product demo (~90 seconds, screen recording)

Record your screen on the deployed URL. Pre-open two browser windows side by
side: **Window L = help seeker** (`/app`), **Window R = trusted contact**
(`/app`, switch role → contact). Keep `/console` in a third tab for the duress
reveal.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:10 | Landing `/` | "Aegira is emergency help that works on any phone without surveillance. Your location never exists outside a live session." |
| 0:10–0:25 | L: app home → tap **SOS** → countdown | "I trigger an SOS. There's a 30-second cancel window for accidents." |
| 0:25–0:40 | R: contact gets the alert + live map | "My trusted contact is alerted with a live link — but notice the responder side never sees my name or exact spot, just an alias and a ~1 km area." |
| 0:40–0:55 | R: **Dispatch** → responder accepts → L: arrival code | "A nearby verified responder accepts. Arrival is confirmed by a code I show them in person — so no stranger can fake reaching me." |
| 0:55–1:05 | L: **I am safe** → resolved | "I mark myself safe. The session resolves and its data will be cryptographically destroyed." |
| 1:05–1:20 | New session → enter **duress PIN 9999** → looks cancelled; flip to `/console` showing real state ACTIVE | "Here's the part that matters under coercion: the duress PIN shows a convincing 'cancelled' screen — while the server is actually escalating and my circle is being warned. The lie is deliberate." |
| 1:20–1:30 | `/phone` SMS sim: text `SOS` | "And it all works over plain SMS, for the phones that aren't smartphones." |

Close on the landing page URL.

### Optional 20s add-on — journey watch
"Going home alone? I arm a timer. If I don't check in safe by the deadline, my
circle is automatically alerted — and a coercer who forces me to 'check in' with
my duress PIN is silently escalated, just like cancel."

---

## B. Founder video (~60 seconds, you talking to camera)

YC's own guidance: just answer, plainly. Hit these beats:

1. **Who you are** (10s) — name, what you've built before, why you can build this.
2. **The problem, from the user** (15s) — the specific person (a woman commuting
   late, a gig worker, a student) and why existing apps fail them: they trade
   safety for surveillance and don't work on basic phones.
3. **What Aegira does** (15s) — one sentence + the one insight: *for the people
   who need safety tools most, the surveillance is itself the threat,* so we made
   privacy architectural and reach every phone.
4. **Traction / what's next** (15s) — what's built, and your beachhead: "we're
   piloting with [campus / gig platform / NGO] to get our first N protected
   users." Name a real number if you have one.
5. **The ask** (5s) — what you want from YC.

### Don't
- Don't read a script word-for-word or over-edit.
- Don't claim users you don't have — YC checks.
- Don't spend more than 60s. They watch a lot of these.

---

## Checklist before recording
- [ ] Live URL deployed (see `deploy.md`)
- [ ] Seeded a couple of demo sessions so the funnel/dashboard isn't empty
- [ ] Practiced the duress reveal once (the `/console` flip is the "wow")
- [ ] Quiet room, phone propped up, one take is fine
