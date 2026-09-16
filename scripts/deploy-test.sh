#!/usr/bin/env bash
# Deploy the ISOLATED TEST environment — dnc-tracker-pilot-dev.
#
#   npm run deploy:test
#
# Nobody has to remember `cd test-env` any more: this script does it, and the
# check below runs first regardless. Wrangler searches UPWARD for a config file
# and `wrangler pages deploy` has no --config flag, so the working directory is
# the only thing that selects test config over production config. That makes the
# `cd` load-bearing, which is exactly why it should not be typed by hand.
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_dir="$project_root/test-env"
cd "$project_root"

echo "=============================================="
echo "  TARGET: TEST (isolated)"
echo "  project dnc-tracker-pilot-dev"
echo "  D1      dnc-tracker-pilot-dev"
echo "  R2      dnc-tracker-assets-dev"
echo "=============================================="
echo

bash scripts/check-deploy-target.sh test
echo

# Builds the production artifact and copies it to test-env/pages-dist/. Runs its
# own verification that the copy is byte-identical to the production build.
bash scripts/build-test.sh
echo

# --commit-dirty: a test deployment is routinely made from a working tree, and
# without this wrangler stops on an interactive prompt that never returns in a
# non-interactive shell. --commit-hash keeps the deployment traceable to a commit.
commit=$(git rev-parse HEAD 2>/dev/null || echo "")
args=(--branch test --commit-dirty true)
[[ -n "$commit" ]] && args+=(--commit-hash "$commit")

# The `cd` is the whole point of this script. Running the deploy from the
# repository root would find the PRODUCTION wrangler.toml instead.
cd "$test_dir"
npx wrangler pages deploy "${args[@]}"
