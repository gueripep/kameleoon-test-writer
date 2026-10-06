#!/usr/bin/env bash
# Restores an archived experiment into the working files.
# Usage: ./scripts/restore.sh [.archive/<folder>]   (no argument = most recent archive)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SRC="${1:-}"
if [ -z "$SRC" ]; then
    SRC="$(ls -1d .archive/*/ 2>/dev/null | sort | tail -1 || true)"
    [ -z "$SRC" ] && { echo "Nothing in .archive/ to restore." >&2; exit 1; }
fi
SRC="${SRC%/}"
[ -d "$SRC" ] || { echo "Not a folder: $SRC" >&2; exit 1; }
[ -f "$SRC/variation.js" ] || [ -f "$SRC/variation.css" ] || { echo "No variation files in $SRC" >&2; exit 1; }

# Don't lose current work: archive it first (archive.sh skips content that is already archived).
if [ -s variation.js ] || [ -s variation.css ]; then
    ./scripts/archive.sh
fi

for f in variation.js variation.css; do
    if [ -f "$SRC/$f" ]; then
        cp "$SRC/$f" "$f"
        echo "  restored $f"
    fi
done

# Work continued from here is another version of the same test, so it carries the archive's id.
[ -s "$SRC/.test-id" ] || echo "$(date +%Y%m%d%H%M%S)-$RANDOM" > "$SRC/.test-id"
cp "$SRC/.test-id" .test-id

echo "Restored from $SRC"
