/**
 * Continuous Price Monitor
 * Watches price movements and triggers bot execution when brackets are breached
 * Runs indefinitely, checking every 3 minutes for price action
 */

import dotenv from 'dotenv';
import {
  loadStateV2,
  saveStateV2,
} from './state';
import { fetchMarketDataBatch } from './price';
import { getConfigForPair } from './config';
import { runBotTick } from './index';
import { BotStateV2 } from './types';

// Load environment variables
dotenv.config({ path: '.env' });

const TRADER_PRIVATE_KEY = process.env.TRADER_PRIVATE_KEY;
const BOT_WALLET = process.env.BOT_WALLET || '0xDFF28E0BeB39B046A276C78D3eF42b24aaE7C6F6';

if (!TRADER_PRIVATE_KEY) {
  console.error('TRADER_PRIVATE_KEY not set in .env');
  process.exit(1);
}

// Configuration
const POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if price has breached any brackets
 * Returns true if a bracket is breached and trade should execute
 */
function checkBracketBreach(
  pair: 'ZEN_USDC' | 'ETH_USDC',
  state: BotStateV2,
  currentPrice: number
): { breached: boolean; bracketInfo?: string } {
  const pairState = state.pairs[pair];
  const config = getConfigForPair(pair);

  const entryPrice = pairState.entryPrice || currentPrice;
  const cycleHigh = pairState.lastCycleHigh || currentPrice;

  const moveFromEntry = (currentPrice - entryPrice) / entryPrice;
  const moveFromHigh = (currentPrice - cycleHigh) / cycleHigh;

  // Check upside brackets (BUY signals)
  for (let i = 0; i < config.upsideBrackets.length; i++) {
    if (moveFromEntry >= config.upsideBrackets[i]) {
      return {
        breached: true,
        bracketInfo: `Upside Tier ${i} breached: ${(moveFromEntry * 100).toFixed(2)}% >= ${(config.upsideBrackets[i] * 100).toFixed(1)}%`,
      };
    }
  }

  // Check downside brackets (SELL signals)
  for (let i = 0; i < config.downsideBrackets.length; i++) {
    if (moveFromHigh <= config.downsideBrackets[i]) {
      return {
        breached: true,
        bracketInfo: `Downside Tier ${i} breached: ${(moveFromHigh * 100).toFixed(2)}% <= ${(config.downsideBrackets[i] * 100).toFixed(1)}%`,
      };
    }
  }

  return { breached: false };
}

/**
 * Main monitoring loop
 */
async function startPriceMonitor(): Promise<void> {
  console.log(`[price-monitor] Starting continuous price monitor (3-minute interval)`);
  console.log(`[price-monitor] Bot wallet: ${BOT_WALLET}`);
  console.log(`[price-monitor] Press Ctrl+C to stop\n`);

  let lastExecutionTime = Date.now();
  let consecutiveErrors = 0;

  while (true) {
    try {
      const now = Date.now();
      const timeSinceLastCheck = now - lastExecutionTime;

      console.log(`[price-monitor] ⏱️  Checking prices... (${new Date().toISOString()})`);

      // Load current state to get balance info
      const currentState = loadStateV2();

      // Fetch market data using zero balances (prices only, will fetch in runBotTick)
      const marketData = await fetchMarketDataBatch(
        BigInt(0),
        BigInt(0),
        BigInt(0)
      );

      if (!marketData.zen || !marketData.eth) {
        console.warn(`[price-monitor] ⚠️  Failed to fetch market data, retrying in 30s...`);
        await sleep(30000);
        continue;
      }

      // Load current state
      const state = loadStateV2();

      console.log(`[price-monitor] Market snapshot:`);
      console.log(`  ZEN: $${marketData.zen.currentPrice.toFixed(2)} (vol=${(marketData.zen.dailyVolatility * 100).toFixed(1)}%)`);
      console.log(`  ETH: $${marketData.eth.currentPrice.toFixed(2)} (vol=${(marketData.eth.dailyVolatility * 100).toFixed(1)}%)`);

      // Check ZEN brackets
      const zenBreach = checkBracketBreach('ZEN_USDC', state, marketData.zen.currentPrice);
      if (zenBreach.breached) {
        console.log(`[price-monitor] 🔴 ZEN BRACKET BREACH: ${zenBreach.bracketInfo}`);
        console.log(`[price-monitor] 🚀 Executing bot tick...`);
        try {
          await runBotTick();
          lastExecutionTime = Date.now();
          consecutiveErrors = 0;
        } catch (err) {
          console.error(`[price-monitor] ❌ Execution failed:`, err);
          consecutiveErrors++;
        }
      } else {
        console.log(`[price-monitor] ✓ ZEN: No bracket breach`);
      }

      // Check ETH brackets
      const ethBreach = checkBracketBreach('ETH_USDC', state, marketData.eth.currentPrice);
      if (ethBreach.breached) {
        console.log(`[price-monitor] 🔴 ETH BRACKET BREACH: ${ethBreach.bracketInfo}`);
        console.log(`[price-monitor] 🚀 Executing bot tick...`);
        try {
          await runBotTick();
          lastExecutionTime = Date.now();
          consecutiveErrors = 0;
        } catch (err) {
          console.error(`[price-monitor] ❌ Execution failed:`, err);
          consecutiveErrors++;
        }
      } else {
        console.log(`[price-monitor] ✓ ETH: No bracket breach`);
      }

      // Check if we should abort on too many errors
      if (consecutiveErrors >= MAX_RETRIES) {
        console.error(`[price-monitor] ❌ Too many consecutive errors (${consecutiveErrors}), stopping monitor`);
        process.exit(1);
      }

      // Sleep until next check
      console.log(`[price-monitor] 😴 Sleeping for 3 minutes...\n`);
      await sleep(POLL_INTERVAL_MS);
    } catch (err) {
      console.error(`[price-monitor] Fatal error:`, err);
      consecutiveErrors++;

      if (consecutiveErrors >= MAX_RETRIES) {
        console.error(`[price-monitor] ❌ Max retries exceeded, stopping`);
        process.exit(1);
      }

      console.log(`[price-monitor] Retrying in ${RETRY_DELAY_MS / 1000}s... (attempt ${consecutiveErrors}/${MAX_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[price-monitor] Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[price-monitor] Shutting down gracefully...');
  process.exit(0);
});

// Start the monitor
startPriceMonitor().catch(err => {
  console.error('[price-monitor] Fatal startup error:', err);
  process.exit(1);
});
