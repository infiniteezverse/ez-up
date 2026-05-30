# DigitalOcean Deployment Guide

Complete guide to deploy EZ Up Trading Bot on DigitalOcean with PM2 process management.

## 📋 What You'll Deploy

- **Price Monitor** (`ez-price-monitor`): Continuous price checking every 3 minutes → Event-driven trade execution
- **Dashboard** (`ez-dashboard`): Real-time web interface on port 3000
- **PM2 Management**: Auto-restart on crashes, auto-startup on reboot, process monitoring
- **GitHub Integration**: Auto-pull latest code on deployment

---

## 🚀 Step 1: Create DigitalOcean Droplet

### Create New Droplet

1. Go to [DigitalOcean Console](https://cloud.digitalocean.com)
2. Click **Create** → **Droplet**
3. Configure:
   - **Image:** Ubuntu 24.04 LTS
   - **CPU options:** Shared (sufficient for trading bot)
   - **Droplet Type:** Basic
   - **Size:** $6/month (2GB RAM, 1 vCPU)
   - **Region:** Choose closest to you
   - **SSH Keys:** Add your SSH key (or use password)

### User Data Script (Startup Script)

Copy and paste this as the startup script in DigitalOcean:

```bash
#!/bin/bash
# EZ Up Trading Bot - DigitalOcean Startup Script (v2)

set -e  # Exit on error

echo "=========================================="
echo "🚀 EZ Up Trading Bot - DigitalOcean Setup"
echo "=========================================="

# Update system packages
echo "📦 Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# Install Node.js 18 (LTS)
echo "📦 Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash - > /dev/null 2>&1
apt-get install -y nodejs > /dev/null 2>&1

NODE_VERSION=$(node --version)
echo "✅ Node.js installed: $NODE_VERSION"

# Install PM2 globally
echo "📦 Installing PM2..."
npm install -g pm2 > /dev/null 2>&1
pm2 install pm2-logrotate > /dev/null 2>&1

# Clone repository
APP_DIR="/root/ez-monitor"
echo "📁 Creating app directory: $APP_DIR"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

echo "📥 Cloning ez-up repository..."
git clone https://github.com/infiniteezverse/ez-up.git . > /dev/null 2>&1

# Navigate to executor service
cd services/zen-eth-usdc-executor

# Install dependencies
echo "📦 Installing npm dependencies..."
npm install > /dev/null 2>&1

# Create .env template
if [ ! -f .env ]; then
    echo "📝 Creating .env template..."
    cat > .env << 'ENVEOF'
# EZ Up Trading Bot Configuration
TRADER_PRIVATE_KEY=your_private_key_here
BOT_WALLET=your_wallet_address_here
BASE_RPC_URL=https://mainnet.base.org
DASHBOARD_PORT=3000
ENVEOF
    chmod 600 .env
fi

# Setup PM2 auto-startup
echo "⚙️  Configuring PM2 for auto-start..."
pm2 startup systemd -u root --hp /root > /dev/null 2>&1

echo ""
echo "=========================================="
echo "✅ SETUP COMPLETE!"
echo "=========================================="
```

**OR** use the pre-configured script:

```bash
# Copy the URL for the startup script
https://raw.githubusercontent.com/infiniteezverse/ez-up/main/services/zen-eth-usdc-executor/digitalocean-startup-v2.sh
```

4. Click **Create Droplet**
5. **Wait 2-3 minutes** for startup script to complete

---

## 🔐 Step 2: Connect & Configure

### SSH into Droplet

```bash
ssh root@YOUR_DROPLET_IP
```

Replace `YOUR_DROPLET_IP` with your actual droplet IP.

### Verify Setup

```bash
# Check if files were cloned
ls -la /root/ez-monitor/services/zen-eth-usdc-executor/

# Verify Node.js
node --version  # Should be v18+

# Verify PM2
pm2 --version   # Should be 7.0+
```

### Configure Credentials

```bash
# Edit .env file
nano /root/ez-monitor/services/zen-eth-usdc-executor/.env
```

Add your credentials:
```env
TRADER_PRIVATE_KEY=your_actual_private_key
BOT_WALLET=your_actual_wallet_address
BASE_RPC_URL=https://mainnet.base.org
DASHBOARD_PORT=3000
```

**Save and exit:** Press `Ctrl+X`, then `Y`, then `Enter`

---

## ▶️ Step 3: Start Services with PM2

### Start Both Services

```bash
cd /root/ez-monitor/services/zen-eth-usdc-executor

# Start both price monitor and dashboard
pm2 start ecosystem.config.cjs

# Verify they're running
pm2 status
```

Expected output:
```
┌────┬─────────────────────┬─────────┬────────┬────────┬──────────┐
│ id │ name                │ status  │ cpu    │ mem    │ uptime   │
├────┼─────────────────────┼─────────┼────────┼────────┼──────────┤
│ 0  │ ez-price-monitor    │ online  │ 0%     │ 45mb   │ 1m       │
│ 1  │ ez-dashboard        │ online  │ 0%     │ 30mb   │ 1m       │
└────┴─────────────────────┴─────────┴────────┴────────┴──────────┘
```

### Save for Auto-Startup on Reboot

```bash
pm2 save
```

This will restart your services automatically if the droplet reboots.

---

## 📊 Step 4: Access Dashboard

### View Dashboard in Browser

Open in your browser:
```
http://YOUR_DROPLET_IP:3000
```

You should see the EZ Up Trading Dashboard with:
- Total trades count
- Trades today
- Volume metrics
- Pair status (ZEN/USDC and ETH/USDC)
- Monitor configuration
- Market regime indicators

---

## 📜 Step 5: Monitor Operations

### Check Status

```bash
# View all processes
pm2 status

# View real-time monitoring
pm2 monit

# View logs (live stream)
pm2 logs

# View specific service logs
pm2 logs ez-price-monitor
pm2 logs ez-dashboard
```

### Common Commands

```bash
# Stop services
pm2 stop ecosystem.config.cjs

# Restart services
pm2 restart ecosystem.config.cjs

# View service history
pm2 restart ecosystem.config.cjs --watch

# Remove from PM2
pm2 delete ecosystem.config.cjs
```

---

## 🔧 Troubleshooting

### Services Not Running

```bash
# Check if they crashed
pm2 logs

# Restart with verbose output
pm2 stop ecosystem.config.cjs
pm2 start ecosystem.config.cjs --no-daemon
```

### Dashboard Not Accessible

```bash
# Check if dashboard is running
pm2 status | grep ez-dashboard

# Check if port 3000 is listening
netstat -tlnp | grep 3000

# Test API directly
curl http://localhost:3000/api/dashboard

# Check dashboard logs
pm2 logs ez-dashboard --lines 50
```

### Price Monitor Not Trading

```bash
# Check if price monitor is running
pm2 status | grep ez-price-monitor

# Check price monitor logs
pm2 logs ez-price-monitor --lines 100

# Look for:
# - "Market snapshot:" lines (price checks)
# - "BRACKET BREACH" messages (when trade triggers)
# - "Executing bot tick..." (actual execution)
```

### High Memory Usage

```bash
# Check memory per process
pm2 monit

# If exceeding limits (500MB price monitor, 300MB dashboard):
pm2 restart ecosystem.config.cjs
```

---

## 🔄 Updating Code from GitHub

When new code is pushed to the main branch:

```bash
cd /root/ez-monitor/services/zen-eth-usdc-executor

# Stop services
pm2 stop ecosystem.config.cjs

# Pull latest code
git pull origin main

# Reinstall dependencies (if package.json changed)
npm install

# Restart services
pm2 start ecosystem.config.cjs
```

Or use automatic deployment (see `.claude/settings.json` for git auto-pull setup).

---

## 📊 Expected Behavior

### Price Monitor (every 3 minutes)

Logs will show:
```
[price-monitor] ⏱️  Checking prices... (2026-05-30T16:50:22.018Z)
[price-monitor] Market snapshot:
  ZEN: $5.76 (vol=98.0%)
  ETH: $2023.87 (vol=54.0%)
[price-monitor] ✓ ZEN: No bracket breach
[price-monitor] ✓ ETH: No bracket breach
[price-monitor] 😴 Sleeping for 3 minutes...
```

When bracket is breached:
```
[price-monitor] 🔴 ZEN BRACKET BREACH: Upside Tier 0 breached: 5.23% >= 3.0%
[price-monitor] 🚀 Executing bot tick...
[index.ts] ZEN Decision: BUY tier 0
[index.ts] Executing trades...
```

### Dashboard

- Refreshes every 30 seconds
- Shows all metrics from state files
- Displays current pair status
- Updates trade counts and volume

---

## 🛡️ Security Notes

- ✅ `.env` file is restricted to `chmod 600` (only readable by root)
- ✅ Private key is never logged or transmitted
- ✅ Use dedicated wallet for bot (not your main wallet)
- ✅ Start with small trade sizes to test
- ⚠️ Never share your `TRADER_PRIVATE_KEY` or `.env` file

---

## 💰 Cost Estimate

- **$6/month**: Basic droplet (2GB RAM, 1 vCPU)
- **$0/month**: PM2 process management (free)
- **$0/month**: GitHub integration (free)
- **Total: $6/month** for production trading bot

---

## 📋 Deployment Checklist

- [ ] Created DigitalOcean droplet with startup script
- [ ] SSH into droplet successfully
- [ ] Verified Node.js and PM2 installed
- [ ] Edited `.env` with `TRADER_PRIVATE_KEY` and `BOT_WALLET`
- [ ] Started services: `pm2 start ecosystem.config.cjs`
- [ ] Verified both services online: `pm2 status`
- [ ] Accessed dashboard: `http://YOUR_DROPLET_IP:3000`
- [ ] Verified price monitor logs: `pm2 logs ez-price-monitor`
- [ ] Saved PM2 config: `pm2 save`
- [ ] Tested small trade (if confident)

---

## 🚀 You're Live!

Your EZ Up Trading Bot is now running 24/7 on DigitalOcean with:
- ✅ Price-based event-driven execution every 3 minutes
- ✅ Real-time dashboard at port 3000
- ✅ Auto-restart on crashes
- ✅ Auto-startup on reboot
- ✅ Continuous trading based on bracket breaches

Monitor it anytime with:
```bash
pm2 status              # Quick status check
pm2 logs               # Live logs
pm2 monit              # Real-time monitoring
```

Or access the dashboard at: **http://YOUR_DROPLET_IP:3000**

---

## 📞 Support

For logs and debugging:
```bash
# Full logs for all services
pm2 logs --lines 200

# Error logs only
pm2 logs --err

# Specific service with timestamps
pm2 logs ez-price-monitor | head -50
```

Refer to `PM2_GUIDE.md` for detailed PM2 commands and configuration.
