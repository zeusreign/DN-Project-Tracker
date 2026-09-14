#!/usr/bin/env bash
# Run the tracker as a Cloudflare Pages Function locally, with D1 + R2.
# wrangler.toml lives in the PROJECT ROOT - Pages requires that.
#
#   ./pages-test/setup.sh          start (migrates only on first run)
#   RESET=1 ./pages-test/setup.sh  wipe the local database and start clean
#
# LOCAL ONLY. Creates a throwaway administrator in the LOCAL D1 state under
# .wrangler/ (gitignored). Override the defaults with:
#   LOCAL_ADMIN=you@example.invalid LOCAL_PASS='...' ./pages-test/setup.sh
# These credentials are for this local harness only and must never be reused on
# a real deployment.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=8788
ADMIN="${LOCAL_ADMIN:-administrator@example.invalid}"
PASS="${LOCAL_PASS:-PilotAdmin1!}"

[[ "${RESET:-}" == "1" ]] && { echo "Resetting local D1/R2 state..."; rm -rf .wrangler/state; }

# Builds dist/ and assembles pages-dist/_worker.js, the Pages advanced-mode
# output declared by pages_build_output_dir in wrangler.toml.
npm run build:pages

# ALTER TABLE is not idempotent, so migrate only when the schema is absent.
if npx wrangler d1 execute DB --local --yes \
     --command "SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'" 2>/dev/null \
     | grep -q '"1"'; then
  echo "Schema already present - skipping migrations."
else
  echo "Applying migrations..."
  for f in drizzle/*.sql; do
    npx wrangler d1 execute DB --local --yes --file="$f" >/dev/null
    echo "  applied $(basename "$f")"
  done
fi

npx wrangler pages dev --port "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://localhost:$PORT/health" && break || sleep 1
done

# The app seeds projects and users on its first authenticated request.
curl -s -o /dev/null -m 20 \
  -H "oai-authenticated-user-id: setup" \
  -H "oai-authenticated-user-email: preview@example.com" \
  "http://localhost:$PORT/api/bootstrap" || true

npx wrangler d1 execute DB --local --yes \
  --command "$(node pages-test/make-login.mjs "$ADMIN" "$PASS")" >/dev/null 2>&1 || true

echo
echo "=================================================="
echo "  http://localhost:$PORT"
echo "  Sign in:  $ADMIN"
echo "            $PASS"
echo "=================================================="
echo
wait $SERVER
