# Aegira emergency agent: decision log

Each entry: the decision, why, what was rejected.

## D1. If the user doesn't answer, the alert goes out (silence = send)

- **Decision:** no confirmation before alerting trusted contacts. Silence never
  blocks an alert. Consent happens before the emergency (choosing contacts and
  the plan while calm), not during it.
- **Why:** the costs aren't equal. A false alarm costs an awkward phone call. A
  missed alarm can cost a life. The person who can't answer is the person in
  the most danger. A "confirm?" prompt is also something an attacker can press.
- **Rejected:** hold until confirmed (punishes the person who can't answer);
  partial send after a delay (the same thing, just slower).
- **Work parallel:** in fraud, blocking when unsure is safe because a blocked
  customer can retry. A missed emergency can't be retried, so the default flips.

## D2. The agent runs on a local model (Ollama), not a cloud AI

- **Decision:** a small open model running locally. Emergency data never leaves
  the system.
- **Why:** sending emergency data to an outside AI company is new data
  collection (rule 11: needs a new consent text). Free cloud tiers may keep
  what you send. Local is free and private.
- **Cost of this choice:** a weaker model, and it can't run on the free hosting
  plan, so the agent runs on a laptop for the demo and tests.
- **Rejected:** a cloud AI API (cost, consent, data leaves the system).

## D3. If nobody answers "Call 112?", the agent doesn't call. It tells the contacts to.

- **Decision:** on no answer, the agent never contacts police itself. It sends
  the trusted contacts: "{name} hasn't answered for N minutes. Call 112 now."
  with the live location link. A one-tap 112 button stays on the user's screen.
- **Why:**
  - **Not every woman in danger is safe with police arriving.** In a
    controlling home, police showing up unasked can make things worse.
    Someone who knows her makes that call.
  - **A human call carries information.** The person calling can tell 112 who
    she is and what's going on. An automated report can't answer questions.
  - **Automated false reports to police** carry legal risk and waste
    responders' time.
- **Rejected:** auto-calling 112 on silence. It looks safest, but takes the
  choice away from the people who know her.
- **Applies D1 correctly:** silence still means escalate, toward the humans
  who know her, not toward an action nobody chose.

## D4. The watchdog deadline is 30 seconds

- **Decision:** if a failure isn't told to the user within 30 seconds, plain
  code tells her and the agent is marked as failing.
- **Why:** her knowing fast matters more than giving the AI time. On a
  laptop the local model takes about 9 seconds per step, so this leaves it
  about 3 steps. That's a model speed problem, not a reason to make her wait.
- **Rejected:** 60 seconds.

## D5. Plain code decides what happens. The AI only reads messy human language. (Confirmed by v3)

- **Decision:** the recovery steps after an emergency (retry, move on, alert
  backup, offer 112, tell her) are run by plain code, the runbook. The AI
  is not in charge of any action.
- **Where the AI stays:** the one thing plain code can't do, which is reading
  free-text replies from contacts ("haan aa raha hoon", "who is this?",
  "wrong number") and turning them into a status. Even then its reading is
  advisory, and every action still goes through the gate.
- **Why:**
  - Across v1 and v2 (60 real-model runs) the AI never did better than the
    runbook on any safety measure, and was slower (33 to 52 seconds vs instant).
  - Every improvement came from code around the AI: the gate, the watchdog,
    the truth check, the stuck breaker.
  - The AI's mistakes were the dangerous kind: false alarms, silent failures,
    and once telling her "contacts reached" when nobody was.
- **v3 confirmed it:** with every guard on, v3 reached zero silent failures,
  zero false alarms and zero false reassurance, but the AI finished on its
  own in only 9 of 30 runs. In the other 21, plain code took over. Average
  time was 63 seconds. The guards stepped in 33 times (15 untrue messages
  refused, 18 unneeded backup alerts refused).
- **Rejected:** the AI choosing actions, even with guards.
- **Work parallel:** in fraud, a rule that catches the case reliably beats a
  model that catches it most of the time. Models earn their place where the
  input is too messy for rules.
