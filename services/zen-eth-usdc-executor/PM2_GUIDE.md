# PM2 Process Management Guide

This guide covers using PM2 to manage the price monitor and dashboard locally and on DigitalOcean.

## What is PM2?

PM2 is a production process manager for Node.js that provides:
- **Auto-restart** on crashes
- **Log rotation** and aggregation
- **Auto-startup** on server reboot
- **Monitoring** and dashboards
- **Graceful shutdown** handling

## Local Development Setup

### Install PM2 Globally

```bash
npm install -g pm2
pm2 install pm2-logrotate  # Auto-rotate logs
```

### Start Both Services Locally

```bash
cd /Users/tylermiller/dev/ez-up/services/zen-eth-usdc-executor

# Build TypeScript first
npm run build

# Start both price monitor and dashboard
pm2 start ecosystem.config.js

# Check status
pm2 status
```

Expected output:
```
┌─────────────────────┬──────┬──────┬───────┬────────┬──────────┐
│ App name            │ id   │ mode │ pid   │ status │ memory   │
├─────────────────────┼──────┼──────┼───────┼────────┼──────────┤
│ ez-price-monitor    │ 0    │ fork │ 12345 │ online │ 45.2 MB  │
│ ez-dashboard        │ 1    │ fork │ 12346 │ online │ 32.1 MB  │
└─────────────────────┴──────┴──────┴───────┴────────┴──────────┘
```

### View Logs

```bash
# View all logs (live stream, Ctrl+C to exit)
pm2 logs

# View specific service logs
pm2 logs ez-price-monitor
pm2 logs ez-dashboard

# View logs with line numbers
pm2 logs --lines 100
```

### Monitor in Real-Time

```bash
# Interactive monitoring dashboard
pm2 monit
```

### Stop/Restart Services

```bash
# Stop all
pm2 stop ecosystem.config.js

# Restart all
pm2 restart ecosystem.config.js

# Stop specific service
pm2 stop ez-price-monitor

# Restart specific service
pm2 restart ez-dashboard
```

### Delete from PM2

```bash
pm2 delete ecosystem.config.js
```

---

## DigitalOcean Droplet Setup

### 1. Create Droplet

- **Image:** Ubuntu 24.04 LTS
- **Size:** Minimum $6/month (2GB RAM, 1 CPU)
- **Region:** Any (closest to you preferred)
- **User Data Script:** Use `digitalocean-startup-v2.sh`

### 2. After Droplet Creation (Wait 2-3 minutes for startup script)

```bash
# SSH into droplet
ssh root@YOUR_DROPLET_IP

# Verify setup completed
ls -la /root/ez-monitor/services/zen-eth-usdc-executor/

# Check if .env file exists
cat /root/ez-monitor/services/zen-eth-usdc-executor/.env
```

### 3. Configure Credentials

```bash
# Edit .env with your credentials
nano /root/ez-monitor/services/zen-eth-usdc-executor/.env
```

Add your credentials:
```
TRADER_PRIVATE_KEY=your_private_key_here
BOT_WALLET=your_wallet_address_here
```

Save and exit (Ctrl+X, Y, Enter)

### 4. Start Services with PM2

```bash
cd /root/ez-monitor/services/zen-eth-usdc-executor

# Start both services
pm2 start ecosystem.config.js

# Verify they're running
pm2 status

# Save to auto-startup on reboot
pm2 save
```

### 5. View Dashboard

Open in browser:
```
http://YOUR_DROPLET_IP:3000
```

### 6. Monitor Services

```bash
# Check status
pm2 status

# View real-time logs
pm2 logs

# Monitor CPU/Memory
pm2 monit
```

---

## Log Locations

### Local Machine
```
./logs/price-monitor-out.log      # Standard output
./logs/price-monitor-error.log    # Error output
./logs/dashboard-out.log          # Standard output
./logs/dashboard-error.log        # Error output
```

### DigitalOcean Droplet
```
/root/.pm2/logs/ez-price-monitor-out.log
/root/.pm2/logs/ez-price-monitor-error.log
/root/.pm2/logs/ez-dashboard-out.log
/root/.pm2/logs/ez-dashboard-error.log
```

---

## Troubleshooting

### Services Won't Start

```bash
# Check if ecosystem.config.js exists
cat ecosystem.config.js

# Check for TypeScript compilation errors
npm run build

# Try starting with more verbose output
pm2 start ecosystem.config.js --no-daemon
```

### High Memory Usage

```bash
# Check memory per process
pm2 monit

# Restart if exceeding limits (500MB price monitor, 300MB dashboard)
pm2 restart ecosystem.config.js
```

### Dashboard Not Accessible

```bash
# Check if dashboard is running
pm2 status | grep ez-dashboard

# Check dashboard logs
pm2 logs ez-dashboard

# Verify port 3000 is open (on droplet)
netstat -tlnp | grep 3000

# Or curl the API
curl http://localhost:3000/api/dashboard
```

### Price Monitor Not Detecting Brackets

```bash
# Check price monitor logs
pm2 logs ez-price-monitor

# Look for:
# - Market snapshot (price updates)
# - Bracket breach messages
# - Execution logs
```

### Auto-Startup Not Working After Reboot

```bash
# Save PM2 state again
pm2 save

# Generate startup script
pm2 startup systemd -u root --hp /root
```

---

## Common Commands Reference

| Command | Purpose |
|---------|---------|
| `pm2 start ecosystem.config.js` | Start both services |
| `pm2 stop ecosystem.config.js` | Stop both services |
| `pm2 restart ecosystem.config.js` | Restart both services |
| `pm2 delete ecosystem.config.js` | Remove from PM2 |
| `pm2 status` | Show service status |
| `pm2 logs` | View all logs (real-time) |
| `pm2 logs ez-price-monitor` | View price monitor logs |
| `pm2 logs ez-dashboard` | View dashboard logs |
| `pm2 monit` | Real-time monitoring |
| `pm2 save` | Persist auto-startup on reboot |
| `pm2 kill` | Stop all PM2 processes |

---

## Performance Notes

- **Price Monitor:** Uses ~45-50 MB RAM, CPU spikes during bracket checks and trade execution
- **Dashboard:** Uses ~30-35 MB RAM, minimal CPU, serves UI and API requests
- **Combined:** ~80 MB RAM, well within typical 2GB droplet limits

---

## Next Steps

1. ✅ Created `ecosystem.config.js` for local and production use
2. ✅ Created `digitalocean-startup-v2.sh` for automated droplet setup
3. Ready to deploy to DigitalOcean using the startup script
4. Once on droplet: Configure .env → `pm2 start ecosystem.config.js` → Access dashboard at port 3000

For deployment, see `LIVE_DEPLOYMENT_GUIDE.md` in the root directory.
