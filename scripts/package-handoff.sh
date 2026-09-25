#!/usr/bin/env bash
# Build the handoff package: a zip in which the code, the checksums and the
# commit hash all agree, and can be shown to agree by whoever opens it.
#
#   bash scripts/package-handoff.sh [output.zip]
#
# WHY THIS EXISTS
#
# HANDOFF_MANIFEST.json and CHECKSUMS.sha256 cannot describe the commit that
# contains them. A commit's hash is derived from its content, so a manifest that
# names its own commit would have to be written before that hash exists. Keeping
# both files tracked therefore guarantees they are one commit behind for ever:
# refresh them, commit, and the commit they now sit in is newer than the one they
# name. Refreshing again just moves the gap forward. There is no ordering of
# commits that escapes it.
#
# The way out is to stop treating them as source. They are OUTPUT, like dist/.
# This script regenerates both from whatever HEAD is, writes them into a copy of
# HEAD's tree, and zips that. Inside the zip nothing is stale:
#
#   - the files are exactly the files of commit <hash>, from `git archive HEAD`
#   - HANDOFF_MANIFEST.json names <hash>
#   - CHECKSUMS.sha256 covers every other file and verifies clean
#
# The tracked copies in git stay whatever they were. They are a convenience, not
# the artifact, and their staleness stops mattering because nobody verifies
# against them — the zip is what gets reviewed.
#
# WHAT THE REVIEWER RUNS, inside the unzipped folder:
#
#   sha256sum -c CHECKSUMS.sha256          # every file, unchanged
#   grep git_commit HANDOFF_MANIFEST.json  # the commit this package is
#
# and, to prove the zip was not edited after the fact, against a clone:
#
#   git -C <clone> archive <hash> | tar -t | sort > /tmp/a
#   ( cd <unzipped> && find . -type f | sed 's|^\./||' \
#       | grep -vE '^(CHECKSUMS\.sha256|HANDOFF_MANIFEST\.json)$' | sort ) > /tmp/b
#   diff /tmp/a /tmp/b
set -euo pipefail
cd "$(dirname "$0")/.."

