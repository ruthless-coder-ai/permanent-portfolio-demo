// Client-side live fetch: stock prices + spot gold + FX, via /api/quote.
// Cash values are manual; equities re-price from `shares × live price`, gold
// from spot, totals convert at live FX. Degrades to fallbacks on any failure.

import { fxSymbols, GOLD_SYMBOL, holdings, type Currency, type RegimeKey } from './data';

export type MarketNews = { time: string; source: string; headline: string; tag: RegimeKey; link: string };
export type MarketData = {
  regimeProbs: Record<RegimeKey, number>;
  activeRegime: RegimeKey;
  news: MarketNews[];
  asOf: string;
};

export async function fetchMarket(): Promise<MarketData | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    // no-cache: the ↻ button must actually refresh — Yahoo is edge-cached upstream.
    const res = await fetch('/api/market', { signal: controller.signal, cache: 'no-cache' });
    if (!res.ok) return null;
    const d = (await res.json()) as MarketData;
    if (!d?.regimeProbs) return null;
    return d;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Reference prices for period wealth change: current + last close before
// today / this month / this year, per Yahoo symbol (incl. FX pairs & gold),
// plus closes at each holding's entry date (`at`) so positions opened inside
// a period measure from cost at entry-date FX instead of the period start.
export type PriceRefs = {
  price: number;
  day: number | null;
  month: number | null;
  year: number | null;
  hi52: number | null;
  lo52: number | null;
  ma200: number | null;
};

// Long-duration reference for the bond leg's entry gauge (also held directly).
export const BOND_PROXY = 'TLT';
export type HistoryData = {
  refs: Record<string, PriceRefs>;
  at: Record<string, Record<string, number | null>>;
  asOf: string;
};

export async function fetchHistory(extraDates: string[] = []): Promise<HistoryData | null> {
  const stockSymbols = holdings.map((h) => h.yahooSymbol).filter((s): s is string => Boolean(s));
  // ^NDX rides along for the signals panel (today/MTD/YTD), not for valuation.
  const symbols = [
    ...new Set([...stockSymbols, GOLD_SYMBOL, '^NDX', BOND_PROXY, ...fxSymbols.map((f) => f.pair)]),
  ].join(',');
  // extraDates: entry dates of holdings added via the in-app ledger.
  const dates = [
    ...new Set([...holdings.map((h) => h.since).filter((d): d is string => Boolean(d)), ...extraDates]),
  ].join(',');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `/api/history?symbols=${encodeURIComponent(symbols)}&dates=${encodeURIComponent(dates)}`,
      { signal: controller.signal, cache: 'no-cache' },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as HistoryData;
    if (!d?.refs) return null;
    return d;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export type LiveData = {
  quotes: Record<string, number>; // yahooSymbol → price (native ccy)
  fx: Partial<Record<Currency, number>>; // CNY per 1 unit
  goldUsdPerOz: number | null;
  asOf: string;
};

export async function fetchLive(): Promise<LiveData | null> {
  const stockSymbols = holdings
    .map((h) => h.yahooSymbol)
    .filter((s): s is string => Boolean(s));
  const symbols = [...new Set([...stockSymbols, GOLD_SYMBOL])].join(',');
  const fxParam = fxSymbols.map((f) => f.pair).join(',');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(
      `/api/quote?symbols=${encodeURIComponent(symbols)}&fx=${encodeURIComponent(fxParam)}`,
      { signal: controller.signal, cache: 'no-cache' },
    );
    if (!res.ok) return null;
    const raw = (await res.json()) as {
      quotes: Record<string, { price: number }>;
      fx: Record<string, number>;
      asOf: string;
    };

    const fx: Partial<Record<Currency, number>> = {};
    for (const { pair, from } of fxSymbols) {
      if (raw.fx[pair]) fx[from] = raw.fx[pair];
    }
    const quotes: Record<string, number> = {};
    for (const [sym, q] of Object.entries(raw.quotes ?? {})) {
      if (q?.price) quotes[sym] = q.price;
    }
    return { quotes, fx, goldUsdPerOz: raw.quotes[GOLD_SYMBOL]?.price ?? null, asOf: raw.asOf };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
