# Deploy runbook — get a live URL for the YC application

You run these (they need your Fly/Twilio accounts). ~20 minutes end to end.
The repo already has the `Dockerfile` and `fly.toml`.

## 1. Prerequisites

```bash
# Fly CLI
curl -L https://fly.io/install.sh | sh
fly auth signup        # or: fly auth login
```

## 2. First deploy

From the repo root:

```bash
fly launch --copy-config --now
# - app name: aegira (or pick your own; update fly.toml's `app` and AEGIRA_BASE_URL)
# - region: bom (Mumbai) is preset
# - it will detect the Dockerfile, create the volume, build, and deploy
```

If `fly launch` asks to create the volume manually:

```bash
fly volumes create aegira_data --region bom --size 1
```

When it finishes you get `https://aegira.fly.dev` (or your app name). That's the
URL for the YC form. Visit it — you should see the landing page.

## 3. Secrets (never commit these)

```bash
fly secrets set \
  AEGIRA_ADMIN_TOKEN="$(openssl rand -hex 16)" \
  AEGIRA_GATEWAY_SECRET="$(openssl rand -hex 16)"
```

Save the admin token — it's how you open `/admin`. In production there are
no dev fallbacks: without these secrets the dashboard is locked and the JSON
SMS webhook is closed.

## 4. Real SMS (optional but makes the demo work on a real phone)

1. Buy a number in the Twilio console (a trial number works for demos).
2. Set the credentials, and switch demo mode off. In demo mode real SMS is
   never sent (anyone could type any number into a public demo), and the ops
   console that reveals duress is public:

```bash
fly secrets set \
  AEGIRA_DEMO=off \
  TWILIO_ACCOUNT_SID=ACxxxx…  \
  TWILIO_AUTH_TOKEN=xxxxx      \
  TWILIO_FROM_NUMBER=+1xxxxxxxxxx
```

3. In Twilio: Phone Numbers → your number → **Messaging → "A message comes in"**
   → Webhook → `https://aegira.fly.dev/gateway/twilio` (HTTP POST).

Now texting `REG …` / `SOS` / `WATCH 20` / `SAFE 1234` to that number works on
any phone. (Signature verification is automatic once `TWILIO_AUTH_TOKEN` is set.)

> Note: Twilio doesn't supply GPS, so `SOS`/`WATCH` over Twilio will report
> "position unavailable" unless you add a carrier-location integration or the
> user is on the app/lite for the trigger. The app and `/lite` have real
> location and work fully.

## 5. Custom domain (optional)

```bash
fly certs add app.aegira.org      # then add the DNS records Fly prints
# update AEGIRA_BASE_URL to https://app.aegira.org and redeploy:
fly deploy
```

## 6. Smoke test (copy-paste)

```bash
BASE=https://aegira.fly.dev
curl -s -o /dev/null -w "landing %{http_code}\n" $BASE/
curl -s -o /dev/null -w "app %{http_code}\n" $BASE/app
curl -s -X POST $BASE/waitlist -H 'content-type: application/json' \
  -d '{"email":"you@example.com","country":"IN"}'
curl -s $BASE/metrics
# admin data (use your real token):
curl -s $BASE/admin/data -H "x-admin-token: <your AEGIRA_ADMIN_TOKEN>"
```

Then open:
- `/` — landing + waitlist (share this link to collect signups)
- `/app` — the product demo
- `/admin` — your founder dashboard (paste the admin token)
- `/phone` — the SMS simulator (works even without Twilio)

## 7. Logs & ops

```bash
fly logs
fly status
fly deploy        # ship updates
```

## What persists

Sessions, the key vault, registrations, and the waitlist live on the `/data`
volume and survive restarts. (Production should move to managed Postgres + a
real KMS — the `SessionRepository` / `KeyVault` interfaces are already the seam.)
