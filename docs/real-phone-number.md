# Give Aegira a real phone number

With this, anyone can text **SOS** from any phone, even a basic phone with no
internet, to a real Indian number, and their trusted person gets a real text.

**You need:** a spare Android phone (Android 5 or newer), a SIM with an SMS
pack, and the app already online on Render (see [publish.md](publish.md)).
About 20 minutes.

## Why an Android phone?

Big SMS companies like Twilio can't easily give you an Indian number people
can text, and sending to Indian numbers needs a business registration (DLT).
An ordinary SIM in a spare Android phone avoids all that for a prototype.
The free, open-source app **SMS Gateway for Android** passes texts between
the phone and Aegira.

## Step 1 — Keep the server on and give it a memory (Render, 3 min)

Basic-phone users register once by text, so the server must remember them.
The free plan forgets everything when it sleeps.

1. In Render, open **aegira** → **Settings** → **Instance Type** → choose
   **Starter** ($7/month). Starter never sleeps.
2. Open **Disks** → **Add Disk**. Name: `data`. Mount path: `/data`.
   Size: 1 GB (about $0.25/month).

## Step 2 — Set up the Android phone (10 min)

1. Put the SIM in the phone. Check it can send a normal text.
2. Install **SMS Gateway for Android** from the Play Store (by *capcom6*).
   Its website is <https://sms-gate.app>.
3. Open the app and allow it to send and read SMS.
4. Turn on **Cloud server**, then tap **Offline** so it changes to
   **Online**. A **username** and **password** appear. Write them down.
5. Open **Settings → Webhooks** and copy the **Signing Key**.
6. Keep the phone plugged in, on Wi-Fi or mobile data, and turn off battery
   saving for this app (Settings → Apps → SMS Gateway → Battery →
   *Unrestricted*). If the phone is off, texts don't get through.

## Step 3 — Connect it to Aegira (5 min)

In Render, open **aegira → Environment → Add Environment Variable** and add:

| Key | Value |
|---|---|
| `SMSGATE_USERNAME` | the username from the app |
| `SMSGATE_PASSWORD` | the password from the app |
| `SMSGATE_SIGNING_KEY` | the signing key from the app |
| `AEGIRA_SMS_NUMBER` | the SIM's number as people should see it, e.g. `+91 98765 43210` |

Click **Save Changes**. Render restarts Aegira, and Aegira connects itself
to the phone. Its log shows `SMS gateway webhook: registered`.

## Step 4 — Test it with two phones (2 min)

1. From **your trusted person's phone**, text `JOIN` to the Aegira number.
   They get a confirmation.
2. From **your phone**, text `REG YourName <their number> 1234 9999`.
3. Text `SOS near <a place>`.
4. Wait 30 seconds. Your trusted person gets a text saying you need help,
   with the place you typed and a link.
5. Text `SAFE 1234` to end it.

The guide at `/guide` and the app now show this real number automatically.

## Safety limits built in

- **Only people who agreed get alerts.** A trusted person must text `JOIN`
  once. This stops anyone using your public link to text strangers. People
  who register by text are told this straight away.
- **At most 100 texts a day in total, and 20 per number,** so your SIM doesn't
  get blocked for spam. Most Indian prepaid packs stop at 100 a day anyway.
- **Forged messages are rejected:** every incoming text must carry the
  signing key's signature.
- **Texting `STOP`** deletes the person's registration and their `JOIN`.

## If something doesn't work

| Problem | Fix |
|---|---|
| No reply to texts | Is the phone on, online, and the app **Online**? Is battery saving off for it? |
| Log says `could not list gateway webhooks: HTTP 401` | The username or password in Render is wrong. |
| Replies come, but your trusted person gets nothing | They must text `JOIN` first. |
| Texts stop partway through the day | You hit 100 texts for the day; it resets at 5:30 am IST (midnight UTC). |
