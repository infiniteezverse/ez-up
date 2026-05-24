import { ZEN_ADDRESS } from '../config.js';

/**
 * Fetch the current USD price of ZEN from DexScreener (highest-volume pair).
 * Falls back to null on failure; caller should use a sensible fallback.
 */
export async function fetchZenPriceUsd() {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ZEN_ADDRESS}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.pairs || data.pairs.length === 0) return null;

    const valid = data.pairs.filter(
      (p) => p.priceUsd && parseFloat(p.priceUsd) > 0
    );
    if (valid.length === 0) return null;

    valid.sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0));
    return parseFloat(valid[0].priceUsd);
  } catch (err) {
    console.error('DexScreener fetch failed:', err);
    return null;
  }
}
