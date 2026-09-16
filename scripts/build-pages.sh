#!/usr/bin/env bash
# Assemble the Cloudflare Pages "advanced mode" output.
#
# Pages advanced mode serves every request through a single `_worker.js` at the
# root of the output directory, which must export `default { fetch }`. The
# application already has exactly that shape (worker/index.js:1295), so this is
# a packaging step only — no application logic is rewritten.
#
# The vendor build (scripts/build.sh) emits the ChatGPT Sites layout
# (dist/server/index.js + dist/.openai/). That file IS the worker; it just needs
# to be placed where Pages expects it. scripts/build.sh is left byte-identical
# to the delivered package so its checksum still verifies.
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pages_dir="$project_root/pages-dist"

bash "$project_root/scripts/build.sh"

rm -rf "$pages_dir"
mkdir -p "$pages_dir"
cp "$project_root/dist/server/index.js" "$pages_dir/_worker.js"

raw=$(stat -c%s "$pages_dir/_worker.js")
gzip_size=$(gzip -9 -c "$pages_dir/_worker.js" | wc -c)

# CLOUDFLARE-ENFORCED LIMIT: 64 MiB, measured UNCOMPRESSED, identical on the
# Free and Paid plans.
#   https://developers.cloudflare.com/workers/platform/limits/
#
# The old 3 MiB (Free) / 10 MiB (Paid) COMPRESSED limits were removed on
# 2026-09-04. Cloudflare no longer checks compressed size at all: "The gzip value
# is shown for reference but is no longer a limit."
#   https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/
#
# This script used to fail the build at 3 MiB gzip. That was correct when it was
# written and is now wrong — it would block a deploy Cloudflare accepts.
cf_limit=$((64 * 1024 * 1024))

# INTERNAL THRESHOLD — not a Cloudflare limit, and not a deploy blocker.
# The bundle base64-embeds the Help PDF and seven staff photographs, so it grows
# whenever an embedded asset is added. 16 MiB is a quarter of the real cap and
# roughly four times the current size: far enough away to stay quiet, close
# enough to catch genuine bloat. Serving those assets from R2 is the mitigation.
internal_advisory=$((16 * 1024 * 1024))

mib() { awk -v b="$1" 'BEGIN{printf "%.2f", b/1048576}'; }

printf 'Pages output: %s/_worker.js\n' "$pages_dir"
printf '  uncompressed  %9s bytes (%5s MiB)  [Cloudflare limit: 64 MiB]\n' \
  "$raw" "$(mib "$raw")"
printf '  gzip          %9s bytes (%5s MiB)  [reference only — not a limit]\n' \
  "$gzip_size" "$(mib "$gzip_size")"

if [[ "$raw" -gt "$cf_limit" ]]; then
  echo "ERROR: bundle exceeds Cloudflare's 64 MiB uncompressed Worker size limit." >&2
  echo "       Move the Help PDF and profile photographs to R2 before deploying." >&2
  exit 1
fi

if [[ "$raw" -gt "$internal_advisory" ]]; then
  pct=$(awk -v r="$raw" -v l="$cf_limit" 'BEGIN{printf "%d", r*100/l}')
  echo "NOTE: bundle is past this project's own 16 MiB advisory threshold"
  echo "      (${pct}% of Cloudflare's actual 64 MiB limit). This is an internal"
  echo "      check, not a platform limit — the deploy will still succeed."
fi
