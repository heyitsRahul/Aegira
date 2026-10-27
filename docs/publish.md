# Publish Aegira for your resume

**Done:** live at <https://aegira.onrender.com>, code public at
<https://github.com/heyitsRahul/Aegira>. The steps below are kept for reference.

Goal: a permanent link like `https://aegira.onrender.com` that stays up
without your laptop, plus a public GitHub page recruiters can read.
It takes about 15 minutes, costs nothing, and needs no coding.

## Step 1 — Make the GitHub repo public (2 min)

Recruiters can't open a private repo.

1. Go to <https://github.com/heyitsRahul/Aegira>.
2. Click **Settings** (top right of the repo).
3. Scroll to the bottom, to **Danger Zone** → **Change visibility** →
   **Make public**, and confirm.

Before you do: everything in the repo and its history becomes visible,
including the email address on each commit. Nothing secret is stored in it.

## Step 2 — Put the app online with Render (10 min)

1. Go to <https://render.com> and click **Get Started**. Choose
   **Sign up with GitHub**, and let Render see the **Aegira** repository.
2. In the Render dashboard click **New +** → **Blueprint**.
3. Pick the **Aegira** repository. Render reads the `render.yaml` file and
   shows one service called **aegira**. Click **Apply**.
4. Wait 5–10 minutes while it builds. When the status turns **Live**, your
   link is shown at the top, e.g. `https://aegira.onrender.com`.

Things to know:

- The free plan sleeps after 15 minutes with no visitors. The first visit
  after that takes 30–60 seconds to wake up. Open the link yourself a minute
  before an interview.
- Demo data resets whenever it restarts. That is expected.
- Your private dashboard is at `<your link>/admin`. Its password is under
  **aegira → Environment → AEGIRA_ADMIN_TOKEN** in Render.
- If Render asks for a card for the free plan, stop and tell me; Fly.io
  (`fly.toml`) is the fallback.

## Step 3 — Add the link everywhere (3 min)

1. Send me the link and I'll put it in the README's **Live demo** line.
2. On the GitHub repo page, click the ⚙️ next to **About**, paste the link as
   the **Website**, and add topics: `privacy`, `safety`, `typescript`,
   `nestjs`, `pwa`, `sms`.
3. Use the bullets in [resume.md](resume.md).

## Optional — a real phone number

To let anyone text SOS from a basic phone to a real Indian number, follow
[real-phone-number.md](real-phone-number.md). It needs a spare Android
phone and the $7/month Render plan, because the free plan forgets
registrations whenever it sleeps.

## What recruiters should click

| Link | What it shows |
|---|---|
| `/` | landing page |
| `/guide` | how to use it on any phone (English and हिंदी) |
| `/app` | the app (pick a language → *I need help* → SOS) |
| `/phone` | the no-smartphone SMS version |
| `/console` | behind the scenes: the duress PIN that lies |
| GitHub repo | code, 393 tests, design doc |
