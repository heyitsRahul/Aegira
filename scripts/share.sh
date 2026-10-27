#!/usr/bin/env bash
# Share Aegira with friends / PMs via a temporary public URL (no account, no card).
# Requires: node@22, cloudflared (brew install cloudflared).
# Usage:  ./scripts/share.sh        (Ctrl-C stops the server and the tunnel)
set -euo pipefail

export PATH="/usr/local/opt/node@22/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/../core"

echo "Building…"; npm run build >/dev/null

# Start the public tunnel and grab the URL.
cloudflared tunnel --url http://localhost:3000 > /tmp/cf-tunnel.log 2>&1 &
CF_PID=$!
trap 'kill $CF_PID 2>/dev/null || true' EXIT
sleep 8
URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf-tunnel.log | head -1)
ADMIN="${AEGIRA_ADMIN_TOKEN:-$(openssl rand -hex 8)}"

echo
echo "================ SHARE THESE ================"
echo " App (for friends/PMs):  $URL/app"
echo " Landing + waitlist:     $URL/"
echo " Feature-phone (SMS):    $URL/phone"
echo " Your dashboard:         $URL/admin   token: $ADMIN"
echo "============================================="
echo "Keep this terminal open. Ctrl-C ends sharing."
echo

NODE_ENV=production PORT=3000 \
  AEGIRA_DB="$PWD/var/aegira.db" \
  AEGIRA_BASE_URL="$URL" \
  AEGIRA_ADMIN_TOKEN="$ADMIN" \
  node dist/api/main.js
