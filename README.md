# EZ Up

An autonomous ZEN/USDC swing-trading experiment on Base, funded by a public Juicebox treasury and powered by the [EZ Path](https://ezpath.myezverse.xyz) swap router.

**This is a technology experiment. Not financial advice. Not an investment product.**

## Repository Layout

```
ez-up/
├── apps/
│   └── landing/              Vite + React landing page (deploys to Vercel)
└── services/
    └── zen-usdc-trader/      Bracket-based swing-trading bot
        └── state/history.json   Public daily TVL snapshot (consumed by landing)
```

## Architecture Boundary

EZ Up uses [EZ Path](https://github.com/infiniteezverse/ez-agentic-price-path) **only as an external utility** — via HTTP API calls. No EZ Path code is imported or vendored here. The two projects live in separate repositories and can be developed independently.

## Quick Start

**Landing page** ([apps/landing/](./apps/landing/README.md)):
```bash
cd apps/landing && npm install && npm run dev
```

**Trading bot** ([services/zen-usdc-trader/](./services/zen-usdc-trader/README.md)):
```bash
cd services/zen-usdc-trader && npm install && npm run tick
```

## Public Data Feed

The bot publishes a daily TVL/allocation snapshot to [`services/zen-usdc-trader/state/history.json`](./services/zen-usdc-trader/state/history.json). The landing page fetches this file from GitHub raw and renders the strategy tracker.

## Disclaimer

EZ Up is a private community experiment and a technology demonstration. It is not a registered investment product, security, fund, broker, exchange, or financial service. Nothing in this repository constitutes investment, legal, tax, or financial advice. Contributors may lose 100% of contributed funds.
