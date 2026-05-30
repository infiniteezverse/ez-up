import dotenv from 'dotenv';
import {
  loadStateV2,
  saveStateV2,
  hasAmnesia,
  resetPairAmnesia,
  isNewDay,
  resetDailyMetrics,
  resetDailyPnLMetrics,
  recordTrade,
  updateEntryAndHigh,
  updateGlobalState,
} from './state';
import { decideActionV3Enhanced, compareAlphaDepth } from './engine-v3-enhanced';
import { calculateVolatilityMetrics } from './volatility';
import { fetchMarketDataBatch } from './price';
import { executeBatchTrades, executeTradeViaEZPath } from './executor';
import { getConfigForPair, getAllConfigs } from './config';
import { TradeDecision, BotStateV2 } from './types';

// Load environment variables
dotenv.config({ path: '.env' });

const TRADER_PRIVATE_KEY = process.env.TRADER_PRIVATE_KEY;
const BOT_WALLET = process.env.BOT_WALLET || '0xDFF28E0BeB39B046A276C78D3eF42b24aaE7C6F6';

if (!TRADER_PRIVATE_KEY) {
  console.error('TRADER_PRIVATE_KEY not set in .env');
  process.exit(1);
}

// TypeScript type narrowing
const privateKey: string = TRADER_PRIVATE_KEY;

/**
 * Fetch balance data for both ZEN and ETH from Base RPC.
 * Uses direct eth_call with balanceOf selector (no API key required).
 * Source of truth: on-chain state from Base mainnet.
 */
async function fetchAllBalances(): Promise<{
  zenBalance: bigint;
  ethBalance: bigint;
  usdcBalance: bigint;
} | null> {
  try {
    const baseRpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const walletAddress = BOT_WALLET.toLowerCase();

    // Token addresses on Base mainnet
    const ZEN_ADDRESS = '0xf43eb8de897fbc7f2502483b2bef7bb9ea179229';
    const ETH_ADDRESS = '0x4200000000000000000000000000000000000006'; // WETH on Base
    const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

    // ERC-20 balanceOf selector
    const selector = '0x70a08231';
    const paddedAddress = walletAddress.slice(2).padStart(64, '0');
    const calldata = selector + paddedAddress;

    // Fetch all balances in parallel
    const [zenRes, ethRes, usdcRes] = await Promise.all([
      fetch(baseRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [
            {
              to: ZEN_ADDRESS,
              data: calldata,
            },
            'latest',
          ],
        }),
      }),
      fetch(baseRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_call',
          params: [
            {
              to: ETH_ADDRESS,
              data: calldata,
            },
            'latest',
          ],
        }),
      }),
      fetch(baseRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'eth_call',
          params: [
            {
              to: USDC_ADDRESS,
              data: calldata,
            },
            'latest',
          ],
        }),
      }),
    ]);

    const [zenData, ethData, usdcData] = await Promise.all([
      zenRes.json() as Promise<any>,
      ethRes.json() as Promise<any>,
      usdcRes.json() as Promise<any>,
    ]);

    // Parse hex responses to BigInt
    const parseBalance = (data: any): bigint => {
      if (data.error) {
        console.error('[index.ts] RPC error:', data.error);
        return BigInt(0);
      }
      try {
        return BigInt(data.result || '0x0');
      } catch {
        return BigInt(0);
      }
    };

    const zenBalance = parseBalance(zenData);
    const ethBalance = parseBalance(ethData);
    const usdcBalance = parseBalance(usdcData);

    console.log('[index.ts] ✓ Balances fetched from Base RPC:');
    console.log(`  ZEN:  ${(Number(zenBalance) / 1e18).toFixed(4)}`);
    console.log(`  ETH:  ${(Number(ethBalance) / 1e18).toFixed(4)}`);
    console.log(`  USDC: ${(Number(usdcBalance) / 1e6).toFixed(2)}`);

    return {
      zenBalance,
      ethBalance,
      usdcBalance,
    };
  } catch (err) {
    console.error('[index.ts] Balance fetch error:', err);
    return null;
  }
}

/**
 * Main bot tick: executes one complete trading cycle.
 * Flow:
 * 1. Load state (V2 format with per-pair isolation)
 * 2. Fetch prices and balances for both ZEN and ETH
 * 3. Check amnesia gates and daily resets per pair
 * 4. Evaluate decisions for each pair (independently)
 * 5. Sort by Alpha Depth (execute highest-confidence signals first)
 * 6. Execute trades via EZ Path
 * 7. Record results and update state
 * 8. Save state
 */
