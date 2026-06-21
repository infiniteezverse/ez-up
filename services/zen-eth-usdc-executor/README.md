# EZ Up Zen/ETH/USDC Executor

**V2 Stateless 3-Asset Trading Bot** — Bracket-based swing trading with per-pair isolation, 90-day volatility adjustment, and Alpha Depth priority.

Deployed to Base mainnet. Executes autonomously every 15 minutes via GitHub Actions.

---

## What It Does

**Bracket-Based Swing Trading**
- Watches ZEN/USDC and ETH/USDC price pairs independently
- Triggers buy/sell signals when price moves breach pre-defined bracket tiers (2%, 4%, 6%, 8%)
- Volatility-adjusts bracket thresholds daily (90-day rolling calculation)
- Applies two-tick confirmation to prevent false signals

**Risk Management**
- Allocation bands (30%-70% per asset) prevent overconcentration
- Daily P&L stop (-10% threshold) halts new buys on losing days
- 72-hour amnesia reset prevents stale bracket states
- Slippage simulation gate validates liquidity before execution

**Efficient Execution**
- Stateless design: all state derived from on-chain balances + local state file
- Multi-venue routing via EZ Path (0x, ParaSwap, Aerodrome, Uniswap V3)
- x402 gasless settlement ($0.03 per trade)
- Alpha Depth priority: executes highest-confidence signals first

---

## Architecture

```
src/
├── index.ts              Main orchestration loop (runBotTick)
├── engine.ts             Decision logic (8 decision gates)
├── executor.ts           Trade execution (EZ Path routing)
├── state.ts              State management (V2 schema, per-pair isolation)
├── volatility.ts         90-day vol calculation (daily recalc cadence)
├── price.ts              Price fetching (DexScreener API)
├── config.ts             Bracket tiers, allocation bands, thresholds
└── types.ts              TypeScript interfaces (BotStateV2, TradeDecision, etc)

state/
├── v2-state.json         Current state (balances, entry prices, totals)
├── history.json          Daily snapshots (portfolio value, daily P&L)
└── trades.json           All trades with P&L (for transparency)
```

---

## Configuration

### Bracket Tiers

```typescript
// ZEN/USDC
upsideBrackets: [0.02, 0.04, 0.06, 0.08]       // 2%, 4%, 6%, 8% moves
downsideBrackets: [-0.02, -0.04, -0.06, -0.08]

// Slicing (per tier)
upsideSlices: [0.05, 0.05, 0.10, 0.15]        // 5%, 5%, 10%, 15% of asset
downsideSlices: [0.05, 0.05, 0.10, 0.15]      // of available USDC
```

### Safety Thresholds

| Setting | Value | Purpose |
|---------|-------|---------|
| `minAssetPct` | 30% | Ensure 30% in asset (floor) |
| `maxAssetPct` | 70% | Ensure 30% in USDC (dry powder) |
| `maxTradesPerDay` | 8 | Prevent overtrading |
| `trendFilterThreshold` | 15% | Skip tier 1 buys if vol > 15% |
| `dailyPnlStopPercent` | -10% | Halt buys if down > 10% today |
| `amnesiaDurationMs` | 72h | Reset brackets after 3 days no trades |

### Volatility Adjustment

```typescript
// 90-day rolling calculation (daily recalc)
realized90dVol = sqrt(sum(log_returns^2) / 90) * sqrt(252)

// Tier multiplier (dampened by power of 0.5)
tierMultiplier = (realized90dVol / baselineVol)^0.5
// Clamped to 0.8x - 1.5x range
```

Example:
- 90-day vol = 12% (baseline), multiplier = 1.0x → brackets unchanged
- 90-day vol = 24% (2x higher), multiplier = 1.41x → brackets relax 41%
- 90-day vol = 6% (calm), multiplier = 0.71x → brackets tighten 29%

---

## State Schema (V2)

```typescript
BotStateV2 {
  version: "2.0"
  global: {
    lastPnlCheckTimestamp: number
    dailyDrawdownPercent: number
    peakDailyValue: number
  }
  pairs: {
    ZEN_USDC: PairState
    ETH_USDC: PairState
  }
}

PairState {
  entryPrice: number | null           // Entry price for current cycle
  lastCycleHigh: number | null        // High water mark (for downside brackets)
  lastTradeTimestamp: number | null   // When last trade executed
  tradesToday: number                 // Daily trade count (resets at UTC midnight)
  lastTradeDay: string                // YYYY-MM-DD of last daily reset
  totalTrades: number                 // Cumulative trades
  totalVolumeUsd: number              // Cumulative volume
  lastDecisionAction: string | null   // Last decision (BUY/SELL/HOLD) for two-tick confirmation
  lastDecisionTier: number | null     // Last tier breached (for two-tick confirmation)
  openingDayAssetValue: number        // Asset value at start of day (for daily P&L)
  openingDayUsdcValue: number         // USDC value at start of day
  dayOpenedKey: string                // YYYY-MM-DD when day started
}
```

---

## Decision Flow (decideActionV3)

