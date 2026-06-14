# Sharing Sahay for feedback — a practical guide

How to put Sahay in front of friends and product managers, what *you* (the
founder) have to do, and what *they* do once they have the link.

---

## Part 1 — What you do

### Start sharing (one command)

Open **Terminal**, then:

```bash
cd ~/Desktop/Sahey
./scripts/share.sh
```

It prints a block like this — these are the links to send:

```
App (for friends/PMs):  https://<random>.trycloudflare.com/app
Landing + waitlist:     https://<random>.trycloudflare.com/
Feature-phone (SMS):    https://<random>.trycloudflare.com/phone
Your dashboard:         https://<random>.trycloudflare.com/admin   token: <your-token>
```

**Leave that Terminal window open** — closing it (or Ctrl-C) ends the link.

### Keep your Mac awake while sharing

In a *second* Terminal tab:

```bash
caffeinate -d
```

Leave it running so the Mac doesn't sleep and kill the link. Ctrl-C it when done.

### Stop sharing

Go back to the first Terminal and press **Ctrl-C**. The link dies immediately.

### Things to know

- The URL **changes every time** you run `share.sh`. Send the newest one.
- The link only works **while your Mac is on and `share.sh` is running.** It's
  meant for live feedback rounds, not a 24/7 address.
- Data (waitlist, demo sessions) is saved locally in `core/var/` and persists
  between runs.
- When you need a **permanent URL** (e.g. to put in the YC form), do the Fly
  deploy instead — see [deploy.md](deploy.md). Everything's ready for it.

---

## Part 2 — What the people you share with do

Send them the **`/app`** link. No install, no signup — it opens in any browser.
Tell them it's a demo, so they should **not** use a real emergency PIN or real
contacts; the built-in demo values are fine.

### The three roles

On first open they pick a role. For a solo tester, the **help seeker** flow is
the core; to see the full loop, they can open two browser tabs and play two
roles at once.

**1. Help seeker (the person in trouble)**
- Set up a circle (name, a trusted-contact number, and two PINs — *safe* and
  *duress*). The demo pre-fills sensible values.
- **Emergency SOS:** pick a category, tap **SOS** → a 30-second cancel window →
  it activates and alerts the contact.
- **Watch my journey:** arm a timer before walking somewhere. Check in safe when
  you arrive; if you don't, the circle is alerted automatically.
- The **official helplines** card (112 / 100 / 108 …) is always one tap to call.

**2. Trusted contact (open a 2nd tab → "I watch over someone")**
- Enter the same phone number the seeker saved as their contact.
- See the live alert, the seeker's location, and **dispatch a verified
  responder**.

**3. Responder (3rd tab → "I'm a verified responder")**
- Pick a seeded responder identity.
- Notice you only see a **session alias and a ~1 km area** — never a name or exact
  spot — until you accept. After accepting, you get the precise location and
  confirm arrival with a code the seeker shows you.

### The two moments worth pointing out to a PM

- **Duress:** start a session, then "cancel" it with the **duress PIN (9999)**.
  The phone shows a convincing *cancelled* screen — but it's secretly still
  active and the contact was warned. (You can prove it by opening `…/console`,
  which shows the real server state next to the lie.)
- **Privacy:** there is no "nearby incidents" feed, no map of other people, no
  score. Responders are identity-blind until they accept.

### Try it over SMS too

Open the **`/phone`** link — a feature-phone simulator. Type `REG`, then `SOS`,
then `SAFE 1234`. It shows that the whole flow works on a phone with no app and
no internet.

---

## Part 3 — Watch the feedback come in

Open your **`/admin`** link and paste the token `share.sh` printed. You'll see:
- waitlist signups (from the landing page) updating live,
- a session funnel (how many triggered, watched, resolved, cancelled…).

These are aggregate, privacy-safe numbers — exactly the kind of early-traction
signal a YC application wants.

---

## Part 4 — What to ask them

You want honest reactions, not politeness. Good prompts:
- "Would you actually use this instead of your current safety app? Why / why not?"
- "What's confusing or missing?"
- "Who do you think should pay for this — you, your employer, your campus?"
- "Does 'we never store your location' change how much you'd trust it?"

Capture answers in a doc. *"We talked to N people and learned X"* is one of the
strongest things you can put in the YC application.

---

## Quick reference

| I want to… | Do this |
|---|---|
| Start sharing | `./scripts/share.sh` (keep Terminal open) |
| Keep Mac awake | `caffeinate -d` in another tab |
| Stop sharing | Ctrl-C in the share Terminal |
| See signups/usage | open `…/admin`, paste the token |
| Permanent URL later | follow [deploy.md](deploy.md) |
