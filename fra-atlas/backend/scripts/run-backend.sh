#!/usr/bin/env bash
# Cross-platform launcher for the backend dev server. Runs uvicorn using the
# project's venv, from the fra-atlas/ root regardless of where this is
# invoked from. Was scripts/run-backend.js (Node) — converted to a plain
# shell script since it never did anything Node-specific, so the root-level
# package.json/package-lock.json that existed only to run it are gone too.
#
# Usage (from anywhere): bash backend/scripts/run-backend.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "venv/Scripts/python.exe" ]]; then
  PYTHON="venv/Scripts/python.exe"   # Windows venv layout
else
  PYTHON="venv/bin/python"           # macOS/Linux venv layout
fi

exec "$PYTHON" -m uvicorn backend.main:app --reload --port 8000