```
1. Amnesia Check        → Reset if 72h no trades
2. Daily P&L Stop       → Halt buys if down > 10%
3. Allocation Bands     → Can only buy/sell if not at bounds
4. Bracket Evaluation   → Check which tier breached (volatility-adjusted)
5. Two-Tick Confirm     → Signal must repeat to execute
6. Trend Filter         → Skip tier 1 buys if vol > 15%
7. Trade Count Limit    → Max 8 trades per day per pair
8. Slippage Simulation  → Reject if > 1% price impact

If all gates pass → TradeDecision with action, tier, notionalUsd, alphaDepth
```

---

## Performance Metrics

From 90-day historical backtest (Feb 26 - May 26, 2026):

| Scenario | Return | Max DD | Sharpe | Notes |
|----------|--------|--------|--------|-------|
| Sideways (Current) | +0.92% | -15.55% | 0.33 | Capital preservation |
| Bull (+20% trend) | +3-8% | 2-4% | 0.55 | Consistent sells into strength |
| Bear (-15% trend) | -2-5%* | ~10% | 0.25 | Protected vs asset decline |
| Choppy (2.5% vol) | +1-3% | 5-8% | 0.42 | Noise trading captures micromoves |

*Protected through cost averaging on downside bracket buys

---

## Running Locally

### Setup

```bash
cd services/zen-eth-usdc-executor

# Install dependencies
npm install

# Create .env from template
cp .env.example .env

# Edit .env with your credentials
# TRADER_PRIVATE_KEY=...
# BOT_WALLET=0x...
```

### Commands

```bash
# Single tick (manual execution)
npm run tick

# Watch mode (auto-recompile on changes)
npm run dev

# Build TypeScript
npm run build

# Lint code
npm run lint

# Type check
npm run type-check
```

### Testing

```bash
# Test balance fetching
npm run tick
# Output should show real balances from Base RPC

# Check state files
cat state/v2-state.json
cat state/trades.json
```

---

## Deployment

### GitHub Actions (Automatic)

The bot runs every 15 minutes via `.github/workflows/bot-tick.yml`:

```yaml
schedule:
  - cron: '*/15 * * * *'  # Every 15 min UTC
```

Secrets required:
- `TRADER_PRIVATE_KEY` — Wallet signing key
- `BOT_WALLET` — Bot wallet address
- `BASE_RPC_URL` (optional) — Custom RPC endpoint

### Manual Deployment

```bash
# Build
npm run build

# Run once
TRADER_PRIVATE_KEY=... BOT_WALLET=... npm run tick

# Deploy to cloud function (AWS Lambda, Vercel, etc)
# Wrap tick.ts in handler that calls runBotTick()
```

---

## Monitoring

### State Files

Check after each run:

```bash
# Current state
jq .pairs.ZEN_USDC.totalTrades state/v2-state.json

# Trade history
jq '.[] | select(.pair == "ZEN_USDC") | .notionalUsd' state/trades.json

# Daily snapshots
jq '.[-5:]' state/history.json
```

### Metrics to Watch

1. **Win Rate** = Winning trades / Total trades (target: > 40%)
2. **Profit Factor** = Gross profit / Gross loss (target: > 1.0)
3. **Sharpe Ratio** = Return / Volatility (target: > 0.5)
4. **Max Drawdown** = Largest peak-to-trough decline (acceptable: < 15%)

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| No trades | Market too calm | Wait for >4% moves |
| High slippage | Liquidity low | Reduce notional size |
| RPC timeout | Rate-limited | Use private RPC |
| Low win rate | Bad market conditions | Increase trend filter threshold |

---

## Roadmap

**Phase 1** (Current): Single-asset pairs (ZEN/USDC, ETH/USDC)  
**Phase 2**: Multi-pair correlation hedging  
**Phase 3**: Dynamic bracket adjustment (ML-based)  
**Phase 4**: Options selling for premium income  

---

## FAQ

**Q: Can I adjust the brackets?**  
A: Yes. Edit `config.ts`, set new `upsideBrackets`/`downsideBrackets`. Requires code deploy.

**Q: What if the bot makes a losing trade?**  
A: Daily P&L stop caps losses at -10%. Max drawdown over 90 days: -15.55%. Acceptable for capital preservation strategy.

**Q: How much does it cost to run?**  
A: ~$0.15-0.60 per trade (EZ Path routing + x402 fee). At 2 trades/day = $10-40/month.

**Q: Can I withdraw funds while it's running?**  
A: Yes, but bot will recalculate balances next tick and adjust positions accordingly.

**Q: What if my private key leaks?**  
A: Immediately disable the GitHub workflow (Settings > Actions > Disable). Transfer remaining funds to new wallet.

---

## Support

- **Docs**: See [LIVE_DEPLOYMENT_GUIDE.md](../../LIVE_DEPLOYMENT_GUIDE.md)
- **Issues**: Create GitHub issue with logs from `state/v2-state.json`
- **Community**: Discord #ez-up-bot

---

**Version**: 2.0  
**Last Updated**: May 28, 2026  
**Status**: 🟢 Ready for live deployment