export async function runBotTick(): Promise<void> {
  const tickStartTime = Date.now();
  console.log(`\n[index.ts] ========== BOT TICK START (${new Date().toISOString()}) ==========`);

  try {
    // ============ STEP 1: LOAD STATE ============
    const state = loadStateV2();
    console.log(
      `[index.ts] State loaded: ZEN=${state.pairs.ZEN_USDC.totalTrades} trades, ETH=${state.pairs.ETH_USDC.totalTrades} trades`
    );

    // ============ STEP 2: FETCH MARKET DATA ============
    const balances = await fetchAllBalances();
    if (!balances) {
      console.error('[index.ts] Failed to fetch balances — aborting tick');
      return;
    }

    const marketData = await fetchMarketDataBatch(balances.zenBalance, balances.ethBalance, balances.usdcBalance);
    if (!marketData.zen || !marketData.eth) {
      console.error('[index.ts] Failed to fetch market data — aborting tick');
      return;
    }

    console.log(`[index.ts] Market snapshot:`);
    console.log(`  ZEN: $${marketData.zen.currentPrice.toFixed(2)}, vol=${(marketData.zen.dailyVolatility * 100).toFixed(1)}%, change=${(marketData.zen.priceChange24h * 100).toFixed(1)}%`);
    console.log(`  ETH: $${marketData.eth.currentPrice.toFixed(2)}, vol=${(marketData.eth.dailyVolatility * 100).toFixed(1)}%, change=${(marketData.eth.priceChange24h * 100).toFixed(1)}%`);

    // ============ STEP 3: AMNESIA CHECKS & DAILY RESETS ============
    const now = Date.now();
    const zenConfig = getConfigForPair('ZEN_USDC');
    const ethConfig = getConfigForPair('ETH_USDC');

    // ZEN pair: check amnesia
    if (hasAmnesia(state.pairs.ZEN_USDC, zenConfig.amnesiaDurationMs, now)) {
      console.log('[index.ts] ZEN: Amnesia reset triggered');
      state.pairs.ZEN_USDC = resetPairAmnesia(state.pairs.ZEN_USDC, now);
    }

    // ETH pair: check amnesia
    if (hasAmnesia(state.pairs.ETH_USDC, ethConfig.amnesiaDurationMs, now)) {
      console.log('[index.ts] ETH: Amnesia reset triggered');
      state.pairs.ETH_USDC = resetPairAmnesia(state.pairs.ETH_USDC, now);
    }

    // Check for new day (daily trade count reset)
    if (isNewDay(state.pairs.ZEN_USDC, now)) {
      console.log('[index.ts] ZEN: New UTC day, resetting daily metrics');
      state.pairs.ZEN_USDC = resetDailyMetrics(state.pairs.ZEN_USDC, Number(balances.zenBalance), Number(balances.usdcBalance), now);
    }

    if (isNewDay(state.pairs.ETH_USDC, now)) {
      console.log('[index.ts] ETH: New UTC day, resetting daily metrics');
      state.pairs.ETH_USDC = resetDailyMetrics(state.pairs.ETH_USDC, Number(balances.ethBalance), Number(balances.usdcBalance), now);
    }

    // Update global P&L tracking
    const portfolioValueUsd =
      (Number(balances.zenBalance) / 1e18) * marketData.zen.currentPrice +
      (Number(balances.ethBalance) / 1e18) * marketData.eth.currentPrice +
      (Number(balances.usdcBalance) / 1e6);

    state.global = updateGlobalState(state.global, portfolioValueUsd, now);

    // ============ STEP 4: EVALUATE DECISIONS ============
    const decisions: TradeDecision[] = [];

    // ZEN decision
    const zenVolMetrics = calculateVolatilityMetrics('ZEN_USDC', [], now);
    const zenDecision = await decideActionV3Enhanced({
      pairState: state.pairs.ZEN_USDC,
      globalState: state.global,
      marketData: marketData.zen,
      volatilityMetrics: zenVolMetrics,
      tradeHistory: [],
    });

    if (zenDecision && zenDecision.action !== 'HOLD') {
      decisions.push(zenDecision);
      console.log(`[index.ts] ZEN Decision: ${zenDecision.action} tier ${zenDecision.tier}`);
    } else {
      console.log(`[index.ts] ZEN Decision: HOLD (${zenDecision?.reason || 'no signal'})`);
    }

    // ETH decision
    const ethVolMetrics = calculateVolatilityMetrics('ETH_USDC', [], now);
    const ethDecision = await decideActionV3Enhanced({
      pairState: state.pairs.ETH_USDC,
      globalState: state.global,
      marketData: marketData.eth,
      volatilityMetrics: ethVolMetrics,
      tradeHistory: [],
    });

    if (ethDecision && ethDecision.action !== 'HOLD') {
      decisions.push(ethDecision);
      console.log(`[index.ts] ETH Decision: ${ethDecision.action} tier ${ethDecision.tier}`);
    } else {
      console.log(`[index.ts] ETH Decision: HOLD (${ethDecision?.reason || 'no signal'})`);
    }

    // ============ STEP 5: SORT BY ALPHA DEPTH ============
    decisions.sort(compareAlphaDepth);
    console.log(`[index.ts] Executable decisions: ${decisions.length}`);

    // ============ STEP 6: EXECUTE TRADES ============
    const results = await executeBatchTrades(decisions, BOT_WALLET, privateKey);

    for (const result of results) {
      console.log(`[index.ts] ${result.pair}: ${result.status}${result.txHash ? ` (${result.txHash.slice(0, 16)}...)` : ''}${result.error ? ` — ${result.error}` : ''}`);

      // ============ STEP 7: UPDATE STATE ============
      if (result.status === 'success') {
        const decision = decisions.find(d => d.pair === result.pair);
        if (decision) {
          const pairKey = decision.pair === 'ZEN_USDC' ? 'ZEN_USDC' : 'ETH_USDC';
          const pairState = state.pairs[pairKey];

          // Record trade
          state.pairs[pairKey] = recordTrade(pairState, decision.action as any, decision.notionalUsd || 0, decision.tier, now);

          // Update entry and high
          const currentPrice = decision.pair === 'ZEN_USDC' ? marketData.zen.currentPrice : marketData.eth.currentPrice;
          state.pairs[pairKey] = updateEntryAndHigh(state.pairs[pairKey], currentPrice);

          console.log(`[index.ts] ${decision.pair}: Trade recorded (${pairState.totalTrades + 1} total)`);
        }
      }
    }

    // ============ STEP 8: SAVE STATE ============
    saveStateV2(state);
    console.log('[index.ts] State saved');

    const tickDuration = Date.now() - tickStartTime;
    console.log(`[index.ts] ========== BOT TICK COMPLETE (${tickDuration}ms) ==========\n`);
  } catch (err) {
    console.error('[index.ts] Fatal error during tick:', err);
    process.exit(1);
  }
}

export default runBotTick;
