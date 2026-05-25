#!/usr/bin/env bash
#
# run-backtest.sh — wrapper around src/backtest/runner.ts
#
# Usage:
#   ./scripts/run-backtest.sh                 # default: 90d, default fee/slippage
#   ./scripts/run-backtest.sh --days 30       # shorter window
#   ./scripts/run-backtest.sh --slippage 25   # more pessimistic slippage

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$BOT_DIR"

# Find a working node binary (cron-friendly)
for candidate in \
  "$(command -v node || true)" \
  "$HOME/.nvm/versions/node/v24.15.0/bin/node" \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node"; do
  if [[ -x "$candidate" ]]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [[ -z "${NODE_BIN:-}" ]]; then
  echo "ERROR: node not found" >&2
  exit 1
fi

export PATH="$(dirname "$NODE_BIN"):$PATH"

exec npx tsx src/backtest/runner.ts "$@"
