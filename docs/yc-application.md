# YC application — working draft

Drafted from what exists in this repo. **Bracketed `[FILL IN]` items are things
no codebase can produce — they decide the application and only you can supply
them.** Be terse and concrete; YC rewards plain, specific answers.

> ⚠️ Honesty check before you submit: the three questions that will sink or save
> this application are **users, team, and "why you."** Everything else is ready.

---

### Company name
Aegira

### What is your company going to make? (≤50 chars in the form; longer below)
Privacy-first emergency help that works on any phone — even over SMS — without
ever storing your location outside a live, self-destructing session.

### Describe what your company does in 50 characters or less.
`Help on any phone, without surveillance.` (40)

### Company URL / demo
- Live demo: `[FILL IN deployed URL]` (app at `/app`, SMS sim at `/phone`)
- Demo video: `[FILL IN — 1–2 min screen recording of the SOS, duress, and journey-watch flows]`

### How far along are you?
Working prototype across three channels (app, no-JS web, SMS), 282 automated
tests, deployable via Docker/Fly. Real session lifecycle, per-session
crypto-shredding, duress handling, capability-token auth, journey watch.
Not yet launched to real users. `[FILL IN any pilot/users once you have them]`

### Are people using your product? How many users? Revenue?
`[FILL IN — today: none. Get 10–50 real users in one beachhead before applying;
state the number, weekly-active, and retention.]`

### How long have you been working on this?
`[FILL IN]`

### Tech: how does it work / what have you built?
Capability is "session-shaped." A trigger opens a consented, time-boxed session
holding a per-session AES-256-GCM key; identity and precise location live only as
ciphertext under that key. Deletion = destroying the key (crypto-shredding),
emitted as an auditable state-machine transition over a hash-chained event log.
Responders see only a session alias and a ~1 km cell until they accept; precise
location is released to exactly one accepted responder. A duress PIN returns a
response byte-identical to success while silently escalating. Three channels
share one core; SMS makes it work on phones with no internet.

### What's new about what you're making? / What do you understand that others don't?
Every other safety app treats privacy and speed-of-help as a trade-off and
solves it with standing surveillance + an incident feed. We make privacy
*architectural* (no location outside a session, crypto-mortal data, duress that
lies) and reach the basic phones incumbents ignore. The insight: for the people
who need safety tools most, the surveillance *is* the threat.

### Who are your competitors? Why you?
bSafe, Noonlight, Life360, Citizen, government 112 apps. `[FILL IN why you win:
team, distribution wedge, the privacy+reach combination, execution speed.]`

### How will you make money? Market size?
B2B2C: campuses, gig platforms, and employers pay per protected person; consumer
tier free to grow the network. TAM `[FILL IN — size your beachhead bottoms-up:
# campuses/platforms × seats × price, then expand.]`

### Founders
`[FILL IN — names, who's technical, full-time?, equity split, how long you've
known/worked together, and the most impressive thing each of you has built.
If solo, name your plan to find a co-founder — YC will push hard on this.]`

### What's the biggest risk, and how do you de-risk it?
Two real ones, stated plainly:
1. **Responder marketplace cold-start** — `[FILL IN bootstrap plan: partner an
   existing guard/NGO/volunteer network in one geography first.]`
2. **Liability if dispatch fails** — `[FILL IN: position as coordination + 112
   handoff, not a 911 replacement; insurance/legal plan.]`

### Why did you pick this idea? Domain expertise?
`[FILL IN — lived experience / fieldwork / interviews. "We interviewed N
women/workers/responders and learned X" is the strongest possible answer.]`

---

## Pre-submission checklist

- [ ] Live URL YC partners can actually try
- [ ] 1-minute founder video + product demo video
- [ ] ≥10–50 real users in one beachhead, with a retention number
- [ ] 20+ user interviews written up
- [ ] Co-founder named (or a concrete plan)
- [ ] Business model with a named first payer / design-partner LOI
- [ ] Real SMS provider wired (Twilio env) so the demo works on a real phone
- [x] Working, tested product across three channels
- [x] Clear, differentiated thesis and threat model
