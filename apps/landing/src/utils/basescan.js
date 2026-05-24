import { BASESCAN_API_KEY } from '../config.js';

const BASE_URL = 'https://api.basescan.org/api';

/**
 * Fetch a wallet's balance for an ERC-20 token on Base mainnet.
 * Returns the raw atomic balance as a number (caller divides by 10^decimals).
 */
export async function fetchTokenBalance(wallet, tokenAddress) {
  if (!BASESCAN_API_KEY) {
    console.warn('Missing VITE_BASESCAN_API_KEY; leaderboard balances will be 0.');
    return 0;
  }
  const url =
    `${BASE_URL}?module=account&action=tokenbalance` +
    `&contractaddress=${tokenAddress}` +
    `&address=${wallet}` +
    `&tag=latest&apikey=${BASESCAN_API_KEY}`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.status === '1' && json.result) return Number(json.result);
    return 0;
  } catch (err) {
    console.error('Basescan fetch failed:', err);
    return 0;
  }
}