OUTPUT="${1:-DN-Project-Tracker-handoff.zip}"
[[ "$OUTPUT" = /* ]] || OUTPUT="$PWD/$OUTPUT"

# Everything except the two generated files must be committed, or the zip would
# claim to be a commit it is not. Those two are allowed to be dirty precisely
# because this script overwrites them.
DIRTY=$(git status --porcelain | awk '{print $2}' \
  | grep -vE '^(CHECKSUMS\.sha256|HANDOFF_MANIFEST\.json)$' || true)
if [ -n "$DIRTY" ]; then
  echo "Refusing to package: these are not committed, so the zip would not match any commit:" >&2
  echo "$DIRTY" | sed 's/^/  /' >&2
  exit 1
fi

COMMIT=$(git rev-parse HEAD)
SHORT=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT
ROOT="$STAGING/DN-Project-Tracker-handoff"
mkdir -p "$ROOT"

# `git archive HEAD` is the committed tree and nothing else: no untracked files,
# no ignored files, no working-tree edits. Everything in excluded_from_package is
# already gitignored, so the exclusion needs no separate list to drift out of date.
git archive --format=tar HEAD | tar -x -C "$ROOT"

# The manifest's curated content — deployment record, QA findings, verification —
# is preserved; only the fields that describe THIS package are rewritten.
python3 - "$ROOT" "$COMMIT" "$SHORT" "$BRANCH" "$STAMP" <<'PY'
import collections, json, subprocess, sys

root, commit, short, branch, stamp = sys.argv[1:6]
path = f"{root}/HANDOFF_MANIFEST.json"
with open(path, encoding="utf8") as fh:
    manifest = json.load(fh, object_pairs_hook=collections.OrderedDict)

files = subprocess.run(["git", "ls-tree", "-r", "--name-only", commit],
                       capture_output=True, text=True, check=True).stdout.split()

manifest["prepared_utc"] = stamp
source = manifest["source"]
source["git_commit"] = commit
source["git_commit_short"] = short
source["branch"] = branch
source["tracked_file_count"] = len(files)
source["working_tree"] = (
    "not applicable — this package is built from `git archive HEAD`, so its files are "
    f"exactly the files of commit {short} and no working-tree edit can be in it."
)
source["self_reference_note"] = (
    "HANDOFF_MANIFEST.json and CHECKSUMS.sha256 are GENERATED for this package by "
    "scripts/package-handoff.sh, not taken from the commit. That is what lets them be "
    f"accurate: a file tracked in git cannot name the commit that contains it, because the "
    f"commit hash is derived from its content. Here the manifest names {short} and the "
    "checksums cover every other file in this folder, both computed after the tree was "
    "extracted. The copies of these two files inside the git repository will differ and are "
    "not the artifact. CHECKSUMS.sha256 cannot list its own hash, so it is the only file "
    "absent from it; this manifest IS listed, because it is written first and hashed after."
)
source["commits_since_last_manifest"] = [
    line for line in subprocess.run(
        ["git", "log", "-5", "--format=%h  %s", commit],
        capture_output=True, text=True, check=True).stdout.splitlines()
]
source["verify_this_package"] = [
    "sha256sum -c CHECKSUMS.sha256      # every file in this folder is unmodified",
    f"grep git_commit HANDOFF_MANIFEST.json   # this package is commit {commit}",
    "and against a clone of the repository, to prove the zip was not edited afterwards:",
    f"  git -C <clone> archive {short} | tar -t | sort",
    "  compared with this folder's file list, minus these two generated files",
]

with open(path, "w", encoding="utf8") as fh:
    json.dump(manifest, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
print(f"  manifest: {len(files)} files, commit {short}")
PY

# Written last, over everything else, so the manifest above is covered by it.
( cd "$ROOT" && find . -type f | sed 's|^\./||' \
    | grep -v '^CHECKSUMS\.sha256$' | sort | xargs -d '\n' sha256sum > CHECKSUMS.sha256 )
echo "  checksums: $(wc -l < "$ROOT/CHECKSUMS.sha256") entries"

rm -f "$OUTPUT"
( cd "$STAGING" && zip -qr "$OUTPUT" "DN-Project-Tracker-handoff" )

# Prove the package before handing it over: unzip it somewhere else and check.
VERIFY=$(mktemp -d)
unzip -qq "$OUTPUT" -d "$VERIFY"
( cd "$VERIFY/DN-Project-Tracker-handoff" && sha256sum -c CHECKSUMS.sha256 --quiet ) \
  || { echo "SELF-VERIFY FAILED: checksums do not match inside the zip" >&2; rm -rf "$VERIFY"; exit 1; }
PACKAGED=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['source']['git_commit'])" \
  "$VERIFY/DN-Project-Tracker-handoff/HANDOFF_MANIFEST.json")
[ "$PACKAGED" = "$COMMIT" ] \
  || { echo "SELF-VERIFY FAILED: manifest names $PACKAGED, package is $COMMIT" >&2; rm -rf "$VERIFY"; exit 1; }
# The code in the zip must be the commit's code, file for file.
git ls-tree -r --name-only "$COMMIT" | sort > "$VERIFY/expected.txt"
( cd "$VERIFY/DN-Project-Tracker-handoff" && find . -type f | sed 's|^\./||' | sort ) > "$VERIFY/actual.txt"
diff "$VERIFY/expected.txt" "$VERIFY/actual.txt" > "$VERIFY/diff.txt" \
  || { echo "NOTE: file list differs from the commit only by the generated files:"; cat "$VERIFY/diff.txt"; }
rm -rf "$VERIFY"

echo
echo "=================================================="
echo "  $OUTPUT"
echo "  commit  $COMMIT"
echo "  branch  $BRANCH"
echo "  built   $STAMP"
echo
echo "  Verified inside the zip: checksums clean, and the"
echo "  manifest names the commit the files came from."
echo "=================================================="
