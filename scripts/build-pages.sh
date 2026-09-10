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
limit=$((3 * 1024 * 1024))

printf 'Pages output: %s/_worker.js\n' "$pages_dir"
printf '  raw   %s bytes (%.2f MB)\n' "$raw" "$(echo "$raw" | awk '{print $1/1048576}')"
printf '  gzip  %s bytes (%.2f MB)  [free-plan script limit: 3.00 MB gzip]\n' \
  "$gzip_size" "$(echo "$gzip_size" | awk '{print $1/1048576}')"

# The bundle base64-embeds the Help PDF and seven staff photographs, which is
# what puts it near the cap. Moving those to R2 is the documented mitigation.
if [[ "$gzip_size" -gt "$limit" ]]; then
  echo "ERROR: bundle exceeds the 3 MB gzip script limit. Move the Help PDF and" >&2
  echo "       profile photos to R2 before deploying (see wrangler.toml TODO)." >&2
  exit 1
fi

pct=$(awk -v g="$gzip_size" -v l="$limit" 'BEGIN{printf "%d", g*100/l}')
if [[ "$pct" -ge 80 ]]; then
  echo "WARNING: bundle is at ${pct}% of the free-plan script limit."
  echo "         Adding further embedded assets will break the deploy."
fi
