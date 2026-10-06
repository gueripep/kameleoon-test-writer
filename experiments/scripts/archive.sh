#!/usr/bin/env bash
# Archives the current variation files into .archive/<date>-<ai-name>/ then resets variation.js/.css to blank starters.
# Name comes from Gemini (see scripts/name_experiment.py); pass an argument to override it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# GEMINI_API_KEY lives in .env (gitignored); an already-exported one wins.
if [ -f .env ] && [ -z "${GEMINI_API_KEY:-}" ]; then
    set -a
    . ./.env
    set +a
fi

RAW_NAME="${1:-}"
if [ -n "$RAW_NAME" ]; then
    SLUG="$(printf '%s' "$RAW_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-//; s/-$//')"
else
    echo "Naming experiment..."
    SLUG="$(python3 scripts/name_experiment.py)"
fi
[ -z "$SLUG" ] && SLUG="experiment"

BASE=".archive/$(date +%Y-%m-%d_%H%M)-$SLUG"
# Never write into an existing archive — a same-minute, same-name run must not clobber it.
DEST="$BASE"
N=2
while [ -e "$DEST" ]; do
    DEST="$BASE-$N"
    N=$((N + 1))
done
mkdir -p "$DEST"

for f in variation.js variation.css; do
    [ -f "$f" ] && cp "$f" "$DEST/$f"
done

: > variation.js

: > variation.css

echo "Archived to $DEST"
echo "variation.js and variation.css reset."
