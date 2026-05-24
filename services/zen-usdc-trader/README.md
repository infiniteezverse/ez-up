# EZ-Path ZEN/USDC Swing Trader

Autonomous volatility-harvesting bot for ZEN ↔ USDC on Base. Executes all swaps via [EZ-Path](https://ezpath.myezverse.xyz).

## Strategy (v3)

- **50/50 start** — half USDC, half ZEN
- **30–70% safety bands** — never drift one-sided
- **Multi-tier brackets**: ±4%, ±6%, ±8%, ±12%
- **Convex slices**: 5%, 5%, 10%, 15% (small moves → small trades; big moves → big trades)
- **1-hour cooldown** between trades
- **Max 6 trades/day** (safety cap)
- **Min $10 notional** (avoids dust)
- **Baselines reset** after every successful trade

## Setup

```bash
cd agents/zen-usdc-trader
npm install
cp .env.example .env  # add your TRADER_PRIVATE_KEY
```

**Required env:**
- `TRADER_PRIVATE_KEY` — wallet holding ZEN + USDC + small ETH for gas

**Optional env:**
- `DRY_RUN=true` — simulate decisions without executing
- `TICK_INTERVAL_MS=300000` — tick frequency (default 5min)
- `STATE_PATH=./state/bot-state.json` — state file location

## ⚠️ Before First Run

**Confirm the ZEN contract address** in `src/config.ts`. From DexScreener/BaseScan, the full address starts with `0xf43e...179229` — replace the placeholder before deploying real funds.

## Usage

```bash
# One-shot tick (for cron)
npm run tick

# Continuous loop (every 5min)
npm start

# Dry-run mode (no execution)
npm run dry-run
```

## Cron Deployment

```cron
*/15 * * * * cd /path/to/zen-usdc-trader && TRADER_PRIVATE_KEY=0x... npx tsx src/index.ts --once >> /tmp/zen-trader.log 2>&1
```

## How It Works

1. **Fetch market data** — ZEN/USDC price + 24h volume + 24h change from DexScreener
2. **Read wallet** — ZEN + USDC balances from Base RPC
3. **Compute moves** — upside (vs baseline entry) and downside (vs trailing high)
4. **Find bracket** — highest tier hit (4% → 6% → 8% → 12%)
5. **Apply safeguards**:
   - Check two-tick confirmation (must see same signal 2 ticks in a row)
   - If tier 1 and 24h move > 15%, skip (avoid noise in trends)
   - If down > 10% today, skip buys (don't average into dumps)
6. **Validate trade** — allocation guards (30–70%), min $10 notional
7. **Execute** — swap via EZ-Path (basic tier, $0.03 fee)
8. **Reset baselines** — entryPrice and lastCycleHigh back to current price

## State

Persisted to `./state/bot-state.json`:
- `entryPrice` — reference for upside brackets
- `lastCycleHigh` — reference for downside brackets
- `lastTradeAt` — cooldown anchor
- `tradesToday` / `lastTradeDay` — daily cap
- `totalTrades` / `totalVolumeUsd` — lifetime metrics

## Safety Mechanisms

**Structural Guards:**
- ✅ Never sells if ZEN < 30% of portfolio
- ✅ Never buys if ZEN > 70% of portfolio
- ✅ Skips trades below $10 notional
- ✅ Hard cap at 8 trades/day
- ✅ Uses EZ-Path for routing (no slippage/MEV)

**Anti-Fake-Out Safeguards (v3):**
- ✅ **Two-tick confirmation** — bracket condition must hold for 2 consecutive ticks before executing (filters wicks & flash crashes)
- ✅ **Trend filter** — if 24h move > 15%, skip tier 1 (4%) brackets; let real trends run without noise trading
- ✅ **Daily P&L stop** — halt all buys if portfolio down > 10% today (prevents knife-catching in dumps)

## License

MIT
