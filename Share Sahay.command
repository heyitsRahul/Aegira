#!/bin/bash
# Double-click this file to put Sahay online and get a link to share.
# (Non-technical: just double-click. A window opens, a link is copied for you.)

export PATH="/usr/local/opt/node@22/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
cd "$HOME/Desktop/Sahey/core" || { echo "Could not find the Sahay folder on your Desktop."; read -r; exit 1; }

clear
echo "Starting Sahay… please wait about 15 seconds."
echo

npm run build >/dev/null 2>&1

# Open a public tunnel and wait for its web address.
cloudflared tunnel --url http://localhost:3000 > /tmp/cf-tunnel.log 2>&1 &
CF_PID=$!
caffeinate -d -w "$$" &              # keep the Mac awake while sharing
trap 'kill $CF_PID 2>/dev/null || true' EXIT

URL=""
for _ in $(seq 1 25); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf-tunnel.log | head -1)
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Could not start the link. Please check your internet and try again."
  read -r -p "Press Return to close."
  exit 1
fi

ADMIN=$(openssl rand -hex 8)
printf '%s' "$URL/app" | pbcopy          # link is now on your clipboard

clear
echo "==================================================================="
echo "   SAHAY IS LIVE  —  the share link is already COPIED for you."
echo
echo "   Paste it into WhatsApp / SMS to share:"
echo
echo "       $URL/app"
echo
echo "   ------------------------------------------------------------"
echo "   Your private dashboard (watch who signs up):"
echo "       $URL/admin"
echo "   Dashboard password:  $ADMIN"
echo "==================================================================="
echo
echo "   >> KEEP THIS WINDOW OPEN while you share. <<"
echo "   To stop sharing: close this window."
echo

open "$URL/admin" >/dev/null 2>&1 &      # opens your dashboard automatically

NODE_ENV=production PORT=3000 \
  SAHAY_DB="$PWD/var/sahay.db" \
  SAHAY_BASE_URL="$URL" \
  SAHAY_ADMIN_TOKEN="$ADMIN" \
  node dist/api/main.js
