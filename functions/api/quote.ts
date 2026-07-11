// Cloudflare Pages Function — live price + FX proxy.
// Runs server-side on Cloudflare's edge: no CORS issues, no API key needed.
// Deployed automatically alongside the site (any file under /functions becomes a route).
//
//   GET /api/quote?symbols=VWRA.L,GLTL.L,SGLN.L&fx=USDCNY=X,GBPCNY=X,EURCNY=X
//
// Returns: { quotes: { "VWRA.L": { price, prevClose, currency, changePct } }, fx: {...}, asOf }

interface YahooMeta {
  regularMarketPrice: number;
  chartPreviousClose?: number;
  previousClose?: number;
  currency: string;
}

async function fetchYahoo(symbol: string): Promise<YahooMeta | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=1d`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PermanentPortfolio/1.0)' },
      cf: { cacheTtl: 120, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.chart?.result?.[0]?.meta ?? null;
  } catch {
    return null;
  }
}

// Some LSE lines quote in pence (GBp). Normalise to major units.
function normalise(meta: YahooMeta) {
  let { regularMarketPrice: price, currency } = meta;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? price;
  let prevClose = prev;
  if (currency === 'GBp' || currency === 'GBX') {
    price = price / 100;
    prevClose = prevClose / 100;
    currency = 'GBP';
  }
  const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
  return { price, prevClose, currency, changePct };
}

export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get('symbols') || '').split(',').filter(Boolean);
  const fxPairs = (url.searchParams.get('fx') || '').split(',').filter(Boolean);

  const quotes: Record<string, ReturnType<typeof normalise>> = {};
  const fx: Record<string, number> = {};

  await Promise.all([
    ...symbols.map(async (s) => {
      const meta = await fetchYahoo(s);
      if (meta) quotes[s] = normalise(meta);
    }),
    ...fxPairs.map(async (p) => {
      const meta = await fetchYahoo(p);
      if (meta?.regularMarketPrice) fx[p] = meta.regularMarketPrice;
    }),
  ]);

  return new Response(
    JSON.stringify({ quotes, fx, asOf: new Date().toISOString() }),
    {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=120',
        'access-control-allow-origin': '*',
      },
    },
  );
};
