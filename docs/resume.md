# Aegira on your resume

Live link: <https://aegira.onrender.com>

## Project entry

**Aegira — Privacy-first emergency coordination app** · [Live demo](https://aegira.onrender.com) · [GitHub](https://github.com/heyitsRahul/Aegira)

- Conceived and shipped a working emergency-coordination prototype for India
  that alerts trusted contacts and nearby verified helpers on a smartphone,
  an old browser, or plain SMS.
- Wrote the product's 11 privacy and safety rules (no location outside a live
  session, no public incident feed, no cancel after activation) and had each
  one enforced by automated tests that run on every change.
- Designed a duress PIN that looks exactly like a normal cancel to anyone
  watching, while silently escalating to the user's contacts.
- Made it usable by people with low literacy: Hindi and English, icon-first
  screens, and spoken prompts.
- Benchmarked global safety apps and added the most-requested missing feature,
  a journey watch that alerts contacts if you don't check in on time.
- Made SOS work from a basic phone with no internet or GPS: a real Indian
  number (an Android phone as the SMS gateway), opt-in so a public demo can't
  spam strangers, and alerts that carry the place in the sender's own words.
- Stress-tested it like an attacker would: 300 random "chaos" runs that
  re-check every safety rule after each step, and 1,000+ malformed requests,
  stolen links and request floods against the real server. This found and
  fixed crash, clickjacking and flooding gaps before launch.
- Built with AI-assisted development (Claude Code): I set the product spec,
  safety rules and priorities, and reviewed every feature against them;
  393 automated tests, CI on every push.

Pick the 3–4 bullets that fit the job. For product roles, lead with the rules,
the duress PIN and the accessibility bullets. For engineering roles, add a
line about the tech stack (TypeScript, NestJS, SQLite, PWA, Twilio, Docker).

For a plain-language explanation and ready-to-post LinkedIn text, see
[portfolio.md](portfolio.md).

## One-line version (LinkedIn headline, short resumes)

Built Aegira, a privacy-first emergency app that works on any phone, even
over SMS, and deletes location data by destroying its encryption key.

## Be ready to explain in an interview

- **Why "session-shaped"?** Location can only exist inside a live emergency
  session. When the session ends, its encryption key is destroyed, so the data
  can't be read even from backups.
- **Why no cancel after help is on the way?** An attacker could force the
  victim to press it.
- **Why does the duress PIN lie?** Someone standing over you sees "cancelled";
  your contacts see "duress".
- **What's not real yet?** There are no real responders or real SMS. It is a
  prototype, and the README says so.
- **How did you build it?** With an AI coding assistant. You decided what to
  build and which rules could never be broken; the tests prove those rules
  hold. Say this openly. Claiming to have hand-written the code would come
  apart in a technical interview.
