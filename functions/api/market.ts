// Cloudflare Pages Function — keyless market read.
// 1. Regime engine: pulls macro signals from Yahoo and scores Browne's four
//    climates by rule (illustrative, not a forecast).
// 2. News: pulls a financial RSS feed and tags each headline by regime.
//   GET /api/market  →  { regimeProbs, activeRegime, news, signals, asOf }

type RegimeKey = 'prosperity' | 'inflation' | 'deflation' | 'tight';

// MTD change (%) — current price vs the last close before this month began.
// Scoring on single-day moves made the active read flip on every green/red
// session; month-to-date is closer to the trend the playbooks act on.
async function yChange(symbol: string): Promise<number | null> {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cf: { cacheTtl: 600 } } as RequestInit,
    );
    if (!r.ok) return null;
    const res: any = (await r.json())?.chart?.result?.[0];
    const price: number | undefined = res?.meta?.regularMarketPrice;
    if (!price) return null;
    const ts: number[] = res.timestamp ?? [];
    const closes: (number | null)[] = res.indicators?.quote?.[0]?.close ?? [];
    const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
    let ref: number | null = null;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] * 1000 >= monthStart) break;
      if (closes[i] != null) ref = closes[i];
    }
    return ref ? ((price - ref) / ref) * 100 : null;
  } catch {
    return null;
  }
}

const clampPos = (n: number | null) => Math.max(0, n ?? 0);

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&apos;|&#39;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function tagOf(title: string): RegimeKey {
  const t = title.toLowerCase();
  if (/inflation|cpi|price|gold|oil|energy|wage|commodit/.test(t)) return 'inflation';
  if (/recession|slowdown|shrank|shrink|contract|deflation|layoff|unemployment|weak|cooling|cut/.test(t)) return 'deflation';
  if (/rate hike|hawkish|tighten|yield|hike|tight|dollar surge/.test(t)) return 'tight';
  if (/growth|profit|record|rally|earnings|expansion|surge|beat|jump/.test(t)) return 'prosperity';
  return 'inflation';
}

function relTime(pub: string): string {
  const d = new Date(pub);
  if (isNaN(d.getTime())) return '';
  const h = (Date.now() - d.getTime()) / 3.6e6;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export const onRequestGet: PagesFunction = async () => {
  // --- regime scoring inputs (display signals moved to /api/history) ---
  const [tnx, gold, spx, dxy, copper] = await Promise.all([
    yChange('^TNX'),
    yChange('GC=F'),
    yChange('^GSPC'),
    yChange('DX-Y.NYB'),
    yChange('HG=F'),
  ]);

  const raw: Record<RegimeKey, number> = {
    prosperity: 0.3 + clampPos(spx) + clampPos(copper),
    inflation: 0.3 + clampPos(gold) + clampPos((gold ?? 0) - (spx ?? 0)),
    deflation: 0.3 + clampPos(tnx === null ? null : -tnx) + clampPos(spx === null ? null : -spx) + clampPos(copper === null ? null : -copper),
    tight: 0.3 + clampPos(tnx) + clampPos(dxy),
  };
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const regimeProbs = Object.fromEntries(
    (Object.keys(raw) as RegimeKey[]).map((k) => [k, raw[k] / sum]),
  ) as Record<RegimeKey, number>;
  const activeRegime = (Object.keys(regimeProbs) as RegimeKey[]).reduce((a, b) =>
    regimeProbs[a] >= regimeProbs[b] ? a : b,
  );

  // --- news (CNBC markets RSS, keyless) ---
  let news: { time: string; source: string; headline: string; tag: RegimeKey; link: string }[] = [];
  try {
    const res = await fetch('https://www.cnbc.com/id/20910258/device/rss/rss.html', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cf: { cacheTtl: 600 },
    } as RequestInit);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6);
    news = items
      .map((m) => {
        const block = m[1];
        const title = decode((block.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]);
        const link = decode((block.match(/<link>([\s\S]*?)<\/link>/) || [, ''])[1]);
        const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [, ''])[1].trim();
        return { time: relTime(pub), source: 'CNBC', headline: title, tag: tagOf(title), link };
      })
      .filter((n) => n.headline);
  } catch {
    news = [];
  }

  return new Response(
    JSON.stringify({
      regimeProbs,
      activeRegime,
      news,
      asOf: new Date().toISOString(),
    }),
    {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=600',
        'access-control-allow-origin': '*',
      },
    },
  );
};
