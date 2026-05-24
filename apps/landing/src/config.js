// EZ Up Landing — Configuration
// Replace placeholders, or set as VITE_* env vars in .env / Vercel dashboard.

export const JUICEBOX_URL =
  import.meta.env.VITE_JUICEBOX_URL ||
  'https://juicebox.money/v2/p/YOUR_PROJECT_ID';

// Kept for backward compat; no longer used (balances now read direct from Base RPC)
export const BASESCAN_API_KEY =
  import.meta.env.VITE_BASESCAN_API_KEY || '';

// Public Base RPC. Override in .env if you want a dedicated RPC (Alchemy, Infura)
export const BASE_RPC_URL =
  import.meta.env.VITE_BASE_RPC_URL || 'https://mainnet.base.org';

// Base mainnet token addresses
export const ZEN_ADDRESS = '0xf43eb8de897fbc7f2502483b2bef7bb9ea179229';
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Decimals
export const ZEN_DECIMALS = 18;
export const USDC_DECIMALS = 6;

// Fallback ZEN price if DexScreener API fails
export const ZEN_PRICE_USD = 6.02;
export const USDC_PRICE_USD = 1.0;

// The bot's trading wallet — the single source of truth for TVL & performance
export const BOT_WALLET = '0xDFF28E0BeB39B046A276C78D3eF42b24aaE7C6F6';

// URL of the bot's published history.json (daily snapshots).
// Lives in this repo at services/zen-usdc-trader/state/history.json.
export const HISTORY_URL =
  import.meta.env.VITE_HISTORY_URL ||
  'https://raw.githubusercontent.com/infiniteezverse/ez-up/main/services/zen-usdc-trader/state/history.json';

// Refresh intervals
export const STATS_REFRESH_MS = 60_000;

// External links
export const LINKS = {
  ezPath: 'https://ezpath.myezverse.xyz',
  ezPathRepo: 'https://github.com/infiniteezverse/ez-agentic-price-path',
  github: 'https://github.com/infiniteezverse/ez-up',
  basescan: 'https://basescan.org',
  botWallet: `https://basescan.org/address/0xDFF28E0BeB39B046A276C78D3eF42b24aaE7C6F6`,
};
