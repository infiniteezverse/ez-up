#!/usr/bin/env bash
#
# tick-and-publish.sh
# Runs one bot tick, then publishes state/history.json to GitHub if it changed.
#
# Intended for cron. Safe to run frequently — it only commits/pushes when the
# snapshot file actually changes, so it won't spam git history.
#
# Setup:
#   1. chmod +x scripts/tick-and-publish.sh
#   2. Add to crontab (example: every 15 minutes):
#      */15 * * * * /Users/you/dev/ez-up/services/zen-usdc-trader/scripts/tick-and-publish.sh >> /tmp/ez-up-bot.log 2>&1
#   3. Make sure TRADER_PRIVATE_KEY is set in the .env file beside index.ts
#   4. Make sure `git push` works non-interactively (SSH key or PAT in HTTPS remote)

set -euo pipefail

# Resolve paths relative to this script so cron works regardless of cwd
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BOT_DIR/../.." && pwd)"
HISTORY_FILE="$BOT_DIR/state/history.json"
TRADES_FILE="$BOT_DIR/state/trades.json"

cd "$BOT_DIR"

# Load .env if present (TRADER_PRIVATE_KEY etc.)
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Find a working node — cron has a stripped PATH
for candidate in \
  "$(command -v node || true)" \
  "$HOME/.nvm/versions/node/v24.15.0/bin/node" \
  "$HOME/.nvm/versions/node/v22.0.0/bin/node" \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node"; do
  if [[ -x "$candidate" ]]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [[ -z "${NODE_BIN:-}" ]]; then
  echo "[$(date -u +%FT%TZ)] ERROR: node not found" >&2
  exit 1
fi

NODE_DIR="$(dirname "$NODE_BIN")"
export PATH="$NODE_DIR:$PATH"

echo "[$(date -u +%FT%TZ)] tick-and-publish starting (node: $NODE_BIN)"

# 1. Run the tick
"$NODE_DIR/npm" run tick

# 2. If history.json or trades.json changed (per git), commit & push
cd "$REPO_ROOT"
HISTORY_CHANGED=0
TRADES_CHANGED=0
git diff --quiet -- "$HISTORY_FILE" || HISTORY_CHANGED=1
# trades.json may not exist yet (no trades fired) — that's fine
if [[ -f "$TRADES_FILE" ]]; then
  if ! git ls-files --error-unmatch "$TRADES_FILE" >/dev/null 2>&1; then
    # Untracked: count as changed
    TRADES_CHANGED=1
  elif ! git diff --quiet -- "$TRADES_FILE"; then
    TRADES_CHANGED=1
  fi
fi

if [[ "$HISTORY_CHANGED" == "1" || "$TRADES_CHANGED" == "1" ]]; then
  CHANGED_SUMMARY=""
  [[ "$HISTORY_CHANGED" == "1" ]] && CHANGED_SUMMARY="history"
  [[ "$TRADES_CHANGED" == "1" ]] && CHANGED_SUMMARY="${CHANGED_SUMMARY:+$CHANGED_SUMMARY+}trades"
  echo "[$(date -u +%FT%TZ)] $CHANGED_SUMMARY changed — pushing"
  [[ "$HISTORY_CHANGED" == "1" ]] && git add "$HISTORY_FILE"
  [[ "$TRADES_CHANGED" == "1" ]] && git add -f "$TRADES_FILE"
  git commit -m "chore: update bot $CHANGED_SUMMARY ($(date -u +%FT%TZ))"
  git push origin main
  echo "[$(date -u +%FT%TZ)] published"
else
  echo "[$(date -u +%FT%TZ)] no changes — skipping push"
fi
