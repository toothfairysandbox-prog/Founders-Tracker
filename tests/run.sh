#!/bin/sh
# Run both suites against a throwaway copy of the site.
#
#   cd tests && npm install && sh run.sh
#
# Nothing here touches the real Firebase project. Sign-in, the database and file
# storage are all stubbed in fake-firebase.js.
set -e
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)
WORK=${TMPDIR:-/tmp}/tf-tests.$$

# A free port, picked fresh. A fixed one meant a leftover server from the last
# run could quietly serve a stale copy and fail tests for no visible reason.
SITE_PORT=$(python3 -c "import socket;s=socket.socket();s.bind(('',0));print(s.getsockname()[1]);s.close()")
export SITE_URL="http://localhost:$SITE_PORT"

rm -rf "$WORK"; mkdir -p "$WORK"
tar -C "$ROOT" --exclude=tests --exclude=.git -cf - . | tar -C "$WORK" -xf -

(cd "$WORK" && exec python3 -m http.server "$SITE_PORT" >/dev/null 2>&1) & SITE=$!
cleanup(){ kill $SITE 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

i=0
while [ $i -lt 40 ]; do
  curl -fsS "$SITE_URL/index.html" >/dev/null 2>&1 && break
  i=$((i+1)); sleep 0.25
done
[ $i -lt 40 ] || { echo "server did not come up"; exit 1; }

echo "── app ──────────────────────────────────────────"
node tmerge.mjs
echo
echo "── attachments ──────────────────────────────────"
node tatt.mjs
