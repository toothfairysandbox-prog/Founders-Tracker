#!/bin/sh
# Stamps the deployed commit into the sidebar, so you can tell at a glance
# whether the page in front of you is the one you pushed. Not a real build.
#
# Netlify gave us COMMIT_REF; Vercel gives VERCEL_GIT_COMMIT_SHA, but only when
# "Enable access to System Environment Variables" is ticked in the project's
# environment settings. If it isn't, this falls back to "local" rather than
# failing the deploy — a missing stamp is not worth a broken site.
set -e
SHA="${VERCEL_GIT_COMMIT_SHA:-${COMMIT_REF:-local}}"
SHORT=$(echo "$SHA" | cut -c1-7)
sed -i "s/__BUILD__/$SHORT/" index.html
echo "stamped build $SHORT"
