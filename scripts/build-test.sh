#!/usr/bin/env bash
# Assemble the ISOLATED TEST deployment output for the technical review.
#
# The review must exercise the same code as production, so this runs the
# production build unchanged and then COPIES the resulting artifact into
# test-env/pages-dist/. It never rewrites the worker and never edits the
# production output in pages-dist/ — the difference between the two
# deployments is the bindings in test-env/wrangler.toml, nothing else.
#
#   bash scripts/build-test.sh                          # from the repository root
#   cd test-env && npx wrangler pages deploy --branch test
#
# The deploy MUST run from inside test-env/. Wrangler searches upward for a
# config file and `wrangler pages deploy` has no --config flag, so the working
# directory is the only thing selecting test config over production config.
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_dir="$project_root/test-env"
test_out="$test_dir/pages-dist"
source_worker="$project_root/pages-dist/_worker.js"

if [[ ! -f "$test_dir/wrangler.toml" ]]; then
  echo "ERROR: $test_dir/wrangler.toml is missing. Without it the deploy would" >&2
  echo "       walk up and use the PRODUCTION config. Refusing to continue." >&2
  exit 1
fi

# The production build. Unmodified, including its own size checks.
bash "$project_root/scripts/build-pages.sh"

if [[ ! -f "$source_worker" ]]; then
  echo "ERROR: $source_worker was not produced by the build." >&2
  exit 1
fi

rm -rf "$test_out"
mkdir -p "$test_out"
cp "$source_worker" "$test_out/_worker.js"

# Prove the review runs the same bytes as production rather than assuming it.
src_sum=$(sha256sum "$source_worker" | cut -d' ' -f1)
dst_sum=$(sha256sum "$test_out/_worker.js" | cut -d' ' -f1)
if [[ "$src_sum" != "$dst_sum" ]]; then
  echo "ERROR: copied artifact does not match the production build." >&2
  exit 1
fi

# Guard against the one mistake that would defeat the whole isolation: a test
# config that still points at a production resource.
PROD_D1="94241844-c709-445f-a71c-49f8b65a7cfd"
if grep -q "$PROD_D1" "$test_dir/wrangler.toml"; then
  echo "ERROR: test-env/wrangler.toml references the PRODUCTION D1 database." >&2
  exit 1
fi
if grep -qE '^[[:space:]]*bucket_name[[:space:]]*=[[:space:]]*"dnc-tracker-assets"' "$test_dir/wrangler.toml"; then
  echo "ERROR: test-env/wrangler.toml references the PRODUCTION R2 bucket." >&2
  exit 1
fi
if ! grep -qE '^[[:space:]]*ALLOW_PLATFORM_AUTH[[:space:]]*=[[:space:]]*"false"' "$test_dir/wrangler.toml"; then
  echo "ERROR: ALLOW_PLATFORM_AUTH is not \"false\" in test-env/wrangler.toml." >&2
  echo "       When true, anyone can become an administrator by sending a header." >&2
  exit 1
fi

echo
echo "Test output: $test_out/_worker.js"
printf '  sha256 %s (identical to production build)\n' "${dst_sum:0:32}"
echo "  project  $(grep -E '^name' "$test_dir/wrangler.toml" | cut -d'"' -f2)"
echo "  D1       $(grep -E '^database_name' "$test_dir/wrangler.toml" | cut -d'"' -f2)"
echo "  R2       $(grep -E '^bucket_name' "$test_dir/wrangler.toml" | cut -d'"' -f2)"
echo "  auth     $(grep -E '^ALLOW_PLATFORM_AUTH' "$test_dir/wrangler.toml" | cut -d'"' -f2)"
echo
echo "Production output in pages-dist/ is untouched."
echo "Next:  cd test-env && npx wrangler pages deploy --branch test"
