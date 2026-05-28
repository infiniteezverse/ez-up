# 🎯 Price Monitor Deployment Guide

## Overview

The **Continuous Price Monitor** watches price movements in real-time and executes trades **only when price breaches bracket thresholds**. This is more efficient than fixed-interval scheduling.

**Key Characteristics:**
- Checks price every **3 minutes**
- Executes trades **only on bracket breaches** (not every check)
- Responds to market action instead of running on fixed schedule
- Very low infrastructure stress (~480 API calls/day)
- Can run on cheap VPS, local machine, or serverless

---

## How It Works

```
┌─────────────────────────────────────────┐
│  Price Monitor Loop (runs continuously)  │
└────────────┬────────────────────────────┘
             │
             ├─ Every 3 minutes:
             │  ├─ Fetch ZEN & ETH prices
             │  ├─ Check against entry price & cycle high
             │  ├─ Compare vs bracket thresholds
             │  │
             │  ├─ IF bracket breached:
             │  │  └─ Execute runBotTick()
             │  │     ├─ Apply all 5 growth levers
             │  │     ├─ Market regime detection
             │  │     ├─ Dynamic sizing & brackets
             │  │     ├─ Layered profit-taking
             │  │     └─ Update state
             │  │
             │  └─ IF no breach:
             │     └─ Sleep 3 minutes, loop again
             │
             └─ On error: Retry up to 3 times, then stop
```

**Example Flow:**
```
Time 12:00 → Price $6.00 (entry $6.00, no move) → No bracket breach → Sleep
Time 12:03 → Price $6.10 (move +1.67%) → Check: vs bracket tier 1 (2%) → No breach → Sleep
Time 12:06 → Price $6.20 (move +3.33%) → Check: vs bracket tier 2 (4%) → BREACH! → Execute ✅
```

---

## Prerequisites

1. **Node.js 18+** installed
2. **Environment variables** set (.env file):
   ```
   TRADER_PRIVATE_KEY=your_private_key
   BOT_WALLET=your_bot_address
   BASE_RPC_URL=https://mainnet.base.org  # Optional, defaults shown
   ```
3. **Initial state file** at `state/v2-state.json`

---

## Deployment Options

### Option 1: Local Machine (Development/Testing)

Run the monitor on your local machine (must stay online):

```bash
cd services/zen-eth-usdc-executor

# Install dependencies (if not already done)
npm install

# Build TypeScript
npm run build

# Start the price monitor
npm run monitor
```

**Output:**
```
[price-monitor] Starting continuous price monitor (3-minute interval)
[price-monitor] Bot wallet: 0xDFF28E0BeB39B046A276C78D3eF42b24aaE7C6F6
[price-monitor] Press Ctrl+C to stop

[price-monitor] ⏱️  Checking prices... (2026-05-28T16:30:00.000Z)
[price-monitor] Market snapshot:
  ZEN: $6.45 (vol=12.3%)
  ETH: $2345.67 (vol=8.1%)
[price-monitor] ✓ ZEN: No bracket breach
[price-monitor] ✓ ETH: No bracket breach
[price-monitor] 😴 Sleeping for 3 minutes...
```

**Pros:** Easy to test, see logs in real-time  
**Cons:** Requires your machine to stay on 24/7

---

### Option 2: VPS (Production Recommended)

Deploy on a cheap VPS (DigitalOcean, Linode, AWS, etc.) for 24/7 uptime:

#### DigitalOcean Droplet ($5-6/month)

1. **Create Droplet:**
   - Choose Ubuntu 22.04 LTS
   - $6/month (1GB RAM, 1 vCPU) is plenty
   - Size up to $12/month if you want headroom

2. **SSH into droplet:**
   ```bash
   ssh root@your_droplet_ip
   ```

3. **Install Node.js:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node --version  # Verify
   ```

4. **Clone repo and setup:**
   ```bash
   git clone https://github.com/infiniteezverse/ez-up.git
   cd ez-up/services/zen-eth-usdc-executor
   npm install
   ```

5. **Create .env file:**
   ```bash
   cat > .env << EOF
   TRADER_PRIVATE_KEY=your_private_key_here
   BOT_WALLET=your_wallet_address
   BASE_RPC_URL=https://mainnet.base.org
   EOF
   chmod 600 .env  # Secure permissions
   ```

6. **Run with PM2 (process manager for 24/7 uptime):**
   ```bash
   # Install PM2 globally
   sudo npm install -g pm2
   
   # Start the monitor
   pm2 start npm --name "ez-monitor" -- run monitor
   
   # Save PM2 config to restart on reboot
   pm2 startup
   pm2 save
   
   # View logs
   pm2 logs ez-monitor
   
   # Monitor status
   pm2 status
   ```

7. **Verify it's running:**
   ```bash
   pm2 logs ez-monitor | head -20
   ```

**Monitoring on VPS:**
```bash
# Watch logs live
pm2 logs ez-monitor

