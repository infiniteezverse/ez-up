/**
 * EZ Up Trade Dashboard
 * Real-time public dashboard showing live trading activity
 * Reads from state files and displays trade history, P&L, market regime
 */

import express, { Request, Response } from 'express';
import { loadStateV2 } from './state';
import { getConfigForPair } from './config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

/**
 * API: Get current bot status and state
 */
app.get('/api/status', (req: Request, res: Response) => {
  try {
    const state = loadStateV2();
    const now = Date.now();

    const zenPair = state.pairs.ZEN_USDC;
    const ethPair = state.pairs.ETH_USDC;

    res.json({
      timestamp: now,
      global: state.global,
      pairs: {
        ZEN_USDC: {
          totalTrades: zenPair.totalTrades,
          tradesToday: zenPair.tradesToday,
          totalVolume: zenPair.totalVolumeUsd,
          entryPrice: zenPair.entryPrice,
          lastCycleHigh: zenPair.lastCycleHigh,
          lastTradeTimestamp: zenPair.lastTradeTimestamp,
          dayOpenedKey: zenPair.dayOpenedKey,
        },
        ETH_USDC: {
          totalTrades: ethPair.totalTrades,
          tradesToday: ethPair.tradesToday,
          totalVolume: ethPair.totalVolumeUsd,
          entryPrice: ethPair.entryPrice,
          lastCycleHigh: ethPair.lastCycleHigh,
          lastTradeTimestamp: ethPair.lastTradeTimestamp,
          dayOpenedKey: ethPair.dayOpenedKey,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status', details: String(err) });
  }
});

/**
 * API: Get formatted dashboard data for UI
 */
app.get('/api/dashboard', (req: Request, res: Response) => {
  try {
    const state = loadStateV2();
    const now = Date.now();

    const zenPair = state.pairs.ZEN_USDC;
    const ethPair = state.pairs.ETH_USDC;

    // Calculate time since last trade
    const timeSinceZenTrade = zenPair.lastTradeTimestamp
      ? ((now - zenPair.lastTradeTimestamp) / 1000 / 60).toFixed(1) // minutes
      : 'N/A';

    const timeSinceEthTrade = ethPair.lastTradeTimestamp
      ? ((now - ethPair.lastTradeTimestamp) / 1000 / 60).toFixed(1)
      : 'N/A';

    // Determine if trading today
    const today = new Date(now).toLocaleDateString();

    res.json({
      lastUpdate: new Date(now).toISOString(),
      tradingActive: true,
      global: {
        dailyDrawdown: (state.global.dailyDrawdownPercent * 100).toFixed(2) + '%',
        peakDailyValue: state.global.peakDailyValue.toFixed(2),
      },
      pairs: {
        ZEN_USDC: {
          name: 'ZEN/USDC',
          totalTrades: zenPair.totalTrades,
          tradesToday: zenPair.tradesToday,
          totalVolumeUsd: zenPair.totalVolumeUsd.toFixed(2),
          entryPrice: zenPair.entryPrice.toFixed(4),
          lastCycleHigh: zenPair.lastCycleHigh.toFixed(4),
          lastTradeMinutesAgo: timeSinceZenTrade,
          status: zenPair.tradesToday > 0 ? '🟢 Active' : '⚪ Waiting',
        },
        ETH_USDC: {
          name: 'ETH/USDC',
          totalTrades: ethPair.totalTrades,
          tradesToday: ethPair.tradesToday,
          totalVolumeUsd: ethPair.totalVolumeUsd.toFixed(2),
          entryPrice: ethPair.entryPrice.toFixed(4),
          lastCycleHigh: ethPair.lastCycleHigh.toFixed(4),
          lastTradeMinutesAgo: timeSinceEthTrade,
          status: ethPair.tradesToday > 0 ? '🟢 Active' : '⚪ Waiting',
        },
      },
      monitor: {
        checkInterval: '3 minutes',
        executionMode: 'Price-based (bracket breach detection)',
        autoRestart: 'Enabled via PM2',
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dashboard data', details: String(err) });
  }
});

/**
 * Serve static HTML dashboard
 */
app.get('/', (req: Request, res: Response) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EZ Up Trading Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #e2e8f0;
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        header {
            text-align: center;
            margin-bottom: 40px;
            padding: 20px 0;
            border-bottom: 2px solid #334155;
        }

        h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #60a5fa, #34d399);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .subtitle {
            color: #94a3b8;
            font-size: 1.1em;
        }

        .timestamp {
            color: #64748b;
            font-size: 0.9em;
            margin-top: 10px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: rgba(30, 41, 59, 0.8);
            border: 1px solid #334155;
            border-radius: 10px;
            padding: 20px;
            backdrop-filter: blur(10px);
            transition: all 0.3s ease;
        }

        .stat-card:hover {
            border-color: #60a5fa;
            box-shadow: 0 0 20px rgba(96, 165, 250, 0.1);
        }

        .stat-label {
            color: #94a3b8;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 8px;
        }

        .stat-value {
            font-size: 1.8em;
            font-weight: 600;
            color: #60a5fa;
        }

        .stat-subtext {
            color: #64748b;
            font-size: 0.85em;
            margin-top: 8px;
        }

        .pairs-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .pair-card {
            background: rgba(30, 41, 59, 0.8);
            border: 2px solid #334155;
            border-radius: 10px;
            padding: 25px;
            backdrop-filter: blur(10px);
        }

        .pair-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid #334155;
        }

        .pair-name {
            font-size: 1.5em;
            font-weight: 600;
            color: #e2e8f0;
        }

        .pair-status {
            font-size: 1.2em;
            font-weight: 600;
        }

        .pair-stat {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 12px 0;
            padding: 8px 0;
        }

        .pair-stat-label {
            color: #94a3b8;
            font-size: 0.9em;
        }

        .pair-stat-value {
            color: #60a5fa;
            font-weight: 600;
            font-size: 1.1em;
        }

        .info-section {
            background: rgba(30, 41, 59, 0.8);
            border: 1px solid #334155;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .info-title {
            font-size: 1.2em;
            color: #60a5fa;
            margin-bottom: 15px;
            font-weight: 600;
        }

        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }

        .info-item {
            border-left: 3px solid #60a5fa;
            padding-left: 15px;
        }

        .info-label {
            color: #94a3b8;
            font-size: 0.85em;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 5px;
        }

        .info-value {
            color: #e2e8f0;
            font-size: 1.1em;
            font-weight: 500;
        }

        .loading {
            text-align: center;
            color: #94a3b8;
            padding: 40px;
        }

        .error {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid #dc2626;
            color: #fca5a5;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
        }

        .refresh-info {
            text-align: center;
            color: #64748b;
            font-size: 0.9em;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #334155;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .live-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: #10b981;
            border-radius: 50%;
            animation: pulse 2s infinite;
            margin-right: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🚀 EZ Up Trading Dashboard</h1>
            <p class="subtitle"><span class="live-indicator"></span>Live Trading Monitor</p>
            <div class="timestamp" id="timestamp">Loading...</div>
        </header>

        <div id="error-container"></div>

        <div id="content" class="loading">
            Loading dashboard data...
        </div>
    </div>

    <script>
        const API_URL = '/api/dashboard';
        const REFRESH_INTERVAL = 30000; // 30 seconds

        async function loadDashboard() {
            try {
                const response = await fetch(API_URL);
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to fetch dashboard');
                }

                renderDashboard(data);
            } catch (err) {
                showError(String(err));
            }
        }

        function renderDashboard(data) {
            document.getElementById('error-container').innerHTML = '';
            document.getElementById('timestamp').textContent =
                \`Last updated: \${new Date(data.lastUpdate).toLocaleString()}\`;

            const zenData = data.pairs.ZEN_USDC;
            const ethData = data.pairs.ETH_USDC;

            const html = \`
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">Total Trades (All Time)</div>
                        <div class="stat-value">\${zenData.totalTrades + ethData.totalTrades}</div>
                        <div class="stat-subtext">ZEN: \${zenData.totalTrades} | ETH: \${ethData.totalTrades}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Trades Today</div>
                        <div class="stat-value">\${zenData.tradesToday + ethData.tradesToday}</div>
                        <div class="stat-subtext">ZEN: \${zenData.tradesToday} | ETH: \${ethData.tradesToday}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total Volume</div>
                        <div class="stat-value">\$\${(parseFloat(zenData.totalVolumeUsd) + parseFloat(ethData.totalVolumeUsd)).toFixed(2)}</div>
                        <div class="stat-subtext">ZEN: \$\${zenData.totalVolumeUsd} | ETH: \$\${ethData.totalVolumeUsd}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Daily Drawdown</div>
                        <div class="stat-value">\${data.global.dailyDrawdown}</div>
                        <div class="stat-subtext">Peak: \$\${data.global.peakDailyValue}</div>
                    </div>
                </div>

                <div class="pairs-grid">
                    <div class="pair-card">
                        <div class="pair-header">
                            <span class="pair-name">\${zenData.name}</span>
                            <span class="pair-status">\${zenData.status}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Total Trades</span>
                            <span class="pair-stat-value">\${zenData.totalTrades}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Today's Trades</span>
                            <span class="pair-stat-value">\${zenData.tradesToday}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Total Volume</span>
                            <span class="pair-stat-value">\$\${zenData.totalVolumeUsd}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Entry Price</span>
                            <span class="pair-stat-value">\$\${zenData.entryPrice}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Cycle High</span>
                            <span class="pair-stat-value">\$\${zenData.lastCycleHigh}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Last Trade</span>
                            <span class="pair-stat-value">\${zenData.lastTradeMinutesAgo === 'N/A' ? 'Never' : zenData.lastTradeMinutesAgo + ' min ago'}</span>
                        </div>
                    </div>

                    <div class="pair-card">
                        <div class="pair-header">
                            <span class="pair-name">\${ethData.name}</span>
                            <span class="pair-status">\${ethData.status}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Total Trades</span>
                            <span class="pair-stat-value">\${ethData.totalTrades}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Today's Trades</span>
                            <span class="pair-stat-value">\${ethData.tradesToday}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Total Volume</span>
                            <span class="pair-stat-value">\$\${ethData.totalVolumeUsd}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Entry Price</span>
                            <span class="pair-stat-value">\$\${ethData.entryPrice}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Cycle High</span>
                            <span class="pair-stat-value">\$\${ethData.lastCycleHigh}</span>
                        </div>
                        <div class="pair-stat">
                            <span class="pair-stat-label">Last Trade</span>
                            <span class="pair-stat-value">\${ethData.lastTradeMinutesAgo === 'N/A' ? 'Never' : ethData.lastTradeMinutesAgo + ' min ago'}</span>
                        </div>
                    </div>
                </div>

                <div class="info-section">
                    <div class="info-title">⚙️ Monitor Configuration</div>
                    <div class="info-grid">
                        <div class="info-item">
                            <div class="info-label">Check Interval</div>
                            <div class="info-value">\${data.monitor.checkInterval}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Execution Mode</div>
                            <div class="info-value">\${data.monitor.executionMode}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Auto-Restart</div>
                            <div class="info-value">\${data.monitor.autoRestart}</div>
                        </div>
                    </div>
                </div>

                <div class="refresh-info">
                    Dashboard auto-refreshes every 30 seconds
                </div>
            \`;

            document.getElementById('content').innerHTML = html;
        }

        function showError(message) {
            const errorHtml = \`
                <div class="error">
                    <strong>Error:</strong> \${message}
                </div>
            \`;
            document.getElementById('error-container').innerHTML = errorHtml;
        }

        // Load on page load
        loadDashboard();

        // Auto-refresh every 30 seconds
        setInterval(loadDashboard, REFRESH_INTERVAL);
    </script>
</body>
</html>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n[dashboard] 🚀 Trade Dashboard running at http://localhost:${PORT}`);
  console.log(`[dashboard] Open in browser to view live trading activity`);
  console.log(`[dashboard] Dashboard auto-refreshes every 30 seconds\n`);
});

export default app;
