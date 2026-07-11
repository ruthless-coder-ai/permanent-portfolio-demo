// Cloudflare Pages Function — reference prices for period P&L, keyless.
// For each requested Yahoo symbol (equities, gold future, FX pairs) returns the
// current price plus the last close before today / this month / this year, so
// the client can mark the whole book at those dates and show today/MTD/YTD
// wealth change from price & FX moves alone (manual cash figures stay flat).
// Optional `dates=YYYY-MM-DD,…` adds per-symbol closes at those dates (used
// for FX/prices at each position's entry date).
//   GET /api/history?symbols=QQQ,GC=F,USDCNY=X&dates=2026-06-01  →  { refs, at, asOf }

type Refs = {
  price: number;
  day: number | null;
  month: number | null;
  year: number | null;
  // Valuation context for the entry-conditions panel.
  hi52: number | null; // 52-week high close
  lo52: number | null; // 52-week low close
  ma200: number | null; // 200-trading-day average close
};

async function yRefs(symbol: string, dates: string[]): Promise<{ refs: Refs; at: Record<string, number | null> } | null> {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cf: { cacheTtl: 600 } } as RequestInit,
    );
    if (!r.ok) return null;
    const res: any = (await r.json())?.chart?.result?.[0];
    const price: number | undefined = res?.meta?.regularMarketPrice;
    if (!price) return null;

    const ts: number[] = res.timestamp ?? [];
    const closes: (number | null)[] = res.indicators?.quote?.[0]?.close ?? [];
    const series = ts
      .map((t, i) => ({ t: t * 1000, c: closes[i] }))
      .filter((p): p is { t: number; c: number } => p.c != null);

    const now = new Date();
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1);
    const lastBefore = (cutoff: number) => {
      let v: number | null = null;
      for (const p of series) {
        if (p.t >= cutoff) break;
        v = p.c;
      }
      return v;
    };

    const at: Record<string, number | null> = {};
    for (const d of dates) {
      const t = Date.parse(`${d}T00:00:00Z`);
      // "close at date" = last close before the NEXT day, so buying on a
      // trading day references that day's own close.
      at[d] = Number.isNaN(t) ? null : lastBefore(t + 864e5);
    }

    // 52-week range and 200-day mean from the same 1y daily series.
    const closesOnly = series.map((p) => p.c);
    const hi52 = closesOnly.length ? Math.max(...closesOnly, price) : null;
    const lo52 = closesOnly.length ? Math.min(...closesOnly, price) : null;
    const tail = closesOnly.slice(-200);
    const ma200 = tail.length >= 120 ? tail.reduce((s, c) => s + c, 0) / tail.length : null;

    // NB: meta.chartPreviousClose is useless here — with range=1y it is the
    // close before the range START (a year ago), so derive all refs from the
    // series instead. On non-trading days `day` equals the latest close.
    return {
      refs: {
        price,
        day: lastBefore(dayStart),
        month: lastBefore(monthStart),
        year: lastBefore(yearStart),
        hi52,
        lo52,
        ma200,
      },
      at,
    };
  } catch {
    return null;
  }
}

export const onRequestGet: PagesFunction = async ({ request }) => {
  const params = new URL(request.url).searchParams;
  const symbols = (params.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const dates = (params.get('dates') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  const results = await Promise.all(symbols.map((s) => yRefs(s, dates)));
  const refs: Record<string, Refs> = {};
  const at: Record<string, Record<string, number | null>> = {};
  symbols.forEach((s, i) => {
    const r = results[i];
    if (!r) return;
    refs[s] = r.refs;
    for (const d of dates) {
      (at[d] ??= {})[s] = r.at[d];
    }
  });

  return new Response(JSON.stringify({ refs, at, asOf: new Date().toISOString() }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=600',
      'access-control-allow-origin': '*',
    },
  });
};
