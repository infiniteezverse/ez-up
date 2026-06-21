# 🚀 EZ Up Live Deployment Guide

This guide walks through getting the bot trading live on Base mainnet via GitHub Actions.

---

## Prerequisites

You'll need:
- ✅ A wallet with ZEN, ETH, and USDC on Base mainnet
- ✅ The private key to that wallet (stored securely)
- ✅ Access to infiniteezverse GitHub repository
- ✅ At least $20-50 USDC to fund initial trades

---

## Phase 1: Wallet Setup

### Step 1: Create or Import Bot Wallet

**Option A: Use Existing Wallet**
```bash
# Export private key from MetaMask:
# 1. MetaMask > Settings > Security & Privacy > Show Private Key
# 2. Copy the 64-character hex string (without 0x)
# 3. Keep this secure — store in 1Password or similar
```

**Option B: Create Fresh Wallet**
```bash
# Using Cast (Foundry):
cast wallet new

# Or with web3.js:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 2: Fund the Wallet

Transfer to your bot wallet on Base:
- **ZEN**: $75-200 (recommendation: start with $75)
- **ETH**: $60-100 (for gas + WETH reserves)
- **USDC**: $15-50 (dry powder for buys)

**Total starting capital**: $150-350

---

## Phase 2: Repository Setup

### Step 1: Push Code to infiniteezverse

```bash
# Navigate to the project
cd /Users/tylermiller/dev/ez-up

# Initialize Git (if not already done)
git init
git add .
git commit -m "Initial commit: EZ Up trading bot + landing page"

# Add infiniteezverse remote
git remote add origin https://github.com/infiniteezverse/ez-up.git

# Push to main
git branch -M main
git push -u origin main
```

### Step 2: Create Secrets in GitHub

Go to **Settings > Secrets and variables > Actions** and add:

**TRADER_PRIVATE_KEY**
- Value: Your wallet's private key (64 hex chars, no 0x)
- Example: `a1b2c3d4e5f6...` (64 characters)

**BOT_WALLET**
- Value: Your wallet address with 0x prefix
- Example: `0xDFF28E0BeB39B046A276C78D3eF42b24aaE7C6F6`

**BASE_RPC_URL** (Optional)
- Value: Your RPC endpoint (if using private node)
- Default: `https://mainnet.base.org` (public, rate-limited)

### Step 3: Verify Workflow File

Check that `.github/workflows/bot-tick.yml` exists:

```bash
ls -la .github/workflows/bot-tick.yml
# Should output: .github/workflows/bot-tick.yml
```

---

## Phase 3: Verify Integration

### Test Balance Fetching

Run the bot locally to verify it can read balances:

```bash
cd services/zen-eth-usdc-executor

# Create .env with your credentials
cp .env.example .env
# Edit .env and add TRADER_PRIVATE_KEY and BOT_WALLET

# Run a test tick
npm run tick
```

Expected output:
```
[index.ts] ✓ Balances fetched from Base RPC:
  ZEN:  75.1234
  ETH:  60.5678
  USDC: 15.00
```

### Monitor Workflow Runs

Go to **Actions** in GitHub:
- Watch for "EZ Up Bot Trading Tick" runs
- Each run should complete in < 30 seconds
- Check logs for any errors

---

## Phase 4: Live Trading Activation

### Step 1: Enable Workflow

```bash
# The workflow is automatically enabled when pushed
# Verify it's active in GitHub: Actions > Workflows
```

### Step 2: Manual Trigger (Optional)

Test the first run manually:
1. Go to GitHub repo > Actions
2. Click "EZ Up Bot Trading Tick"
3. Click "Run workflow" > "Run workflow"
4. Check logs to confirm execution

### Step 3: Automatic Schedule

The bot will automatically run:
- **Every 15 minutes** (cron: `*/15 * * * *`)
- At: 00, 15, 30, 45 minutes of each hour
- In UTC timezone

---

## Monitoring & Debugging

### Check Workflow Status

