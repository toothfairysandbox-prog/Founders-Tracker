#!/bin/sh
# Run both suites against a throwaway copy of the site.
#
#   cd tests && npm install && sh run.sh
#
# Nothing here touches your real Firebase or Supabase. Sign-in and the database
# are faked in fake-firebase.js; file storage is faked by fakesupa.py, a small
# Python stand-in for Supabase Storage.
set -e
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)
WORK=${TMPDIR:-/tmp}/tf-tests.$$

# Free ports, picked fresh. Fixed ports meant a leftover server from the last
# run could quietly serve a stale copy and fail tests for no visible reason.
SITE_PORT=$(python3 -c "import socket;s=socket.socket();s.bind(('',0));print(s.getsockname()[1]);s.close()")
SUPA_PORT=$(python3 -c "import socket;s=socket.socket();s.bind(('',0));print(s.getsockname()[1]);s.close()")
export SITE_URL="http://localhost:$SITE_PORT"
export SUPA_URL="http://localhost:$SUPA_PORT"

rm -rf "$WORK"; mkdir -p "$WORK"
tar -C "$ROOT" --exclude=tests --exclude=.git -cf - . | tar -C "$WORK" -xf -

# Point the copy at the stand-in storage so uploads are exercised for real.
sed -i.bak "s|url:    \"\",|url:    \"$SUPA_URL\",|; s|key:    \"\",|key:    \"testkey\",|" \
  "$WORK/js/attachments.js"
rm -f "$WORK/js/attachments.js.bak"
grep -q "$SUPA_URL" "$WORK/js/attachments.js" || { echo "could not configure storage"; exit 1; }

SUPA_PORT=$SUPA_PORT python3 fakesupa.py & SUPA=$!
(cd "$WORK" && exec python3 -m http.server "$SITE_PORT" >/dev/null 2>&1) & SITE=$!
cleanup(){ kill $SUPA $SITE 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

# Wait for both to answer rather than guessing with sleep.
i=0
while [ $i -lt 40 ]; do
  if curl -fsS "$SITE_URL/index.html" >/dev/null 2>&1 &&
     curl -fsS "$SUPA_URL/__files"    >/dev/null 2>&1; then break; fi
  i=$((i+1)); sleep 0.25
done
[ $i -lt 40 ] || { echo "servers did not come up"; exit 1; }

echo "── app ──────────────────────────────────────────"
node tmerge.mjs
echo
echo "── attachments ──────────────────────────────────"
node tatt.mjs
