# EZ Up — Landing Page

Standalone Vite + React + Tailwind landing page for the EZ Up swing-trading experiment. Deploys independently to Vercel; does not depend on or expose any other code in this monorepo.

## Quick start

```bash
cd apps/ez-up-landing
npm install
cp .env.example .env   # fill in keys (see below)
npm run dev            # http://localhost:5174
```

## Required env vars

| Variable | What it is | How to get it |
|---|---|---|
| `VITE_BASESCAN_API_KEY` | Free Basescan API key used by the live leaderboard to read on-chain ERC-20 balances. | 1. Go to https://basescan.org/apis<br>2. Sign up (free) and verify email<br>3. Click **Add** → name it `ez-up-landing` → copy the key |
| `VITE_JUICEBOX_URL` | Public URL of your Juicebox project — the destination of the "Contribute" CTA. | After creating your Juicebox v2 project, copy its URL (e.g. `https://juicebox.money/v2/p/123`) |

If `VITE_BASESCAN_API_KEY` is missing, the leaderboard renders but shows zero balances and logs a warning.

## Configuration

`src/config.js` controls everything else:

- `TRACKED_WALLETS` — the wallets displayed on the leaderboard
- `ZEN_PRICE_USD` / `USDC_PRICE_USD` — approximate prices for USD totals (replace with a live price feed later)
- `LINKS` — external links (EZ Path, GitHub, Basescan)

## Deploy to Vercel

1. Push the repo to GitHub
2. In Vercel: **Add New Project** → import the repo
3. **Root Directory**: `apps/ez-up-landing`
4. Framework preset: **Vite** (auto-detected)
5. Add env vars under **Settings → Environment Variables**:
   - `VITE_BASESCAN_API_KEY`
   - `VITE_JUICEBOX_URL`
6. Deploy. Subsequent pushes to `main` auto-deploy.

Only this directory is built and served. The rest of the monorepo is invisible to the public.

## What's on the page

- Hero with disclaimer banner + Juicebox CTA
- Brain (swing-trader engine) + Muscle (EZ Path router) explainer
- Four safeguard cards (allocation bands, two-tick confirmation, trend filter, daily P&L stop)
- Live leaderboard pulling ZEN + USDC balances from Basescan, refreshed every 60s
- FAQ with full disclaimers
- Footer with GitHub + Juicebox links

## Disclaimer

EZ Up is a technology experiment and community project. It is not financial advice, not an investment product, and not a regulated financial service. Contributors may lose 100% of contributed funds. See the on-page disclaimer for full terms.
