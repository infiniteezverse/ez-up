# 🚀 EZ Up Live Deployment Checklist

Complete these steps to get the bot trading live on Base mainnet.

---

## ✅ Pre-Deployment (Do These First)

- [ ] **Wallet Setup**
  - [ ] Create or identify bot wallet on Base
  - [ ] Export private key (keep secure)
  - [ ] Fund with: $75-200 ZEN, $60-100 ETH, $15-50 USDC
  
- [ ] **Code Review**
  - [ ] Review `services/zen-eth-usdc-executor/src/index.ts` (balance fetching)
  - [ ] Review `services/zen-eth-usdc-executor/src/executor.ts` (trade execution)
  - [ ] Confirm config.ts bracket thresholds are acceptable
  - [ ] Test locally: `npm run tick` (should show real balances)

- [ ] **Repository Setup**
  - [ ] Ensure code is pushed to infiniteezverse GitHub
  - [ ] Verify `.github/workflows/bot-tick.yml` exists
  - [ ] Verify `services/zen-eth-usdc-executor/.env.example` exists

---

## ✅ GitHub Configuration (Required for Live)

- [ ] **Add Secrets**
  - [ ] Go to: GitHub repo > Settings > Secrets and variables > Actions
  - [ ] Create secret: `TRADER_PRIVATE_KEY` = your private key (64 hex chars, no 0x)
  - [ ] Create secret: `BOT_WALLET` = your address (with 0x)
  - [ ] Create secret (optional): `BASE_RPC_URL` = your RPC endpoint

- [ ] **Verify Workflow**
  - [ ] Go to: Actions tab
  - [ ] Find "EZ Up Bot Trading Tick"
  - [ ] Verify it's showing in active workflows (not disabled)

- [ ] **Test First Run**
  - [ ] Click "EZ Up Bot Trading Tick" > "Run workflow"
  - [ ] Select "main" branch > "Run workflow"
  - [ ] Wait 2-3 minutes for completion
  - [ ] ✓ Check logs for "✓ Balances fetched from Base RPC"
  - [ ] ✓ Verify no errors in logs

---

## ✅ Automatic Operation (After First Test)

- [ ] **Automatic Schedule Enabled**
  - [ ] Workflow runs every 15 minutes automatically
  - [ ] No manual intervention needed
  - [ ] Monitor via Actions > Workflow runs

- [ ] **State File Tracking**
  - [ ] After first run, check `state/` directory
  - [ ] Files created:
    - `state/v2-state.json` (current state)
    - `state/history.json` (daily snapshots)
    - `state/trades.json` (all trades)
  - [ ] Verify these are committed to GitHub

---

## ✅ Monitoring & Verification (Daily)

- [ ] **Daily Health Check**
  - [ ] Go to Actions tab
  - [ ] Verify workflow ran in last 15 minutes
  - [ ] Check logs for errors (should be empty)
  - [ ] View latest state files (should have trades or HOLDs)

- [ ] **Weekly Performance Review**
  - [ ] Open `state/trades.json`
  - [ ] Calculate P&L: sum of realized trades
  - [ ] Check win rate: winning trades / total trades
  - [ ] Compare to expected return range

- [ ] **Risk Management**
  - [ ] Verify daily P&L stop works (should trigger at -10%)
  - [ ] Check max drawdown hasn't exceeded 15%
  - [ ] Ensure allocation bands enforced (30%-70%)

---

## ⚠️ If Issues Occur

**Workflow Not Running**
- [ ] Check workflow is enabled (not disabled)
- [ ] Check secrets are set (Settings > Secrets)
- [ ] Manually trigger one run to test
- [ ] Review logs for error messages

**Balance Fetching Fails**
- [ ] Verify `BOT_WALLET` is set correctly (with 0x)
- [ ] Check wallet address is valid on Base
- [ ] Try public RPC: set `BASE_RPC_URL` to `https://mainnet.base.org`
- [ ] Verify wallet has balance (fund if empty)

**No Trades Executing**
- [ ] This is normal if market conditions don't breach brackets
- [ ] Check logs: should see "HOLD" decisions
- [ ] Wait for 4%+ price moves to trigger trades
- [ ] See historical backtest for expected trade frequency

**Trades Failing**
- [ ] Check `TRADER_PRIVATE_KEY` is correct (64 chars, no 0x)
- [ ] Verify wallet has USDC for transaction fees
- [ ] Check EZ Path routing (may timeout if liquidity low)
- [ ] Disable workflow, debug locally, re-enable

**Private Key Leaked**
- [ ] 🚨 IMMEDIATE: Disable workflow (Settings > Actions > Disable)
- [ ] Transfer remaining funds to new wallet
- [ ] Create new wallet, get private key
- [ ] Update secrets with new key
- [ ] Re-enable workflow

---

## ✅ Operational Checklist (After Live)

**Week 1: Initial Testing**
- [ ] Monitor 7 days of operation (168 ticks)
- [ ] Check at least 1 trade executed (or confirm HOLDs are correct)
- [ ] Verify no errors in logs
- [ ] Calculate P&L and Sharpe ratio

**Week 2-3: Stability**
- [ ] Continue monitoring daily
- [ ] Increase capital if P&L looks positive (+5% or better)
- [ ] Document any issues found
- [ ] Prepare for scale-up if stable

**Month 1: Scale & Optimize**
- [ ] Review state/trades.json for trade quality
- [ ] Check if bracket thresholds need adjustment
- [ ] Consider increasing notional sizes (if P&L good)
- [ ] Plan next phase (Juicebox deployment, token rewards)

---

## 📊 Success Metrics

Your deployment is successful when:

✅ Workflow runs every 15 minutes without errors  
✅ Balances are correctly fetched from Base RPC  
✅ State files update after each tick  
✅ At least 1 trade executed in first 7 days  
✅ No emergency errors in logs  
✅ P&L is positive or neutral (not -15% drawdown)  

---

## 🎯 Next Phases (After Live Verified)

**Phase 2: Juicebox Deployment**
- [ ] Deploy Juicebox treasury (you trigger manually)
- [ ] Accept first community contributions
- [ ] Publish contributions to GitHub

**Phase 3: Landing Page**
- [ ] Update apps/landing/ with live data
- [ ] Connect to state/history.json for performance chart
- [ ] Deploy to ezuptech.xyz

**Phase 4: Token Rewards**
- [ ] Deploy EZ Up token contract
- [ ] Fund Gas Tank wallet
- [ ] Build games/tasks backend
- [ ] Enable token rewards for players

---

## 📝 Deployment Record

```
Deployment Date: ___________________
Bot Wallet:      ___________________
Initial Capital: ___________________
Private Key:     [STORED SECURELY]

GitHub Actions URL:
https://github.com/infiniteezverse/ez-up/actions

First Trade Date: ___________________
First Trade Pair: ___________________
```

---

## 🆘 Support

If you get stuck:
1. Check [LIVE_DEPLOYMENT_GUIDE.md](./LIVE_DEPLOYMENT_GUIDE.md)
2. Review workflow logs: Actions > Recent runs > View logs
3. Test locally: `npm run tick` with .env file
4. Create GitHub issue with error logs

---

**Once you complete all checkboxes, your bot is LIVE and trading autonomously on Base! 🎉**
