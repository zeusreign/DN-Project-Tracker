#!/usr/bin/env bash
# Run the tracker as a Cloudflare Pages Function locally, with D1 + R2.
# wrangler.toml lives in the PROJECT ROOT - Pages requires that.
#
#   ./pages-test/setup.sh          start (migrates only on first run)
#   RESET=1 ./pages-test/setup.sh  wipe the local database and start clean
#
# LOCAL ONLY. Creates a throwaway administrator in the LOCAL D1 state under
# .wrangler/ (gitignored). The password is RANDOMLY GENERATED each run and printed
# at the end - this file contains no default password. Pin your own with:
#   LOCAL_ADMIN=you@example.invalid LOCAL_PASS='...' ./pages-test/setup.sh
# These credentials are for this local harness only and must never be reused on
# a real deployment. Nothing here affects production authentication.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=8788
ADMIN="${LOCAL_ADMIN:-administrator@example.invalid}"

# There is deliberately NO default password here. Supply one with LOCAL_PASS, or a
# fresh random one is generated for this run and printed at the end.
#
# A fixed literal in a checked-in file reads like a real credential to anyone
# reviewing the source, and invites being reused on a deployment. Generating one
# removes both problems: nothing in this repository is a password any more.
#
# Composed to satisfy validatePassword() in worker/index.js — at least 10
# characters with an upper case, a lower case, a digit and a special character —
# so the account it creates behaves like any other. Ambiguous characters (O/0,
# I/l/1) and shell-awkward ones are left out so it can be retyped by hand.
PASS="${LOCAL_PASS:-}"
PASS_ORIGIN="supplied via LOCAL_PASS"
if [ -z "$PASS" ]; then
  PASS=$(node -e 'const U="ABCDEFGHJKLMNPQRSTUVWXYZ",L="abcdefghijkmnopqrstuvwxyz",D="23456789",S="@#%^*?_+=",A=U+L+D+S;const r=new Uint32Array(20);crypto.getRandomValues(r);const o=[U[r[0]%U.length],L[r[1]%L.length],D[r[2]%D.length],S[r[3]%S.length]];for(let i=4;i<20;i++)o.push(A[r[i]%A.length]);for(let i=o.length-1;i>0;i--){const j=r[i]%(i+1),t=o[i];o[i]=o[j];o[j]=t}process.stdout.write(o.join(""))')
  PASS_ORIGIN="generated for this run"
fi

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

# Optional: run the whole inactivity timeout in a couple of minutes so the warning
# and the cut-off can be watched by hand. Unset by default, so this local server
# enforces the same 45 minutes as production. Nothing in the source needs editing:
#   IDLE_SECONDS_OVERRIDE=120 ./pages-test/setup.sh
IDLE_ARGS=()
if [ -n "${IDLE_SECONDS_OVERRIDE:-}" ]; then
  IDLE_ARGS=(--binding "IDLE_SECONDS_OVERRIDE=$IDLE_SECONDS_OVERRIDE")
  echo "Inactivity timeout overridden to ${IDLE_SECONDS_OVERRIDE}s FOR THIS LOCAL RUN ONLY."
fi

npx wrangler pages dev --port "$PORT" ${IDLE_ARGS[@]+"${IDLE_ARGS[@]}"} &
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

# make-login.mjs UPDATEs an existing directory row and only INSERTs with --create,
# so pick the right one. Without this a fresh database ended up with no account at
# all: the UPDATE matched zero rows, wrangler reported success, and the banner below
# advertised credentials that had never been created. --create is a plain INSERT, so
# it cannot be used unconditionally either.
if npx wrangler d1 execute DB --local --yes \
     --command "SELECT 1 FROM user_directory WHERE lower(user_email)=lower('$ADMIN')" 2>/dev/null \
     | grep -q '"1"'; then
  CREATE_ARGS=()
else
  CREATE_ARGS=(--create Local Administrator)
fi

# Passed by environment rather than as an argument so the password does not show up
# in the process list while this runs.
npx wrangler d1 execute DB --local --yes \
  --command "$(PILOT_ADMIN_PASSWORD="$PASS" node pages-test/make-login.mjs "$ADMIN" ${CREATE_ARGS[@]+"${CREATE_ARGS[@]}"})" >/dev/null 2>&1 \
  || echo "  WARNING: could not provision $ADMIN - the credentials below will not work."

echo
echo "=================================================="
echo "  http://localhost:$PORT"
echo
echo "  LOCAL TEST CREDENTIALS  ($PASS_ORIGIN)"
echo "    User ID:  $ADMIN"
echo "    Password: $PASS"
echo
echo "  Local development account in the throwaway D1"
echo "  state under .wrangler/. NOT a production"
echo "  credential - never reuse it on a deployment."
echo "=================================================="
echo
wait $SERVER
