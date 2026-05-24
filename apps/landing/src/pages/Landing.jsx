import StrategyTracker from '../components/StrategyTracker.jsx';
import { JUICEBOX_URL, LINKS } from '../config.js';

function Section({ id, title, kicker, children }) {
  return (
    <section id={id} className="mx-auto max-w-5xl px-6 py-16">
      {kicker && (
        <div className="mb-2 text-xs uppercase tracking-widest text-brand-cyan">
          {kicker}
        </div>
      )}
      <h2 className="mb-6 text-3xl font-bold sm:text-4xl">{title}</h2>
      <div className="text-slate-300">{children}</div>
    </section>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <h3 className="mb-3 text-lg font-semibold text-slate-100">{title}</h3>
      <div className="text-sm leading-relaxed text-slate-300">{children}</div>
    </div>
  );
}

function Faq({ q, children }) {
  return (
    <details className="group rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <summary className="cursor-pointer list-none font-medium text-slate-100 group-open:text-brand-cyan">
        {q}
      </summary>
      <div className="mt-3 text-sm text-slate-300">{children}</div>
    </details>
  );
}

export default function Landing() {
  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      {/* HERO */}
      <header className="border-b border-slate-900 bg-gradient-to-b from-slate-900 to-slate-950">
        <div className="mx-auto max-w-5xl px-6 py-20 text-center">
          <div className="mb-3 inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs uppercase tracking-widest text-amber-300">
            Technology Experiment — Not Financial Advice
          </div>
          <h1 className="mb-4 text-4xl font-extrabold sm:text-6xl">
            EZ <span className="text-brand-green">Up</span>
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-slate-300">
            An autonomous ZEN/USDC swing-trading experiment, funded by a
            community Juicebox treasury and powered by the EZ Path swap router.
            Built to test agentic frameworks in the open — not to generate
            profit, give financial advice, or be used as an investment vehicle.
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a
              href={JUICEBOX_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-xl bg-brand-green px-6 py-3 text-base font-semibold text-slate-950 transition hover:brightness-110"
            >
              Contribute via Juicebox →
            </a>
            <a
              href="#how"
              className="inline-flex items-center rounded-xl border border-slate-700 px-6 py-3 text-base font-semibold text-slate-200 hover:bg-slate-900"
            >
              How it works
            </a>
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-xs text-slate-500">
            Contributions flow into a transparent Juicebox smart-contract
            treasury. Contributors receive $EZUP governance tokens and can
            redeem their pro-rata share at any time by burning their tokens.
            Developers cannot withdraw funds.
          </p>
        </div>
      </header>

      {/* BRAIN + MUSCLE */}
      <Section id="how" kicker="How EZ Up Works" title="Brain &amp; Muscle">
        <div className="grid gap-6 sm:grid-cols-2">
          <Card title="🧠 The Brain — Swing Trader">
            A tick-based engine watches the ZEN/USDC price every 5 minutes.
            When the price moves ±4%, ±6%, ±8%, or ±12% from its baseline, it
            takes a convex slice (5% → 5% → 10% → 15%) of the relevant side of
            the portfolio. Baselines reset after every trade. Bigger moves
            trigger bigger slices.
          </Card>
          <Card title="💪 The Muscle — EZ Path">
            Every swap is routed through{' '}
            <a
              href={LINKS.ezPath}
              target="_blank"
              rel="noreferrer"
              className="text-brand-cyan hover:underline"
            >
              EZ Path
            </a>
            , a multi-venue DEX router that races 0x, ParaSwap, Aerodrome, and
            Uniswap V3 for the best fill — settled via x402 gasless payment for
            a flat $0.03 USDC per trade.
          </Card>
        </div>
      </Section>

      {/* SAFEGUARDS */}
      <Section kicker="Risk Controls" title="Built-in Safeguards">
        <div className="grid gap-6 sm:grid-cols-2">
          <Card title="✅ 30 / 70 Allocation Bands">
            Never sells if ZEN drops below 30% of the portfolio. Never buys if
            ZEN rises above 70%. The bot can never go fully one-sided.
          </Card>
          <Card title="✅ Two-Tick Confirmation">
            A bracket must trigger on two consecutive 5-minute ticks before
            executing. Filters out wicks, flash crashes, and single-print
            spikes.
          </Card>
          <Card title="✅ Trend Filter">
            If the 24-hour price move exceeds 15%, the smallest (4%) bracket is
            skipped — letting real trends run instead of churning noise trades.
          </Card>
          <Card title="✅ Daily P&amp;L Stop">
            If the portfolio is down more than 10% on the day, all buys halt to
            prevent averaging into a dump. Trade count is capped at 8/day.
          </Card>
        </div>
      </Section>

      {/* STRATEGY TRACKER */}
      <Section kicker="Live On-Chain" title="Strategy Performance">
        <StrategyTracker />
      </Section>

      {/* FAQ */}
      <Section kicker="Questions" title="FAQ">
        <div className="grid gap-3">
          <Faq q="Is this an investment?">
            No. EZ Up is a community-funded experiment to test agentic trading
            frameworks in public. It is not an investment vehicle, security,
            fund, or financial product. Nothing here is financial advice.
            Treat any contribution as money you are willing to lose entirely.
          </Faq>
          <Faq q="What does Juicebox do?">
            Juicebox is an open-source treasury protocol. Contributions go into
            a smart contract — not a developer wallet. You receive $EZUP
            governance tokens proportional to your contribution. You can burn
            those tokens at any time to redeem your pro-rata share of whatever
            is left in the treasury.
          </Faq>
          <Faq q="Can the developers take the funds?">
            No. The Juicebox project is configured with a 100% redemption rate
            and no owner withdrawal. Developers have no privileged access to
            the treasury beyond what every other token holder has.
          </Faq>
          <Faq q="What happens to the funds in the treasury?">
            A portion of the treasury is allocated to a trading wallet that the
            EZ Up bot operates on. The bot executes swaps on Base via EZ Path.
            All trade activity is visible on-chain at the wallet addresses
            listed in the leaderboard.
          </Faq>
          <Faq q="What are the risks?">
            Total loss is possible. Risks include: smart contract bugs (in
            Juicebox, EZ Path, or the bot itself), trading losses (the strategy
            can lose money in trending markets or extreme volatility), DEX
            routing failures, oracle issues, key compromise, regulatory
            changes, and any other risk inherent to experimental on-chain
            software. Do not contribute funds you cannot afford to lose.
          </Faq>
          <Faq q="Is this open source?">
            Yes. The bot, the router, and this landing page are all available
            on{' '}
            <a
              href={LINKS.github}
              target="_blank"
              rel="noreferrer"
              className="text-brand-cyan hover:underline"
            >
              GitHub
            </a>
            .
          </Faq>
        </div>
      </Section>

      {/* DISCLAIMER */}
      <Section kicker="Important" title="Full Disclaimer">
        <div className="space-y-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 text-sm text-amber-100/90">
          <p>
            EZ Up is a private community experiment and a technology
            demonstration. It is <strong>not</strong> a registered investment
            product, security, fund, broker, exchange, or financial service of
            any kind. Nothing on this page, in the source code, or in any
            related communication constitutes investment, legal, tax, or
            financial advice.
          </p>
          <p>
            All contributions are voluntary and made at the contributor’s sole
            risk. The bot, the treasury, the smart contracts, and the
            underlying infrastructure are experimental and may fail, lose
            funds, or behave in unexpected ways. You may lose 100% of any funds
            you contribute.
          </p>
          <p>
            By contributing, you acknowledge that you understand the
            experimental nature of this project, accept all associated risks,
            and are not relying on any representations or warranties from the
            developers or any other contributor.
          </p>
          <p className="text-xs text-amber-200/70">
            Not available to residents of jurisdictions where participation
            would be unlawful. If you are unsure whether participation is
            appropriate for you, do not participate.
          </p>
        </div>
      </Section>

      {/* FOOTER */}
      <footer className="border-t border-slate-900 bg-slate-950">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-slate-500 sm:flex-row">
          <div>
            EZ Up · A community experiment on Base · Built on{' '}
            <a
              href={LINKS.ezPath}
              target="_blank"
              rel="noreferrer"
              className="text-brand-cyan hover:underline"
            >
              EZ Path
            </a>
          </div>
          <div className="flex gap-4">
            <a
              href={LINKS.github}
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-300"
            >
              GitHub
            </a>
            <a
              href={JUICEBOX_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-300"
            >
              Juicebox
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
