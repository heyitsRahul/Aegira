# Aegira, in plain words

Use this page to explain the project in an interview, on a portfolio, or on
LinkedIn. Everything here is true today. The last section lists what is safe
to share.

Live demo: <https://aegira.onrender.com> · Code: <https://github.com/heyitsRahul/Aegira>

---

## The simple version

**What is it?**
An app that gets you help in an emergency. It works on any phone, even an
old one with no internet, by SMS.

**How does it work?**
You press SOS. Your family gets a message with your location. A trained
helper close by can come too.

**What is special about it?**
- **Secret PIN.** If someone forces you to stop the alarm, you type a
  secret PIN. Your phone looks normal, but help keeps coming.
- **No stop button once help is coming.** Nobody can force you to stop it.
- **Your location is deleted.** When the emergency ends, your location is
  gone for good.

**How do you know it works?**
I tested it like an attacker would: thousands of random and broken actions.
The tests found real problems, and I fixed them. It now has 414 automated
tests.

**Who built it?**
I designed it and set the rules. I built it with an AI coding assistant
(Claude Code).

**Is it real?**
It's a working demo, not a real emergency service. In danger, call 112.

**Simple LinkedIn post**

> I built Aegira, an emergency app for India that works on any phone, even
> without internet.
>
> 🆘 Press SOS, and your family gets your location.
> 🔒 A secret PIN: if someone forces you to stop the alarm, your phone looks
> normal, but help keeps coming.
> 🗑️ Your location is deleted when the emergency ends.
>
> I tested it like an attacker would, and fixed what broke.
> Built with AI (Claude Code). I designed it and set the rules.
>
> Try the demo (not a real emergency service): https://aegira.onrender.com
>
> #India #Safety #Privacy #BuildInPublic

**Follow-up post, in my own voice**

> So I was testing my own app, Aegira, trying to break it on purpose. And I actually found a problem.
>
> Quick background: in Aegira you have a secret PIN. If someone forces you to cancel your SOS, you type that PIN instead. Your phone shows "cancelled", but your family still gets the alert.
>
> What I found was that the "I'm safe" button had no PIN at all. So if someone had your phone, they could just tap it and stop the help. And on SMS, typing the secret PIN said "wrong PIN", which kind of gives it away.
>
> Fixed both. Now "I'm safe" asks for your PIN every time, and if you type the secret one, it says "you are safe" like normal, but help keeps coming and your family gets a secret alarm.
>
> Honestly this is the part I enjoy most, thinking about how someone could misuse it and closing that gap.
>
> Built it with Claude Code. I worked on the idea, the rules and the testing.
>
> Demo here (just a demo, not a real emergency service): https://aegira.onrender.com

**Short journey post**

> I built a safety app. Then I tried to break it.
>
> I made a lot of mistakes.
>
> Built it only for smartphones. Most people who need help don't have one. Added SMS.
>
> Used words like "Duress PIN". Nobody talks like that when they're scared. Rewrote everything.
>
> Forgot a PIN on "I'm safe". Anyone with your phone could stop the help. Fixed.
>
> Biggest lesson: think like the bad guy. Every button.
>
> Built with Claude Code. The mistakes were mine. So were the fixes.
>
> Aegira. Demo, not a real emergency service:
> https://aegira.onrender.com

**Journey post: the mistakes and what I learned**

