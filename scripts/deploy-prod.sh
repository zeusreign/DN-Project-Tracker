#!/usr/bin/env bash
# Deploy PRODUCTION — dnc-tracker-pilot / dnc.lagospm.com.
#
#   npm run deploy:prod
#
# Same two steps as before (build, then `wrangler pages deploy` from the
# repository root, which is what selects the root wrangler.toml). The only
# addition is a pre-flight check that the config still describes production.
# The check cannot redirect the deploy — it can only stop it.
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"

echo "=============================================="
echo "  TARGET: PRODUCTION"
echo "  project dnc-tracker-pilot   (dnc.lagospm.com)"
echo "  D1      dnc-tracker-pilot"
echo "  R2      dnc-tracker-assets"
echo "=============================================="
echo

bash scripts/check-deploy-target.sh prod
echo

# A deploy replaces code only: it never reads, writes or migrates D1, and never
# touches R2 objects. Uncommitted work is still worth knowing about, because the
# deployment is recorded against a commit that does not contain it.
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  echo "NOTE: the working tree has uncommitted changes. The deployment will be"
  echo "      recorded against $(git rev-parse --short HEAD 2>/dev/null || echo 'HEAD'), which does not contain them."
  echo
fi

npm run build:pages
echo
npx wrangler pages deploy