# Restart if needed
pm2 restart ez-monitor

# Stop (manual)
pm2 stop ez-monitor

# Remove from PM2
pm2 delete ez-monitor
```

---

### Option 3: Serverless (AWS Lambda + EventBridge)

For automatic scaling without server management:

1. **Deploy code to Lambda** (using Serverless Framework or AWS CLI)
2. **Create EventBridge rule** to trigger every 3 minutes
3. **Cost:** ~$1/month for 480 invocations

**Note:** This requires more setup. Use Option 2 (VPS) if just starting out.

---

## Monitoring & Maintenance

### Daily Checks

```bash
# Check if still running
pm2 status

# View last 50 lines of logs
pm2 logs ez-monitor --lines 50

# Check for errors
pm2 logs ez-monitor | grep "error\|Error\|❌"
```

### Weekly Review

```bash
# Check state file for recent trades
cat state/v2-state.json | jq '.pairs.ZEN_USDC | {totalTrades, tradesToday, entryPrice}'

# Check market regime detection accuracy
tail -100 pm2_logs | grep "Regime="
```

---

## Troubleshooting

### Monitor crashed or stopped

```bash
# Restart
pm2 restart ez-monitor

# View error details
pm2 logs ez-monitor --err
```

### Not detecting bracket breaches

```bash
# Check current state
cat state/v2-state.json | jq '.pairs'

# Check logs for price checks
pm2 logs ez-monitor | grep "Market snapshot"
```

### API rate limit errors

```
[price-monitor] ⚠️  Failed to fetch market data, retrying in 30s...
```

**Solution:** DexScreener API limits hit. Monitor will auto-retry. If persistent:
- Increase poll interval to 5 minutes
- Use different price source

### High memory usage

```bash
# Check memory
pm2 monit
```

If memory grows over time:
- State file may be getting too large
- Archive old trades or reset state
- Restart monitor: `pm2 restart ez-monitor`

---

## Cost Comparison

| Method | Monthly Cost | Uptime | Ease |
|--------|------------|--------|------|
| Local Machine | $0 (electricity) | 🔴 Requires manual | ✅ Easy |
| DigitalOcean VPS | $6 | 🟢 99.9% | ✅ Easy |
| AWS Lambda | $1-5 | 🟢 99.99% | 🟠 Medium |
| Heroku | $7+ | 🟢 99.9% | ✅ Easy |

**Recommendation:** DigitalOcean VPS ($6/mo) for best balance

---

## Migration from Fixed Schedule

The old GitHub Actions workflow (every 15 min) is now **manual-only** as a fallback.

**What changed:**
- ❌ Old: `node-cron` scheduler (every 15 min)
- ✅ New: Continuous price monitor (every 3 min, only executes on breach)

**Why better:**
- Price-responsive (executes when market moves)
- More efficient (no wasted gas on non-signals)
- Faster execution (3-min vs 15-min response time)
- Same infrastructure cost (VPS is cheap)

---

## FAQ

**Q: What if the monitor crashes?**  
A: With PM2, it auto-restarts. For production, add monitoring alerts (Sentry, DataDog, etc.)

**Q: Can I run locally and on VPS simultaneously?**  
A: Not recommended (will execute duplicate trades). Pick one.

**Q: How do I scale this to more pairs?**  
A: Add pairs to `checkBracketBreach()` loop in price-monitor.ts

**Q: What's the minimum VPS specs?**  
A: 512MB RAM, 1 vCPU enough. $5/mo options work fine.

**Q: Can I adjust the 3-minute interval?**  
A: Yes, change `POLL_INTERVAL_MS = 3 * 60 * 1000` in price-monitor.ts

---

## Next Steps

1. **Choose deployment method** (local, VPS, or serverless)
2. **Set up .env** with credentials
3. **Start the monitor**: `npm run monitor` (local) or `pm2 start` (VPS)
4. **Verify first trade execution**
5. **Monitor logs daily**

---

**Status:** 🟢 Ready to Deploy  
**Last Updated:** May 28, 2026
