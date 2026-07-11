// ============================================================
// DEMO holdings for the Permanent Portfolio dashboard.
// This is the public demo book: ¥10,000 split equally across the four legs
// on 2026-06-01 at that day's real closing prices. Prices, FX and gold still
// re-price LIVE from Yahoo via the /api functions — only the positions are
// dummy. Each holding is one account/position, tagged to one of the four legs.
// ============================================================

export type AssetKey = 'stocks' | 'bonds' | 'gold' | 'cash';

export type Currency = 'CNY' | 'USD' | 'GBP' | 'EUR';

// Units of CNY per 1 unit of the currency. Live FX overrides these at runtime;
// these are the offline fallback (mock spot, Jul 2026).
export const fxToCNY: Record<Currency, number> = {
  CNY: 1,
  USD: 6.77,
  GBP: 9.06,
  EUR: 7.71,
};

export const baseCurrencies: Currency[] = ['CNY', 'USD', 'GBP', 'EUR'];

// FX pairs pulled live (Yahoo format) → mapped back onto currency codes.
export const fxSymbols: { pair: string; from: Currency }[] = [
  { pair: 'USDCNY=X', from: 'USD' },
  { pair: 'GBPCNY=X', from: 'GBP' },
  { pair: 'EURCNY=X', from: 'EUR' },
];

export type Holding = {
  leg: AssetKey;
  name: string; // position / product name
  account: string; // where it's custodied
  currency: Currency; // native currency of the figures below
  value: number; // current market value, native currency
  cost: number; // total cost / book value, native (= value for cash)
  note?: string; // small caption (grams, rate, caveat)
  excluded?: boolean; // kept off the portfolio (e.g. emergency fund), shown apart
  grams?: number; // if set, value is re-priced live from the spot gold price
  yahooSymbol?: string; // if set with `shares`, value re-prices live
  shares?: number; // units held (back-calculated from value ÷ price at entry)
  since?: string; // YYYY-MM-DD position entered at ~current size. Period wealth
  // change measures from cost when the period starts before this date, so a
  // position bought in March never shows a fictional "since January" move.
  rate?: number; // annual interest rate as a decimal (0.0451 = 4.51%); the
  // value accrues daily from `valueAsOf` so cash actually earns its coupon.
  valueAsOf?: string; // YYYY-MM-DD the `value` figure was marked; accrual
  // compounds from here. In-app ledger edits reset it to the edit date.
};

// Daily-compounded accrual for manual interest-bearing holdings. Holdings
// without a rate (or re-priced live from shares/grams) pass through untouched.
export function accruedValue(h: Holding, at: Date = new Date()): number {
  if (!h.rate || !h.valueAsOf) return h.value;
  const days = (at.getTime() - Date.parse(`${h.valueAsOf}T00:00:00Z`)) / 864e5;
  if (days <= 0) return h.value;
  return h.value * Math.pow(1 + h.rate, days / 365);
}

// Live gold: Yahoo COMEX gold future, USD per troy ounce. 1 oz = 31.1035 g.
export const GOLD_SYMBOL = 'GC=F';
export const GRAMS_PER_OZ = 31.1035;

// Demo book: ¥10,000 seeded 2026-06-01, 25% per leg (¥2,500 each) at the real
// closes that day — QQQ $742.74, TLT $85.47, gold $4,475.20/oz, USD/CNY 6.765.
// Shares/grams are fixed from those entry prices; values re-price live.
// `value` figures are the offline fallback only (marked Jul 2026).
export const holdings: Holding[] = [
  // ---- EQUITIES ----
  { leg: 'stocks', name: 'Nasdaq-100 ETF (QQQ)', account: 'Demo Brokerage', currency: 'USD', yahooSymbol: 'QQQ', shares: 0.4976, value: 361.01, cost: 369.55, since: '2026-06-01' },

  // ---- LONG BONDS ----
  { leg: 'bonds', name: '20y+ Treasury ETF (TLT)', account: 'Demo Brokerage', currency: 'USD', yahooSymbol: 'TLT', shares: 4.3237, value: 365.22, cost: 369.55, since: '2026-06-01' },

  // ---- GOLD ----
  { leg: 'gold', name: 'Gold account', account: 'Demo Bank', currency: 'CNY', value: 2298.6, cost: 2500.0, grams: 2.5684, note: '2.57 g · live spot', since: '2026-06-01' },

  // ---- CASH & EQUIVALENTS ----
  { leg: 'cash', name: 'Money-market fund', account: 'Demo Bank', currency: 'CNY', value: 2500.0, cost: 2500.0, note: '1.50% p.a.', since: '2026-06-01', rate: 0.015, valueAsOf: '2026-06-01' },
];

export const TOTAL_TARGET = 0.25;
export const REBALANCE_LOW = 0.15;
export const REBALANCE_HIGH = 0.35;

