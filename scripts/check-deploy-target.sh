#!/usr/bin/env bash
# Verify a Wrangler config really describes the environment you meant to deploy.
#
#   bash scripts/check-deploy-target.sh prod
#   bash scripts/check-deploy-target.sh test
#
# This is the single definition of "what production looks like" and "what test
# looks like". scripts/deploy-prod.sh, scripts/deploy-test.sh and
# scripts/build-test.sh all call it, so the resource names live in exactly one
# file and cannot drift apart.
#
# WHY ANCHORED EXACT-LINE MATCHES, NOT grep FOR A NAME:
#   "dnc-tracker-pilot"  is a strict PREFIX of  "dnc-tracker-pilot-dev"
#   "dnc-tracker-assets" is a strict PREFIX of  "dnc-tracker-assets-dev"
# A substring search for the production names therefore matches the TEST config
# too, and a check built that way would pass while pointing at the wrong place.
# Every assertion below anchors with ^...$ on the whole key = "value" line.
#
# Comments are stripped before matching: both configs mention the other
# environment's resource names in their header comments, and a naive search
# would trip over that prose.
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
target=${1:-}

PROD_CONFIG="$project_root/wrangler.toml"
TEST_CONFIG="$project_root/test-env/wrangler.toml"

PROD_PROJECT="dnc-tracker-pilot"
PROD_D1_NAME="dnc-tracker-pilot"
PROD_D1_ID="94241844-c709-445f-a71c-49f8b65a7cfd"
PROD_R2="dnc-tracker-assets"

TEST_PROJECT="dnc-tracker-pilot-dev"
TEST_D1_NAME="dnc-tracker-pilot-dev"
TEST_D1_ID="34dca57e-bd32-46cd-b154-8c362efaeb4c"
TEST_R2="dnc-tracker-assets-dev"

case "$target" in
  prod) config=$PROD_CONFIG; label="PRODUCTION" ;;
  test) config=$TEST_CONFIG; label="TEST" ;;
  *) echo "Usage: check-deploy-target.sh <prod|test>" >&2; exit 2 ;;
esac

if [[ ! -f "$config" ]]; then
  echo "ERROR: $config is missing." >&2
  echo "       Wrangler searches UPWARD for a config file, so deploying without" >&2
  echo "       it could silently pick up the wrong environment. Refusing." >&2
  exit 1
fi

# Effective configuration: comments and blank lines removed.
effective=$(sed 's/#.*//' "$config" | grep -vE '^[[:space:]]*$')

failures=0

# kv <key> <value> -> the line `key = "value"` must be present, exactly.
kv() {
  local pattern="^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"$2\"[[:space:]]*$"
  if grep -qE "$pattern" <<<"$effective"; then
    printf '  PASS  %s = "%s"\n' "$1" "$2"
  else
    printf '  FAIL  %s = "%s"  <- not found\n' "$1" "$2" >&2
    failures=$((failures + 1))
  fi
}

# forbid <key> <value> <why> -> the line must NOT be present.
forbid() {
  local pattern="^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"$2\"[[:space:]]*$"
  if grep -qE "$pattern" <<<"$effective"; then
    printf '  FAIL  %s = "%s"  <- %s\n' "$1" "$2" "$3" >&2
    failures=$((failures + 1))
  else
    printf '  PASS  %s is not "%s"\n' "$1" "$2"
  fi
}

echo "Checking $label config: ${config#$project_root/}"

if [[ "$target" == "prod" ]]; then
  kv name "$PROD_PROJECT"
  kv database_name "$PROD_D1_NAME"
  kv database_id "$PROD_D1_ID"
  kv bucket_name "$PROD_R2"
  forbid database_id "$TEST_D1_ID" "that is the TEST database"
  forbid bucket_name "$TEST_R2" "that is the TEST bucket"
else
  kv name "$TEST_PROJECT"
  kv database_name "$TEST_D1_NAME"
  kv database_id "$TEST_D1_ID"
  kv bucket_name "$TEST_R2"
  forbid database_id "$PROD_D1_ID" "that is the PRODUCTION database"
  forbid bucket_name "$PROD_R2" "that is the PRODUCTION bucket"
  forbid database_name "$PROD_D1_NAME" "that is the PRODUCTION database"
  forbid name "$PROD_PROJECT" "that is the PRODUCTION Pages project"
fi

# Applies to both. When "true", platformUserFrom() trusts the
# `oai-authenticated-user-*` request headers, and nothing strips those on a
# public Pages deployment: any caller could send one and arrive as an admin.
kv ALLOW_PLATFORM_AUTH "false"

# Binding names are fixed by the application; worker/index.js reads env.DB and
# env.BUCKET directly. Renaming either produces a 503 at runtime, not a build error.
kv binding "DB"
kv binding "BUCKET"

if (( failures > 0 )); then
  echo >&2
  echo "ABORTED: $failures check(s) failed against ${config#$project_root/}." >&2
  echo "         Nothing was built and nothing was deployed." >&2
  exit 1
fi

echo "  OK    $label config verified"
