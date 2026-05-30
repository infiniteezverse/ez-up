/**
 * PM2 Ecosystem Configuration
 * Manages both price monitor and dashboard processes
 *
 * Usage:
 *   pm2 start ecosystem.config.js      # Start all apps
 *   pm2 stop ecosystem.config.js       # Stop all apps
 *   pm2 restart ecosystem.config.js    # Restart all apps
 *   pm2 delete ecosystem.config.js     # Stop and remove from PM2
 *   pm2 save                            # Persist to auto-startup on reboot
 *   pm2 logs                            # View all logs
 *   pm2 monit                           # Monitor in real-time
 */

module.exports = {
  apps: [
    /**
     * Price Monitor: Continuous price checking with event-driven execution
     * - Checks prices every 3 minutes
     * - Executes trades when brackets are breached
     * - Auto-restarts on crash
     */
    {
      name: 'ez-price-monitor',
      script: 'dist/price-monitor.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',

      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',

      // Memory limit to prevent runaway
      max_memory_restart: '500M',

      // Logging
      error_file: './logs/price-monitor-error.log',
      out_file: './logs/price-monitor-out.log',
      log_file: './logs/price-monitor-combined.log',
      time: true,

      // Environment
      env: {
        NODE_ENV: 'production'
      },

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      shutdown_with_message: true
    },

    /**
     * Dashboard: Real-time web interface for monitoring
     * - Serves HTML dashboard on port 3000
     * - Auto-refreshes every 30 seconds
     * - Reads from state files in real-time
     */
    {
      name: 'ez-dashboard',
      script: 'dist/dashboard.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',

      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',

      // Memory limit to prevent runaway
      max_memory_restart: '300M',

      // Logging
      error_file: './logs/dashboard-error.log',
      out_file: './logs/dashboard-out.log',
      log_file: './logs/dashboard-combined.log',
      time: true,

      // Environment
      env: {
        NODE_ENV: 'production',
        DASHBOARD_PORT: 3000
      },

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      shutdown_with_message: true
    }
  ],

  /**
   * Deploy configuration (for production DigitalOcean droplet)
   *
   * Usage:
   *   pm2 deploy ecosystem.config.js production setup
   *   pm2 deploy ecosystem.config.js production
   */
  deploy: {
    production: {
      user: 'root',
      host: 'YOUR_DROPLET_IP',
      ref: 'origin/main',
      repo: 'https://github.com/infiniteezverse/ez-up.git',
      path: '/root/ez-monitor',
      'post-deploy': 'cd services/zen-eth-usdc-executor && npm install --production && npm run build && pm2 startOrRestart ecosystem.config.js --env production && pm2 save'
    }
  }
};
