#!/bin/bash
# EZ Up Trading Bot - DigitalOcean Startup Script (v2)
# Sets up Node.js, clones repo, and starts BOTH price monitor and dashboard
# Price Monitor: Continuous price checking (3-min interval) → Event-driven trades
# Dashboard: Real-time web interface on port 3000

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

# Verify Node.js installation
NODE_VERSION=$(node --version)
echo "✅ Node.js installed: $NODE_VERSION"

# Install PM2 globally for process management
echo "📦 Installing PM2 (process manager)..."
npm install -g pm2 > /dev/null 2>&1
pm2 install pm2-logrotate > /dev/null 2>&1

# Create app directory
APP_DIR="/root/ez-monitor"
echo "📁 Creating app directory: $APP_DIR"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Clone the repository
echo "📥 Cloning ez-up repository..."
git clone https://github.com/infiniteezverse/ez-up.git . > /dev/null 2>&1

# Navigate to executor service
cd services/zen-eth-usdc-executor

# Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install --production > /dev/null 2>&1

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build > /dev/null 2>&1

# Create .env file template if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env template..."
    cat > .env << 'EOF'
# EZ Up Trading Bot Configuration
# Add your credentials below to enable trading

# Your wallet private key (REQUIRED for trading)
TRADER_PRIVATE_KEY=your_private_key_here

# Bot execution wallet address (REQUIRED for trading)
BOT_WALLET=your_wallet_address_here

# Base RPC URL (optional, defaults to https://mainnet.base.org)
BASE_RPC_URL=https://mainnet.base.org

# Dashboard port (optional, defaults to 3000)
DASHBOARD_PORT=3000
EOF
    chmod 600 .env
    echo "✅ .env template created (MUST be configured before trading)"
fi

# Create PM2 ecosystem configuration
echo "⚙️  Creating PM2 ecosystem configuration..."
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'ez-price-monitor',
      script: 'dist/price-monitor.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M',
      error_file: '/root/.pm2/logs/ez-price-monitor-error.log',
      out_file: '/root/.pm2/logs/ez-price-monitor-out.log',
      log_file: '/root/.pm2/logs/ez-price-monitor-combined.log',
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'ez-dashboard',
      script: 'dist/dashboard.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      error_file: '/root/.pm2/logs/ez-dashboard-error.log',
      out_file: '/root/.pm2/logs/ez-dashboard-out.log',
      log_file: '/root/.pm2/logs/ez-dashboard-combined.log',
      time: true,
      env: {
        NODE_ENV: 'production',
        DASHBOARD_PORT: 3000
      }
    }
  ]
};
EOF

echo "✅ PM2 ecosystem configuration created"

# Initialize PM2 for auto-start on reboot
echo "⚙️  Configuring PM2 for auto-start on reboot..."
pm2 startup systemd -u root --hp /root > /dev/null 2>&1

echo ""
echo "=========================================="
echo "✅ SETUP COMPLETE!"
echo "=========================================="
echo ""
echo "📋 NEXT STEPS:"
echo ""
echo "1. SSH into your droplet:"
echo "   ssh root@YOUR_DROPLET_IP"
echo ""
echo "2. Edit the .env file with your credentials:"
echo "   nano /root/ez-monitor/services/zen-eth-usdc-executor/.env"
echo ""
echo "   Add:"
echo "   - TRADER_PRIVATE_KEY=your_private_key"
echo "   - BOT_WALLET=your_wallet_address"
echo ""
echo "3. Start both services:"
echo "   cd /root/ez-monitor/services/zen-eth-usdc-executor"
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save"
echo ""
echo "4. View dashboard:"
echo "   http://YOUR_DROPLET_IP:3000"
echo ""
echo "5. Monitor processes:"
echo "   pm2 status              # View process status"
echo "   pm2 logs ez-price-monitor  # Price monitor logs"
echo "   pm2 logs ez-dashboard      # Dashboard logs"
echo "   pm2 logs               # All logs (Ctrl+C to exit)"
echo ""
echo "6. Stop services:"
echo "   pm2 stop ecosystem.config.js"
echo ""
echo "=========================================="
echo ""
echo "🔴 IMPORTANT: Services will NOT trade until .env is configured!"
echo ""
echo "=========================================="
