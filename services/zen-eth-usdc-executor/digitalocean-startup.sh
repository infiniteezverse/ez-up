#!/bin/bash
# EZ Up Price Monitor - DigitalOcean Startup Script
# Automatically sets up Node.js, clones repo, and starts the price monitor
# SSH in after to add credentials and start trading

set -e  # Exit on error

echo "=========================================="
echo "🚀 EZ Up Price Monitor - DigitalOcean Setup"
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
# EZ Up Price Monitor Configuration
# Add your credentials below

# Your wallet private key (REQUIRED)
TRADER_PRIVATE_KEY=your_private_key_here

# Bot execution wallet address (REQUIRED)
BOT_WALLET=your_wallet_address_here

# Base RPC URL (optional, defaults to https://mainnet.base.org)
BASE_RPC_URL=https://mainnet.base.org
EOF
    chmod 600 .env
    echo "✅ .env template created"
fi

# Initialize PM2 for auto-start on reboot
echo "⚙️  Configuring PM2 for auto-start..."
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
echo "3. Start the price monitor:"
echo "   cd /root/ez-monitor/services/zen-eth-usdc-executor"
echo "   pm2 start npm --name 'ez-monitor' -- run monitor"
echo "   pm2 save"
echo ""
echo "4. View logs:"
echo "   pm2 logs ez-monitor"
echo ""
echo "5. Monitor status:"
echo "   pm2 status"
echo ""
echo "The bot will auto-restart on crashes or reboot!"
echo ""
echo "=========================================="