```bash
# View recent runs
gh run list --repo infiniteezverse/ez-up --limit 10

# View specific run logs
gh run view <RUN_ID> --repo infiniteezverse/ez-up --log
```

### Common Errors & Fixes

**Error: "TRADER_PRIVATE_KEY not set"**
```
Solution:
1. Go to Settings > Secrets > Actions
2. Verify TRADER_PRIVATE_KEY is added
3. Re-run the workflow
```

**Error: "Balance fetch error: Network timeout"**
```
Solution:
1. The public RPC endpoint is rate-limited
2. Add a private RPC URL to BASE_RPC_URL secret
3. Or wait 5 minutes and try again
```

**Error: "Insufficient balance for trade"**
```
Solution:
1. Bot is trying to trade but wallet has < min notional
2. Fund wallet with more USDC
3. Or wait for better market conditions to trigger smaller trades
```

---

## Performance Monitoring

### State Files

The bot saves state after each tick:
```
services/zen-eth-usdc-executor/
├── state/
│   ├── v2-state.json        (current balances, entry prices, totals)
│   ├── history.json         (daily snapshots)
│   └── trades.json          (all trades with P&L)
```

These are committed to GitHub automatically.

### Live Dashboard (Optional)

To view live bot performance:
1. Deploy landing page (apps/landing/) to ezuptech.xyz
2. Update VITE_JUICEBOX_URL and HISTORY_URL in config
3. Landing page will pull live data from GitHub

---

## Disaster Recovery

### If Wallet Gets Compromised

1. **Immediately**: Transfer remaining funds to a new wallet
2. **In GitHub**: 
   - Go to Settings > Secrets
   - Delete TRADER_PRIVATE_KEY
   - Workflow will fail on next run (desired — stops trading)
3. **Update workflow**: 
   - Create new wallet with new private key
   - Add new secret
   - Re-enable workflow

### If Bot Makes Bad Trade

The bot has safeguards:
- Daily P&L stop (-10%) prevents large losses
- Two-tick confirmation prevents false signals
- Max 8 trades per day per asset pair

To pause trading:
1. Go to GitHub Actions
2. Click "EZ Up Bot Trading Tick"
3. Click "Disable workflow"
4. Fix the issue
5. Re-enable and test manually

---

## Optimization & Scaling

### After 7 Days (Initial Testing Phase)

If performance looks good:
- Review state/trades.json for actual P&L
- Check workflow logs for any warnings
- Monitor gas costs (tracked in execution logs)

### After 30 Days (Scale-Up Phase)

If comfortable with live trading:
- Increase initial capital by 2-3x
- Monitor Sharpe ratio and max drawdown
- Consider adjusting bracket thresholds
- Add second pair or increase notional sizes

### Gas Cost Management

The bot tracks:
- x402 settlement fee: $0.03 per trade
- EZ Path routing fee: ~$0.10-0.50 per trade
- Total per trade: ~$0.15-0.60

At 2 trades per day: ~$0.30-1.20 daily cost = $10-40 per month

---

## Success Criteria

Your deployment is live and working when:

✅ Workflow runs every 15 minutes (check Actions page)  
✅ State files update after each run (check state/ directory)  
✅ No errors in workflow logs  
✅ Balances match your wallet (run `npm run tick` locally)  
✅ First trade is executed (check state/trades.json)  

---

## Next Steps

1. **Juicebox Treasury**: Deploy project to enable user contributions
2. **Landing Page**: Update with live data from GitHub
3. **Token Rewards**: Deploy EZ Up token + Games/Tasks backend
4. **Community**: Announce on socials that EZ Up is trading live

---

## Support

For issues:
1. Check workflow logs: Settings > Actions > Recent runs
2. Review state/v2-state.json for bot state
3. Test locally: `npm run tick` with .env file
4. Check Base RPC status: https://status.base.org

**Contact**: @infiniteezverse on Twitter or GitHub discussions

---

**Deployment Date**: [Your deployment date]  
**Initial Capital**: [Your amount]  
**Bot Wallet**: [Your wallet address]