> A few weeks ago I started building a safety app for India. I thought it would be simple. Press SOS, tell your family, done. It wasn't.
>
> It started as "Sahay". Now it's called Aegira. Here's what went wrong along the way, and what each mistake taught me.
>
> Mistake 1: I built it only for smartphones.
> Then it hit me that a lot of people in India don't have a smartphone or don't have data when they need it most. So I added a simple web page that works on old phones, and SMS for phones with no internet at all. Lesson: the person who needs help most is usually not the person with the best phone.
>
> Mistake 2: my words were too technical.
> My buttons said things like "Duress PIN" and "Dispatch offers". Nobody talks like that, especially someone who is scared. I rewrote everything in plain words and added Hindi. Lesson: if my mom can't understand a screen, it's not done.
>
> Mistake 3: the demo broke when two people used it.
> Everyone who opened the demo became the same user, so the second person got "help is already running". Embarrassing. Lesson: test it the way real people will use it, not the way I use it.
>
> Mistake 4: a fake number that could have reached a real person.
> To make the demo quick, the setup form was pre-filled with an example phone number. Then I realised someone could actually keep it, and their SOS would go to a stranger. Removed it. Lesson: in safety apps, small shortcuts can hurt someone.
>
> Mistake 5: the app wasn't honest.
> If no helper was nearby, it just said "please wait" forever. That's the worst thing to show someone in danger. Now it says clearly that no helper is close and to call 112. Lesson: honest is better than comforting.
>
> Mistake 6: "I'm safe" had no PIN.
> The app has a secret PIN for when someone forces you to cancel. But I forgot the "I'm safe" button. Anyone holding your phone could tap it and stop the help. I only found this when I started attacking my own app on purpose. Lesson: think like the bad guy, every single button.
>
> That last one changed how I test. Now I throw thousands of random and broken actions at the app and check the safety rules after every step. It found around 170 kinds of input that crashed it. All fixed.
>
> I built it with Claude Code. The AI wrote most of the code, but deciding what the app must never do, and catching what was wrong, was on me. That's honestly where I learned the most.
>
> It's still a demo, not a real emergency service. But I'm proud of it, mistakes and all.
>
> Try it here: https://aegira.onrender.com

---

The sections below go into more detail, for interviews.

## The one-line version

Aegira is an emergency app for India that works on any phone, even a basic
one over SMS, and deletes your location for good when the emergency is over.

## The problem

When someone in India is in danger, they usually call family first. Today's
safety apps have three gaps:

1. **Many people don't have a smartphone or data.** Most safety apps need both.
2. **Safety apps can become tracking apps.** They keep your location long
   after the emergency, where it can leak or be misused.
3. **An attacker can force you to press "cancel".** Once that happens, nobody
   comes.

## What Aegira does

1. You press **SOS** in the app, or send `SOS` by SMS from any phone.
2. You get **30 seconds to cancel** with your PIN, in case it was a mistake.
3. Your **trusted people** get a message with a link that shows where you are.
4. A **trained helper** close by can be sent. They see only a nickname and a
   rough area (about 1 km) until they accept.
5. When the helper arrives, they read out a **code** from your screen, so you
   know the right person came.
6. When it's over, your data is **destroyed**. The lock it was kept under is
   thrown away, so nobody can read it, not even from a backup.

## Three ideas that make it different

- **A secret alarm PIN.** You set two PINs. If someone forces you to cancel,
  or to say "I'm safe", you type the second one. Your screen looks exactly as
  normal, but help keeps coming and your people are told it's a real
  emergency.
- **No cancel once help is coming.** After help is on its way, there is no
  button that someone can force you to press.
- **Location only during an emergency.** The app can't see where you are
  except during a live emergency, and it forgets afterwards.

## Works for everyone

- **Smartphone:** an app you can install from the browser, in English and
  Hindi, with big buttons and spoken prompts.
- **Old phone with a browser:** a simple version with no JavaScript.
- **Basic phone, no internet:** plain SMS commands (`SOS`, `CANCEL 1234`).
- 11 more Indian languages are listed as "coming soon", and visitors vote for
  the one they need.

## How I tested it

The project has 414 automated tests that run every time the code changes.
Some of them are deliberately hard:

- **Chaos testing.** A program does 300 runs of 60 random actions each (press
  SOS, cancel, use the secret PIN, send a helper, guess codes, jump forward in
  time) in every order. After *every* step it checks that no safety rule has
  broken.
- **Attacking the real server.** It sends more than 1,000 broken or strange
  inputs, uses stolen links and keys, presses SOS 25 times at the same moment,
  guesses the arrival code, and tries to slip code into names. Each attack
  must be refused safely.
- **Testing the tests.** I planted a bug on purpose, a secret alarm that gives
  itself away after an hour. The chaos test caught it, which shows the tests
  really look for problems.

These tests found real bugs, which are now fixed:

- About 170 kinds of unusual input crashed a request instead of being
  politely refused.
