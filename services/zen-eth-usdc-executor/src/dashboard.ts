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
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #0a0e27 0%, #16213e 50%, #0f3460 100%);
            color: #e8eef5;
            min-height: 100vh;
            padding: 40px 20px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        header {
            text-align: center;
            margin-bottom: 60px;
            padding: 50px 30px 40px;
            border-bottom: 2px solid rgba(212, 175, 55, 0.3);
            position: relative;
            overflow: hidden;
        }

        header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, transparent, #d4af37, transparent);
        }

        h1 {
            font-size: 3.2em;
            margin-bottom: 15px;
            background: linear-gradient(135deg, #d4af37 0%, #e8c770 50%, #d4af37 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-weight: 700;
            letter-spacing: 0.5px;
        }

        .subtitle {
            color: #a8b5d1;
            font-size: 1.15em;
            font-weight: 300;
            letter-spacing: 0.3px;
        }

        .timestamp {
            color: #6b7a94;
            font-size: 0.95em;
            margin-top: 15px;
            font-weight: 300;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 25px;
            margin-bottom: 50px;
        }

        .stat-card {
            background: linear-gradient(135deg, rgba(26, 35, 62, 0.8) 0%, rgba(15, 52, 96, 0.6) 100%);
            border: 1px solid rgba(212, 175, 55, 0.2);
            border-radius: 12px;
            padding: 30px;
            backdrop-filter: blur(15px);
            transition: all 0.4s cubic-bezier(0.23, 1, 0.320, 1);
            position: relative;
            overflow: hidden;
        }

        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.4), transparent);
        }

        .stat-card:hover {
            border-color: rgba(212, 175, 55, 0.5);
            background: linear-gradient(135deg, rgba(26, 35, 62, 0.95) 0%, rgba(15, 52, 96, 0.75) 100%);
            box-shadow: 0 8px 32px rgba(212, 175, 55, 0.12);
            transform: translateY(-4px);
        }

        .stat-label {
            color: #7a8fa3;
            font-size: 0.85em;
            text-transform: uppercase;
            letter-spacing: 1.2px;
            margin-bottom: 12px;
            font-weight: 600;
        }

        .stat-value {
            font-size: 2.2em;
            font-weight: 700;
            color: #d4af37;
            margin-bottom: 8px;
        }

        .stat-subtext {
            color: #5a6b82;
            font-size: 0.9em;
            font-weight: 300;
        }

        .pairs-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
            gap: 30px;
            margin-bottom: 50px;
        }

        .pair-card {
            background: linear-gradient(135deg, rgba(26, 35, 62, 0.85) 0%, rgba(15, 52, 96, 0.65) 100%);
            border: 2px solid rgba(212, 175, 55, 0.25);
            border-radius: 14px;
            padding: 35px;
            backdrop-filter: blur(15px);
            transition: all 0.4s cubic-bezier(0.23, 1, 0.320, 1);
            position: relative;
            overflow: hidden;
        }

        .pair-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, transparent, #d4af37, transparent);
            opacity: 0;
            transition: opacity 0.4s ease;
        }

        .pair-card:hover {
            border-color: rgba(212, 175, 55, 0.5);
            background: linear-gradient(135deg, rgba(26, 35, 62, 0.95) 0%, rgba(15, 52, 96, 0.8) 100%);
            box-shadow: 0 12px 40px rgba(212, 175, 55, 0.15);
            transform: translateY(-6px);
        }

        .pair-card:hover::before {
            opacity: 1;
        }

        .pair-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 28px;
            padding-bottom: 18px;
            border-bottom: 1px solid rgba(212, 175, 55, 0.2);
        }

        .pair-name {
            font-size: 1.8em;
            font-weight: 700;
            color: #e8eef5;
            letter-spacing: 0.2px;
        }

        .pair-status {
            font-size: 1.1em;
            font-weight: 600;
            background: rgba(212, 175, 55, 0.1);
            padding: 6px 14px;
            border-radius: 20px;
            border: 1px solid rgba(212, 175, 55, 0.3);
        }

        .pair-stat {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 16px 0;
            padding: 10px 0;
            border-bottom: 1px solid rgba(212, 175, 55, 0.1);
        }

        .pair-stat:last-child {
            border-bottom: none;
            margin-bottom: 0;
        }

        .pair-stat-label {
            color: #7a8fa3;
            font-size: 0.95em;
            font-weight: 500;
        }

        .pair-stat-value {
            color: #d4af37;
            font-weight: 700;
            font-size: 1.15em;
            letter-spacing: 0.1px;
        }

        .info-section {
            background: linear-gradient(135deg, rgba(26, 35, 62, 0.8) 0%, rgba(15, 52, 96, 0.6) 100%);
            border: 1px solid rgba(212, 175, 55, 0.2);
            border-radius: 14px;
            padding: 35px;
            margin-bottom: 30px;
            position: relative;
            overflow: hidden;
        }

        .info-section::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.4), transparent);
        }

        .info-title {
            font-size: 1.35em;
            color: #d4af37;
            margin-bottom: 20px;
            font-weight: 700;
            letter-spacing: 0.3px;
        }

        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 20px;
        }

        .info-item {
            border-left: 3px solid #d4af37;
            padding-left: 18px;
            transition: all 0.3s ease;
        }

        .info-item:hover {
            padding-left: 22px;
            border-left-color: #e8c770;
        }

        .info-label {
            color: #7a8fa3;
            font-size: 0.85em;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin-bottom: 8px;
            font-weight: 600;
        }

        .info-value {
            color: #e8eef5;
            font-size: 1.15em;
            font-weight: 500;
            letter-spacing: 0.1px;
        }

        .loading {
            text-align: center;
            color: #7a8fa3;
            padding: 60px;
            font-size: 1.1em;
            font-weight: 300;
        }

        .error {
            background: linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(220, 38, 38, 0.08) 100%);
            border: 2px solid rgba(239, 68, 68, 0.4);
            color: #fecaca;
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 20px;
            font-weight: 500;
        }

        .refresh-info {
            text-align: center;
            color: #5a6b82;
            font-size: 0.95em;
            margin-top: 40px;
            padding-top: 25px;
            border-top: 1px solid rgba(212, 175, 55, 0.2);
            font-weight: 300;
            letter-spacing: 0.2px;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
            50% { opacity: 0.8; }
            100% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
        }

        .live-indicator {
            display: inline-block;
            width: 10px;
            height: 10px;
            background: #10b981;
            border-radius: 50%;
            animation: pulse 2s infinite;
            margin-right: 8px;
            border: 2px solid rgba(16, 185, 129, 0.5);
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