export const assetMeta: Record<
  AssetKey,
  { label: string; favored: string; color: string; symbol: string }
> = {
  stocks: { label: 'Equities', favored: 'Prosperity', color: 'var(--c-stocks)', symbol: '◆' },
  bonds: { label: 'Long Bonds', favored: 'Deflation', color: 'var(--c-bonds)', symbol: '▲' },
  gold: { label: 'Gold', favored: 'Inflation', color: 'var(--c-gold)', symbol: '●' },
  cash: { label: 'Cash & Equiv.', favored: 'Tight Money', color: 'var(--c-cash)', symbol: '■' },
};

// Four Browne regimes. Probabilities are an illustrative read of the signals.
export type RegimeKey = 'prosperity' | 'inflation' | 'deflation' | 'tight';

export const regimes: {
  key: RegimeKey;
  name: string;
  favors: AssetKey;
  description: string;
  probability: number;
  playbook: string[]; // concrete actions for THIS book if the regime confirms
}[] = [
  {
    key: 'prosperity',
    name: 'Prosperity',
    favors: 'stocks',
    description: 'Real growth positive, real rates moderate, broad risk appetite.',
    probability: 0.18,
    playbook: [
      'Let the equity leg run toward the top of the 35% band — do not trim early; capturing the run is the point of the leg.',
      'Direct new savings into the lagging legs (long bonds, gold) instead of buying more equities at highs.',
      'Keep the exposure broad and boring — an index tracker like QQQ or an all-world fund, not single names.',
      'Pre-commit the exit: the day the equity leg touches 35%, rebalance back to 25% without debate.',
    ],
  },
  {
    key: 'inflation',
    name: 'Inflation',
    favors: 'gold',
    description: 'CPI persistently above target, real rates compressed, commodities bid.',
    probability: 0.54,
    playbook: [
      'Check the gold leg first — it should be pulling toward 25%. If under, add grams to the gold account rather than chasing miners or commodity funds.',
      'Keep cash in rate-tracking products (money-market funds, high-yield savings) — idle deposits lose real value fastest in this regime.',
      'Do not over-size gold past the 35% ceiling even while it runs; the band is the discipline.',
      'Long bonds suffer here — expect the TLT leg to lag and let the bands handle it, not your nerves.',
    ],
  },
  {
    key: 'deflation',
    name: 'Deflation',
    favors: 'bonds',
    description: 'Demand collapse, falling prices, long-duration bonds rally.',
    probability: 0.09,
    playbook: [
      'The long-Treasury leg (TLT) is the payoff engine here — check it is at its 25% target and top up if under.',
      'Duration is the point: short bonds barely move when yields collapse; only the long end pays off for the whole portfolio.',
      'Expect equities and gold to sag together — do not cut them; the bond rally is designed to be the offset.',
      'Cash yields evaporate in deflation — lock rates early (fixed-term deposits) if the regime confirms.',
    ],
  },
  {
    key: 'tight',
    name: 'Tight Money',
    favors: 'cash',
    description: 'Liquidity squeeze, rates rising fast, defensive cash carries.',
    probability: 0.19,
    playbook: [
      'Cash is the shock absorber — hold the leg at target in short, rate-tracking yield (money-market funds, short deposits).',
      'Stay short — rising rates re-price short cash upward automatically; avoid locking long deposits now.',
      'Watch the 15% floor on equities: liquidity squeezes are when the mechanical buy-the-dip rebalance usually triggers. Execute it without debate.',
      'Defer large discretionary purchases from the book — being paid to wait is what this regime offers.',
    ],
  },
];

export const activeRegime: RegimeKey = 'inflation';

export const news: {
  time: string;
  source: string;
  headline: string;
  tag: RegimeKey;
}[] = [
  { time: '08:14', source: 'Reuters', headline: 'Gold prints fresh all-time high as central banks extend buying streak into eighth month.', tag: 'inflation' },
  { time: '07:42', source: 'FT', headline: 'ECB cuts to 2.25%; Lagarde flags upside risk from services inflation.', tag: 'inflation' },
  { time: '07:05', source: 'Bloomberg', headline: 'Long-end Treasuries sell off after weak 30-year auction; term premium expands.', tag: 'tight' },
  { time: 'Yest.', source: 'WSJ', headline: 'US payrolls revised lower for third straight month — soft-landing narrative wobbles.', tag: 'deflation' },
  { time: 'Yest.', source: 'Nikkei', headline: 'BoJ signals patience as yen stabilises above 152; carry trade unwinds postponed.', tag: 'prosperity' },
  { time: '2d ago', source: 'Reuters', headline: 'Copper-gold ratio breaks 25-year support — historical recession bellwether triggers.', tag: 'deflation' },
];
