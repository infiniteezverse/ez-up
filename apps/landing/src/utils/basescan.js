// Reads ERC-20 balances directly from a Base RPC endpoint via eth_call.
// No API key required. Free, public, no third-party indexer.
//
// Override with VITE_BASE_RPC_URL if you prefer a private RPC (Alchemy, Infura).

const DEFAULT_RPC = 'https://mainnet.base.org';

const BASE_RPC =
  import.meta.env.VITE_BASE_RPC_URL || DEFAULT_RPC;

// balanceOf(address) selector
const BALANCE_OF_SELECTOR = '0x70a08231';

function padAddress(addr) {
  return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

/**
 * Fetch an address's balance of an ERC-20 token on Base.
 * Returns the raw atomic balance as a number (caller divides by 10^decimals).
 */
export async function fetchTokenBalance(wallet, tokenAddress) {
  const data = BALANCE_OF_SELECTOR + padAddress(wallet);

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: tokenAddress, data }, 'latest'],
  };

  try {
    const res = await fetch(BASE_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.error) {
      console.warn('Base RPC error:', json.error);
      return 0;
    }
    if (!json.result) return 0;
    // result is a hex-encoded uint256 — parse as BigInt then to Number.
    // JS Number can lose precision past 2^53, but for ZEN/USDC balances
    // shown in a UI this is acceptable. Use BigInt downstream if needed.
    return Number(BigInt(json.result));
  } catch (err) {
    console.error('Base RPC fetch failed:', err);
    return 0;
  }
}