- The site could be loaded hidden inside another website, a trick to fool
  people into tapping the wrong button. It now refuses to load that way.
- Nothing stopped one person flooding the server. There is now a
  per-network limit, set high enough that nobody tapping by hand gets near
  it. If it is hit, the message still says "call 112".

## My role (say this honestly)

I came up with the product, decided what it must and must never do (11
safety rules), and checked every feature against them. I built it with an AI
coding assistant (Claude Code), which wrote most of the code under my
direction. The tests prove the rules hold.

Say this openly in interviews. It is a real skill, and claiming you
hand-wrote the code would fall apart under technical questions.

## What it is not (yet)

- **Not a real emergency service.** It is not connected to police or
  ambulance, and the demo says so on every page.
- **The helpers in the demo are pretend.** There are two test helpers in
  Bengaluru.
- **SMS uses a simulator in the demo.** Real texts work once an Android phone
  with a SIM is connected as the gateway.

---

## LinkedIn post

Pick one. Add 2–3 screenshots from `docs/screenshots/` or a short screen
recording of the demo.

### Short version

> I built Aegira, an emergency app for India that works on any phone, even a
> basic one over SMS.
>
> Three ideas I'm proud of:
> 🔒 A secret alarm PIN. If someone forces you to cancel or say "I'm safe",
> the screen looks normal, but help keeps coming and your family is told it's real.
> 🚫 No cancel button once help is on the way, so nobody can force you to stop it.
> 🗑️ Your location exists only during the emergency. Afterwards it is
> destroyed, not just hidden.
>
> To test it, I attacked it: 300 random runs checking the safety rules after
> every step, plus 1,000+ broken inputs, stolen links and floods of requests.
> The tests found real bugs, and I fixed them.
>
> Built with AI-assisted development (Claude Code). I set the product, the
> safety rules and the priorities.
>
> Try the demo (it's a prototype, not a real emergency service):
> https://aegira.onrender.com
>
> #ProductManagement #WomenSafety #Privacy #India #BuildInPublic

### Story version

> Most safety apps assume three things: you have a smartphone, you have
> data, and you're free to press "cancel" if it was a false alarm.
>
> In a real emergency in India, none of those is guaranteed.
>
> So I built Aegira, a prototype emergency app that:
> • works as an app, as a simple web page for old phones, and over plain SMS
> • alerts your trusted people, and can send a trained helper close by
> • gives helpers only a nickname and a rough area until they accept
> • has a secret alarm PIN for when someone forces you to cancel or say "I'm safe"
> • destroys your location data when the emergency ends
>
> I wrote 11 rules the app must never break, then tried hard to break them:
> random "chaos" runs, attacks on the live server, and a bug planted on
> purpose to check that the tests catch it.
>
> I built it with Claude Code as my engineering partner. My job was the
> product: who it's for, what it must never do, and what to cut.
>
> It's a prototype, not a real emergency service. In danger, call 112.
> Demo: https://aegira.onrender.com
> Code: https://github.com/heyitsRahul/Aegira
>
> #ProductManagement #Privacy #SafetyTech #India #AI

---

## Sharing safely: what's protected, and what not to post

**Already in place**
- Every page says "Demo only, not a real emergency service. Call 112."
- The code is public to read but **all rights reserved** (see `LICENSE`).
  Nobody may copy or reuse it without your permission. The site footer says
  "© 2026 Rahul Verma".
- The demo **never texts real numbers**. Real SMS is off unless you connect
  a phone, and even then only numbers that agreed can get messages, with a
  daily limit.
- The admin page is locked with a password Render made for you. Only you can
  see it, in the Render dashboard.
- The server limits how fast one network can send requests, so a viral
  post can't knock it over.

**Don't post**
- Your admin password, or screenshots of the Render dashboard or `/admin`.
- Your real phone number or a family member's. Use the examples in the demo,
  such as `9876543210`.
- Screenshots of `/console` with real data. Make a fresh demo session first.

**Do post**
- The live link, the GitHub link, and screenshots of the app and the SMS
  simulator.
- The line "Built with AI-assisted development". It protects your
  credibility.
