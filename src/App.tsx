import { useEffect, useMemo, useState } from 'react';
import {
  accruedValue,
  activeRegime,
  assetMeta,
  baseCurrencies,
  fxToCNY,
  GOLD_SYMBOL,
  GRAMS_PER_OZ,
  holdings,
  news,
  regimes,
  TOTAL_TARGET,
  type AssetKey,
  type Currency,
  type Holding,
  type RegimeKey,
} from './data';
import { BOND_PROXY, fetchHistory, fetchLive, fetchMarket, type HistoryData, type LiveData, type MarketData } from './prices';
import './App.css';

const currencySymbol: Record<Currency, string> = { CNY: '¥', USD: '$', GBP: '£', EUR: '€' };

const fmtMoney = (n: number, cur: Currency, frac = 0) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: frac,
    minimumFractionDigits: frac,
  });
const fmtPct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
const fmtSigned = (n: number, digits = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;

const legOrder: AssetKey[] = ['stocks', 'bonds', 'gold', 'cash'];

// Figures the in-app ledger can override; stored in this browser only, merged
// over data.ts at load. Editing data.ts stays the durable source of truth.
// `valueAsOf` rides along so an edited value restarts interest accrual.
type Override = Partial<Pick<Holding, 'value' | 'cost' | 'shares' | 'grams' | 'valueAsOf'>>;
const OVERRIDES_KEY = 'pp-ledger-overrides-v1';
// Whole holdings added via the in-app ledger — same browser-only storage.
const ADDITIONS_KEY = 'pp-ledger-additions-v1';
type BookHolding = Holding & { added?: boolean };
const todayISO = () => new Date().toISOString().slice(0, 10);
const NEW_TARGET = '__new__';

// Two full palettes live in index.css, keyed by <html data-theme>.
type Theme = 'evening' | 'rose';
const THEME_KEY = 'pp-theme';
const themeColor: Record<Theme, string> = { evening: '#131a16', rose: '#f9edf0' };
const editableFields = ['value', 'cost', 'shares', 'grams'] as const;

function App() {
  const [base, setBase] = useState<Currency>('CNY');
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'evening' ? 'evening' : 'rose';
    } catch {
      return 'rose';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor[theme]);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch { /* private mode etc. — session-only */ }
  }, [theme]);
  const [overrides, setOverrides] = useState<Record<string, Override>>(() => {
    try {
      return JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? '{}');
    } catch {
      return {};
    }
  });
  const [additions, setAdditions] = useState<Holding[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(ADDITIONS_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  const persistAdditions = (next: Holding[]) => {
    setAdditions(next);
    try {
      localStorage.setItem(ADDITIONS_KEY, JSON.stringify(next));
    } catch { /* private mode etc. — session-only */ }
  };
  const book = useMemo<BookHolding[]>(
    () => [
      ...holdings.map((h) => ({ ...h, ...overrides[h.name] })),
      ...additions.map((h) => ({ ...h, ...overrides[h.name], added: true })),
    ],
    [overrides, additions],
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, Partial<Record<(typeof editableFields)[number], string>>>>({});

  const openLedger = () => {
    const d: typeof draft = {};
    for (const h of book) {
      d[h.name] = {
        value: String(h.value),
        cost: String(h.cost),
        ...(h.shares != null ? { shares: String(h.shares) } : {}),
        ...(h.grams != null ? { grams: String(h.grams) } : {}),
      };
    }
    setDraft(d);
    setEditing(true);
  };
  const saveLedger = () => {
    // Persist only fields that differ from the base rows (data.ts + additions),
    // so future code edits aren't shadowed by stale overrides.
    const next: Record<string, Override> = {};
    for (const h of [...holdings, ...additions]) {
      const d = draft[h.name];
      if (!d) continue;
      const o: Override = {};
      for (const f of editableFields) {
        const raw = d[f];
        if (raw == null || raw.trim() === '') continue;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n === h[f]) continue;
        o[f] = n;
      }
      // A fresh value mark restarts interest accrual from today.
      if (o.value != null && h.rate) o.valueAsOf = todayISO();
      if (Object.keys(o).length) next[h.name] = o;
    }
    setOverrides(next);
    try {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
    } catch { /* private mode etc. — session-only */ }
    setEditing(false);
  };
  const resetLedger = () => {
    setOverrides({});
    persistAdditions([]);
    try {
      localStorage.removeItem(OVERRIDES_KEY);
      localStorage.removeItem(ADDITIONS_KEY);
    } catch { /* ignore */ }
    setEditing(false);
  };

  // "Record a change" panel: pick an existing holding (or add a new one),
  // choose increase/decrease, apply — the row inputs below update; Save persists.
  const [adjTarget, setAdjTarget] = useState('');
  const [adjDir, setAdjDir] = useState<'inc' | 'dec'>('inc');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjCost, setAdjCost] = useState('');
  const emptyNew = { name: '', leg: 'stocks' as AssetKey, currency: 'CNY' as Currency, account: '', value: '', rate: '' };
  const [newDraft, setNewDraft] = useState(emptyNew);
  const adjH = adjTarget !== NEW_TARGET ? book.find((h) => h.name === adjTarget) : undefined;
  const unitField: 'shares' | 'grams' | 'value' =
    adjH?.shares != null ? 'shares' : adjH?.grams != null ? 'grams' : 'value';
  const unitLabel =
    unitField === 'shares' ? 'shares' : unitField === 'grams' ? 'grams' : `amount (${adjH?.currency ?? ''})`;

  const applyAdjustment = () => {
    if (!adjH) return;
    const amt = Number(adjAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    const sign = adjDir === 'inc' ? 1 : -1;
    const row = draft[adjH.name] ?? {};
    const round = (n: number, dp: number) => Number(n.toFixed(dp));
    const cur = Number(row[unitField] ?? adjH[unitField] ?? 0);
    const next = Math.max(0, cur + sign * amt);
    // Cost impact defaults to the amount for plain-currency holdings; for
    // share/gram holdings it's the money actually paid/received (optional).
    const costDelta = adjCost.trim() === '' ? (unitField === 'value' ? amt : 0) : Number(adjCost);
    const nextCost = Math.max(0, Number(row.cost ?? adjH.cost) + sign * (Number.isFinite(costDelta) ? costDelta : 0));
    const updates: Partial<Record<(typeof editableFields)[number], string>> = {
      [unitField]: String(round(next, unitField === 'value' ? 2 : 4)),
      cost: String(round(nextCost, 2)),
    };
    // Keep the offline fallback value in step when units change.
    if (unitField !== 'value' && cur > 0) {
      updates.value = String(round(Number(row.value ?? adjH.value) * (next / cur), 2));
    }
    setDraft((d) => ({ ...d, [adjH.name]: { ...d[adjH.name], ...updates } }));
    setAdjAmount('');
    setAdjCost('');
  };

  const addHolding = () => {
    const name = newDraft.name.trim();
    const value = Number(newDraft.value);
    if (!name || book.some((h) => h.name === name) || !Number.isFinite(value) || value < 0) return;
    const ratePct = newDraft.rate.trim() === '' ? null : Number(newDraft.rate);
    const h: Holding = {
      leg: newDraft.leg,
      name,
      account: newDraft.account.trim() || 'Manual entry',
      currency: newDraft.currency,
      value,
      cost: value,
      since: todayISO(),
      ...(ratePct != null && Number.isFinite(ratePct) && ratePct > 0
        ? { rate: ratePct / 100, valueAsOf: todayISO(), note: `${ratePct.toFixed(2)}% p.a.` }
        : {}),
    };
    persistAdditions([...additions, h]);
    setDraft((d) => ({ ...d, [name]: { value: String(value), cost: String(value) } }));
    setNewDraft(emptyNew);
    setAdjTarget(name);
  };

  const removeAddition = (name: string) => {
    persistAdditions(additions.filter((a) => a.name !== name));
    const rest = { ...overrides };
    delete rest[name];
    setOverrides(rest);
    try {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(rest));
    } catch { /* ignore */ }
    setDraft((d) => {
      const restD = { ...d };
      delete restD[name];
      return restD;
    });
    if (adjTarget === name) setAdjTarget('');
  };

  // Regime playbook modal — click a quadrant to expand it into actions.
  const [regimeOpen, setRegimeOpen] = useState<RegimeKey | null>(null);
  const [live, setLive] = useState<LiveData | null>(null);
  const [market, setMarket] = useState<MarketData | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    Promise.all([
      fetchLive().then((d) => d && setLive(d)),
      fetchMarket().then((d) => d && setMarket(d)),
      fetchHistory(additions.map((a) => a.since).filter((d): d is string => Boolean(d))).then(
        (d) => d && setHistory(d),
      ),
    ]).finally(() => setRefreshing(false));
  };
  useEffect(() => {
    refresh();
    // Re-fetch when holdings are added so their entry-date FX refs come along.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [additions.length]);

  const fx = useMemo(() => ({ ...fxToCNY, ...(live?.fx ?? {}) }), [live]);

  // Live spot price for the gold leg, in CNY per gram (falls back to manual).
  const goldCnyPerGram =
    live?.goldUsdPerOz != null ? (live.goldUsdPerOz / GRAMS_PER_OZ) * fx.USD : null;

  // Aggregate the flat holdings list into the four Browne legs, converting every
  // native-currency figure into the chosen base currency.
  const legs = useMemo(() => {
    const conv = (amount: number, from: Currency) => (amount * fx[from]) / fx[base];
    const acc: Record<AssetKey, { items: (Holding & { valueBase: number })[]; valueBase: number; costBase: number }> = {
      stocks: { items: [], valueBase: 0, costBase: 0 },
      bonds: { items: [], valueBase: 0, costBase: 0 },
      gold: { items: [], valueBase: 0, costBase: 0 },
      cash: { items: [], valueBase: 0, costBase: 0 },
    };
    for (const h of book) {
      if (h.excluded) continue;
      // Gold re-prices from spot, equities from shares × live quote, else the
      // manual mark plus daily interest accrual for rate-bearing cash.
      const livePrice = h.yahooSymbol ? live?.quotes[h.yahooSymbol] : undefined;
      const nativeValue =
        h.grams && goldCnyPerGram != null
          ? h.grams * goldCnyPerGram
          : h.shares && livePrice
            ? h.shares * livePrice
            : accruedValue(h);
      const valueBase = conv(nativeValue, h.currency);
      acc[h.leg].items.push({ ...h, value: nativeValue, valueBase });
      acc[h.leg].valueBase += valueBase;
      acc[h.leg].costBase += conv(h.cost, h.currency);
    }
    const total = legOrder.reduce((s, k) => s + acc[k].valueBase, 0);
    return legOrder.map((key) => {
      const l = acc[key];
      const weight = total ? l.valueBase / total : 0;
      return {
        key,
        items: l.items,
        valueBase: l.valueBase,
        costBase: l.costBase,
        weight,
        deviation: weight - TOTAL_TARGET,
        pnlPct: l.costBase ? (l.valueBase - l.costBase) / l.costBase : 0,
      };
    });
  }, [base, fx, goldCnyPerGram, live, book]);

  const totalValue = legs.reduce((s, l) => s + l.valueBase, 0);
  const totalCost = legs.reduce((s, l) => s + l.costBase, 0);
  const totalPnL = totalValue - totalCost;
  const totalPnLPct = totalCost ? totalPnL / totalCost : 0;
  const cashLeg = legs.find((l) => l.key === 'cash')!;

  // Entry conditions: the question that matters when adding new money is WHEN
  // each leg is worth buying, not how far it is from 25%.
  // Gauge = position in the 52-week range + stretch vs the 200-day mean.
  const gaugeOf = (sym: string) => {
    const r = history?.refs[sym];
    if (!r || r.hi52 == null || r.lo52 == null) return null;
    const offHigh = (r.price - r.hi52) / r.hi52; // ≤ 0 — drawdown from 52w high
    const vsMa = r.ma200 != null ? (r.price - r.ma200) / r.ma200 : null;
    const span = r.hi52 - r.lo52;
    const posIn52w = span > 0 ? (r.price - r.lo52) / span : 1;
    const maPos = r.ma200 != null && span > 0 ? (r.ma200 - r.lo52) / span : null;
    const tone: 'rich' | 'fair' | 'cheap' =
      offHigh <= -0.15 || (vsMa != null && vsMa <= -0.05)
        ? 'cheap'
        : offHigh >= -0.04 && (vsMa == null || vsMa >= 0.04)
          ? 'rich'
          : 'fair';
    return { ...r, offHigh, vsMa, posIn52w, maPos, tone };
  };
  const toneMeta = {
    rich: { label: 'rich — wait', advice: 'Near the 52-week high — drip small monthly buys only; do not chase with the cash pile.' },
    fair: { label: 'fair', advice: 'Inside the range — add in normal tranches toward the 25% target.' },
    cheap: { label: 'discounted — buy', advice: 'Well off the high — deploy a real tranche; this is what the cash was waiting for.' },
  } as const;
  const entryRows = [
    { key: 'stocks' as AssetKey, sym: '^NDX', name: 'Nasdaq-100', note: 'entry gauge for the equity leg (QQQ)' },
    { key: 'gold' as AssetKey, sym: GOLD_SYMBOL, name: 'Gold — COMEX', note: 'spot behind the gold account' },
    { key: 'bonds' as AssetKey, sym: BOND_PROXY, name: '20y+ Treasuries (TLT)', note: 'entry gauge for the bond leg' },
  ];
  const fmtLevel = (n: number) =>
    n.toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
  // Cash while waiting: blended yield across rate-bearing cash, in CNY terms.
  const cashRows = book.filter((h) => !h.excluded && h.leg === 'cash');
  const cashCny = cashRows.reduce((s, h) => s + accruedValue(h) * fx[h.currency], 0);
  const blendedRate = cashCny
    ? cashRows.reduce((s, h) => s + accruedValue(h) * fx[h.currency] * (h.rate ?? 0), 0) / cashCny
    : 0;
  const deployable = Math.max(0, cashLeg.valueBase - TOTAL_TARGET * totalValue);

  // Regime + news: live from /api/market when available, else static fallback.
  const regimeList = regimes.map((r) => ({
    ...r,
    probability: market?.regimeProbs[r.key] ?? r.probability,
  }));
  const activeKey = market?.activeRegime ?? activeRegime;
  const newsList = market?.news?.length ? market.news : news;
  const newsLive = Boolean(market?.news?.length);

  const today = new Date();
  // Masthead folio: volume counts years since the 2025 launch, issue = ISO week.
  const week = Math.ceil(
    ((today.getTime() - Date.UTC(today.getFullYear(), 0, 1)) / 864e5 + 1) / 7,
  );
  const volume = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][today.getFullYear() - 2025] ?? `${today.getFullYear() - 2024}`;
  const asOfLabel = live
    ? new Date(live.asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null;

  // Signals: what the demo book actually holds — the USD cross plus the three
  // priced legs, each with level and today / MTD / YTD change from /api/history.
  const fmtFx = (p: number) => p.toFixed(3);
  const signalDefs = [
    { sym: 'USDCNY=X', label: 'USD / CNY', fmt: fmtFx, note: 'Dollar vs the CNY book base' },
    { sym: '^NDX', label: 'Nasdaq-100', fmt: (p: number) => p.toLocaleString('en-US', { maximumFractionDigits: 0 }), note: 'Equity leg (QQQ)' },
    { sym: GOLD_SYMBOL, label: 'Gold — COMEX', fmt: (p: number) => p.toLocaleString('en-US', { maximumFractionDigits: 0 }), note: 'Gold leg · USD/oz' },
    { sym: BOND_PROXY, label: '20y+ Treasuries', fmt: (p: number) => p.toFixed(2), note: 'Bond leg (TLT)' },
  ] as const;
  const signalPeriods = [
    { key: 'day', label: 'Today' },
    { key: 'month', label: 'MTD' },
    { key: 'year', label: 'YTD' },
  ] as const;
  const signals = signalDefs.map((d) => {
    const r = history?.refs[d.sym];
    const pct = (ref: number | null | undefined) =>
      r && ref ? ((r.price - ref) / ref) * 100 : null;
    return { ...d, value: r ? d.fmt(r.price) : '—', day: pct(r?.day), month: pct(r?.month), year: pct(r?.year) };
  });
  const indicatorsLive = Boolean(history);

  // Today / MTD / YTD wealth change, marking the whole book at reference
  // prices+FX from /api/history. A position entered INSIDE a period measures
  // from its cost at entry-date FX (per-holding `since`), never from a
  // period-start price the user wasn't exposed to. Manual cash accrues its
  // stated rate in native currency — cash flows are excluded.
  const fxPairOf: Record<Currency, string | null> = { CNY: null, USD: 'USDCNY=X', GBP: 'GBPCNY=X', EUR: 'EURCNY=X' };
  const wealth = useMemo(() => {
    if (!history) return null;
    const { refs, at } = history;
    const now = new Date();
    const cutoff = {
      day: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      month: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      year: Date.UTC(now.getUTCFullYear(), 0, 1),
    };

    // One holding's CNY value at a reference point ('price' = now).
    const holdingAt = (h: Holding, k: 'price' | 'day' | 'month' | 'year'): number | null => {
      const pair = fxPairOf[h.currency];
      if (k !== 'price' && h.since && Date.parse(`${h.since}T00:00:00Z`) > cutoff[k]) {
        // Entry-date FX may be missing for holdings added in-app before the
        // next /api/history round-trip — fall back to the current rate so the
        // panel degrades to "no FX move counted" instead of going blank.
        const fxEntry = pair ? at?.[h.since]?.[pair] ?? refs[pair]?.price : 1;
        return fxEntry == null ? null : h.cost * fxEntry;
      }
      const fxRef = pair ? refs[pair]?.[k] : 1;
      if (fxRef == null) return null;
      if (h.grams) {
        const g = refs[GOLD_SYMBOL]?.[k];
        const usd = refs['USDCNY=X']?.[k];
        return g == null || usd == null ? null : h.grams * (g / GRAMS_PER_OZ) * usd;
      }
      if (h.yahooSymbol && h.shares) {
        const p = refs[h.yahooSymbol]?.[k];
        return p == null ? null : h.shares * p * fxRef;
      }
      // Manual holdings accrue interest to the reference date, so daily
      // coupon shows up in "Today" instead of the value sitting flat.
      return accruedValue(h, k === 'price' ? now : new Date(cutoff[k])) * fxRef;
    };

    const navAt = (k: 'price' | 'day' | 'month' | 'year'): number | null => {
      let sum = 0;
      for (const h of book) {
        if (h.excluded) continue;
        const v = holdingAt(h, k);
        if (v == null) return null;
        sum += v;
      }
      return sum; // CNY
    };

    const nowCny = navAt('price');
    if (nowCny == null) return null;
    const label = { day: 'Today', month: 'This month', year: 'This year' } as const;
    const periods = (['day', 'month', 'year'] as const).flatMap((k) => {
      const ref = navAt(k);
      return ref == null || ref === 0
        ? []
        : [{ key: k, label: label[k], absCny: nowCny - ref, pct: (nowCny - ref) / ref }];
    });
    return periods.length ? periods : null;
  }, [history, book]);

  return (
    <div className="page">
      {/* MASTHEAD */}
      <header className="masthead">
        <div className="masthead-top">
          <div className="masthead-meta smallcaps">Vol. {volume} — Iss. {week}</div>
          <div className="masthead-meta smallcaps">
            {today.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </div>
          <div className="masthead-meta currency-switch">
            <span className="smallcaps currency-switch-label">Base</span>
            {baseCurrencies.map((c) => (
              <button key={c} className={`currency-btn ${c === base ? 'active' : ''}`} onClick={() => setBase(c)}>
                {currencySymbol[c]} {c}
              </button>
            ))}
            <button
              className="theme-btn"
              onClick={() => setTheme(theme === 'rose' ? 'evening' : 'rose')}
              title="Switch color theme"
            >
              {theme === 'rose' ? '☾ Evening' : '❀ Rose'}
            </button>
            <button className="ledger-btn" onClick={openLedger} title="Record asset changes">
              ✎ Ledger
            </button>
            <button className="refresh-btn" onClick={refresh} disabled={refreshing} title="Refresh prices, FX & gold">
              {refreshing ? '↻ …' : '↻ Refresh'}
            </button>
          </div>
        </div>
        <hr className="rule-double" />
        <h1 className="masthead-title">
          The Permanent Portfolio
          <span className="masthead-mark">·</span>
          <em>Quarterly Watch</em>
        </h1>
        <hr className="rule" />
        <div className="masthead-subhead">
          <span>
            A four-legged, all-weather book after H. Browne (1981) — equities, long bonds, gold and
            cash. Demo edition: ¥10,000 seeded 1 June 2026, re-priced live.
          </span>
          <span className="dateline smallcaps">Demo edition · dummy holdings · {base} book</span>
        </div>
      </header>

      {/* HERO */}
      <section className="hero">
        <div className="hero-figures">
          <div className="figure-block">
            <div className="smallcaps">Net asset value</div>
            <div className="figure-headline num">{fmtMoney(totalValue, base)}</div>
            <div className={`figure-delta num ${totalPnL >= 0 ? 'pos' : 'neg'}`}>
              {totalPnL >= 0 ? '▲' : '▼'} {fmtMoney(Math.abs(totalPnL), base)}{' '}
              <span className="figure-delta-pct">({fmtSigned(totalPnLPct * 100)})</span>
              <span className="figure-delta-note smallcaps">Unrealised</span>
            </div>
            <div className={`data-status ${live ? 'is-live' : ''}`}>
              <span className="data-dot" />
              <span className="smallcaps">
                {live ? `Live quotes · FX · gold — ${asOfLabel} · cash manual` : 'Offline — fallback prices & FX'}
              </span>
            </div>
          </div>
          <div className="figure-block">
            <div className="smallcaps">Cash share</div>
            <div className="figure-headline num small">{fmtPct(cashLeg.weight)}</div>
            <div className="figure-sub smallcaps">Target 25% · band 15–35%</div>
          </div>
          <div className="figure-block">
            <div className="smallcaps">Wealth change</div>
            {wealth ? (
              <div className="wealth-rows">
                {wealth.map((w) => {
                  const amt = w.absCny / fx[base];
                  return (
                    <div className="wealth-row" key={w.key}>
                      <span className="smallcaps wealth-label">{w.label}</span>
                      <span className={`num wealth-amt ${w.absCny >= 0 ? 'pos' : 'neg'}`}>
                        {w.absCny >= 0 ? '+' : '−'}{fmtMoney(Math.abs(amt), base)}
                      </span>
                      <span className="num wealth-pct">{fmtSigned(w.pct * 100, 2)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="figure-headline num small">—</div>
            )}
            <div className="figure-sub smallcaps">Price · FX · interest since entry · flows excluded</div>
          </div>
          <div className="figure-block">
            <div className="smallcaps">Seeded</div>
            <div className="figure-headline num small">{fmtMoney(10000 / fx[base], base)}</div>
            <div className="figure-sub smallcaps">¥10,000 · 1 June 2026 · 4 × 25%</div>
          </div>
        </div>

        <div className="hero-chart">
          <div className="chart-header">
            <div>
              <div className="smallcaps">Entry conditions</div>
              <div className="chart-title">Is now a good time to buy? — {base} book</div>
            </div>
            <div className="chart-legend">
              {legOrder.map((k) => (
                <div className="legend-item" key={k}>
                  <span className="legend-swatch" style={{ background: assetMeta[k].color }} />
                  <span className="smallcaps">
                    {assetMeta[k].label} {fmtPct(legs.find((l) => l.key === k)!.weight, 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="alloc">
            <div className="alloc-bar slim">
              {legs.map(
                (l) =>
                  l.weight > 0 && (
                    <div
                      key={l.key}
                      className="alloc-seg"
                      style={{ width: `${l.weight * 100}%`, background: assetMeta[l.key].color }}
                      title={`${assetMeta[l.key].label} ${fmtPct(l.weight)}`}
                    />
                  ),
              )}
              {[25, 50, 75].map((t) => (
                <div key={t} className="alloc-tick" style={{ left: `${t}%` }} />
              ))}
            </div>

            <div className="smallcaps entry-head">
              {history
                ? 'Each leg vs its 52-week range · ┊ = 200-day mean'
                : 'Entry gauges — offline, refresh for live data'}
            </div>

            <div className="entry-rows">
              {entryRows.map((row) => {
                const g = gaugeOf(row.sym);
                return (
                  <div className="entry-row" key={row.key}>
                    <div className="entry-id">
                      <span className="alloc-sw" style={{ background: assetMeta[row.key].color }} />
                      <div className="entry-id-text">
                        <span className="entry-name">{row.name}</span>
                        <span className="smallcaps entry-note">{row.note}</span>
                      </div>
                      {g && <span className={`entry-tag smallcaps tone-${g.tone}`}>{toneMeta[g.tone].label}</span>}
                    </div>
                    {g ? (
                      <>
                        <div className="range-track">
                          {g.maPos != null && (
                            <div
                              className="range-ma"
                              style={{ left: `${Math.min(100, Math.max(0, g.maPos * 100))}%` }}
                              title={`200-day mean ${fmtLevel(g.ma200!)}`}
                            />
                          )}
                          <div
                            className="range-dot"
                            style={{
                              left: `${Math.min(100, Math.max(0, g.posIn52w * 100))}%`,
                              background: assetMeta[row.key].color,
                            }}
                            title={`now ${fmtLevel(g.price)}`}
                          />
                        </div>
                        <div className="range-meta num">
                          <span>{fmtLevel(g.lo52!)}</span>
                          <span className="range-mid">
                            {fmtSigned(g.offHigh * 100)} off high
                            {g.vsMa != null && <> · {fmtSigned(g.vsMa * 100)} vs 200d</>} · now {fmtLevel(g.price)}
                          </span>
                          <span>{fmtLevel(g.hi52!)}</span>
                        </div>
                        <div className={`entry-advice tone-${g.tone}`}>{toneMeta[g.tone].advice}</div>
                      </>
                    ) : (
                      <div className="range-meta smallcaps">— no live gauge —</div>
                    )}
                  </div>
                );
              })}

              <div className="entry-row">
                <div className="entry-id">
                  <span className="alloc-sw" style={{ background: assetMeta.cash.color }} />
                  <div className="entry-id-text">
                    <span className="entry-name">Cash while you wait</span>
                    <span className="smallcaps entry-note">{fmtPct(cashLeg.weight)} of book</span>
                  </div>
                  <span className="entry-tag smallcaps tone-wait">paid to wait</span>
                </div>
                <div className="entry-cash-line">
                  Earning ≈ <span className="num">{(blendedRate * 100).toFixed(2)}%</span> p.a. blended ·
                  deployable beyond the 25% cash leg: <span className="num">{fmtMoney(deployable, base)}</span>
                </div>
                <div className="entry-advice tone-wait">
                  No rush — the gauges above say when. Until one reads “discounted”, the cash is earning its keep.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <hr className="rule-double section-rule" />

      {/* LEG CARDS */}
      <section className="positions">
        <div className="section-head">
          <div className="smallcaps">Section II</div>
          <h2 className="section-title">Positions &amp; drift</h2>
          <div className="section-deck">
            Target 25% per leg. Browne’s rule: act when any leg falls below 15% or rises above 35%. Each
            card aggregates the real accounts under that leg.
          </div>
        </div>

        <div className="cards">
          {legs.map((l) => {
            return (
              <article
                className="card"
                key={l.key}
                style={{ ['--card-color' as string]: assetMeta[l.key].color } as React.CSSProperties}
              >
                <div className="card-top">
                  <span className="card-glyph" style={{ color: assetMeta[l.key].color }} aria-hidden>
                    {assetMeta[l.key].symbol}
                  </span>
                  <div>
                    <div className="card-name">{assetMeta[l.key].label}</div>
                    <div className="smallcaps card-ticker">
                      {l.items.length} {l.items.length === 1 ? 'account' : 'accounts'} · favored under{' '}
                      {assetMeta[l.key].favored}
                    </div>
                  </div>
                </div>

                <hr className="rule-hair" />

                <div className="card-grid">
                  <div>
                    <div className="smallcaps">Weight</div>
                    <div className="card-weight num">{fmtPct(l.weight)}</div>
                  </div>
                  <div>
                    <div className="smallcaps">Target</div>
                    <div className="card-target num">25.0%</div>
                  </div>
                </div>

                <div className="card-bottom three">
                  <div>
                    <div className="smallcaps">Cost</div>
                    <div className="num card-val muted">{l.items.length ? fmtMoney(l.costBase, base) : '—'}</div>
                  </div>
                  <div>
                    <div className="smallcaps">Value</div>
                    <div className="num card-val">{fmtMoney(l.valueBase, base)}</div>
                  </div>
                  <div>
                    <div className="smallcaps">P&amp;L</div>
                    <div className={`num card-pnl ${l.valueBase - l.costBase >= 0 ? 'pos' : 'neg'}`}>
                      {l.items.length ? (
                        <>
                          {fmtMoney(l.valueBase - l.costBase, base)}
                          <span className="card-pnl-pct"> {fmtSigned(l.pnlPct * 100)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </div>
                  </div>
                </div>

                <ul className="breakdown">
                  {l.items.map((it) => {
                    const diff = it.value - it.cost;
                    return (
                      <li className="breakdown-item" key={it.name}>
                        <span className="breakdown-name">
                          {it.name}
                          {it.note && <span className="breakdown-note"> · {it.note}</span>}
                        </span>
                        <span className="num breakdown-val">{fmtMoney(it.value, it.currency)}</span>
                        <span className={`num breakdown-diff ${diff >= 0 ? 'pos' : 'neg'}`}>
                          {Math.abs(diff) < 0.5 ? '—' : fmtMoney(diff, it.currency)}
                        </span>
                      </li>
                    );
                  })}
                  {l.items.length === 0 && <li className="breakdown-empty smallcaps">No holdings — 0% vs 25% target</li>}
                </ul>
              </article>
            );
          })}
        </div>

      </section>

      <hr className="rule-double section-rule" />

      {/* REGIME + NEWS */}
      <section className="lower">
        <div className="regime">
          <div className="section-head">
            <div className="smallcaps">Section III</div>
            <h2 className="section-title">Market regime</h2>
            <div className="section-deck">
              Browne’s four economic climates. Probabilities are an illustrative read of the signals below — not a forecast.
            </div>
          </div>

          <div className="regime-grid">
            {regimeList.map((r) => {
              const isActive = r.key === activeKey;
              return (
                <div
                  key={r.key}
                  className={`regime-cell ${isActive ? 'active' : ''}`}
                  style={{ ['--cell-color' as string]: `var(--c-${r.favors})` } as React.CSSProperties}
                  role="button"
                  tabIndex={0}
                  onClick={() => setRegimeOpen(r.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setRegimeOpen(r.key);
                    }
                  }}
                  aria-label={`Open ${r.name} playbook`}
                >
                  <div className="regime-cell-top">
                    <span className="regime-letter">{r.name.charAt(0)}</span>
                    <div>
                      <div className="regime-name">{r.name}</div>
                      <div className="smallcaps">Favors {assetMeta[r.favors].label}</div>
                    </div>
                  </div>
                  <p className="regime-desc">{r.description}</p>
                  <div className="regime-prob">
                    <div className="regime-prob-bar">
                      <div className="regime-prob-fill" style={{ width: `${r.probability * 100}%` }} />
                    </div>
                    <div className="num regime-prob-val">{fmtPct(r.probability)}</div>
                  </div>
                  <div className="regime-more smallcaps">Playbook →</div>
                  {isActive && <div className="regime-stamp smallcaps">— active read —</div>}
                </div>
              );
            })}
          </div>

          <div className="indicators">
            <div className="smallcaps indicators-head">
              {indicatorsLive ? 'Signals — live' : 'Signals — offline, refresh for data'}
            </div>
            <hr className="rule-hair" />
            <div className="indicator-grid">
              {signals.map((s) => (
                <div className="indicator" key={s.sym}>
                  <div className="indicator-row">
                    <div>
                      <div className="smallcaps">{s.label}</div>
                      <div className="indicator-note">{s.note}</div>
                    </div>
                    <div className="num indicator-val">{s.value}</div>
                  </div>
                  <div className="indicator-periods">
                    {signalPeriods.map((p) => {
                      const v = s[p.key];
                      return (
                        <span className="indicator-period" key={p.key}>
                          <span className="smallcaps indicator-period-label">{p.label}</span>
                          <span className={`num indicator-period-val ${v == null ? '' : v >= 0 ? 'pos' : 'neg'}`}>
                            {v == null ? '—' : fmtSigned(v, 2)}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="news">
          <div className="section-head">
            <div className="smallcaps">Section IV</div>
            <h2 className="section-title">The wire</h2>
            <div className="section-deck">
              {newsLive
                ? 'Live from CNBC, tagged by the regime each headline argues for. Confirmation comes from confluence, not any one headline.'
                : 'Sample wire — live headlines load on the deployed site. Tagged by regime.'}
            </div>
          </div>

          <ul className="news-list">
            {newsList.map((n, i) => {
              const link = (n as { link?: string }).link;
              return (
                <li className="news-item" key={i}>
                  <div className="news-meta">
                    <span className="num news-time">{n.time}</span>
                    <span className="smallcaps news-source">{n.source}</span>
                    <span className={`news-tag tag-${n.tag}`}>
                      <span className="smallcaps">{regimeList.find((r) => r.key === n.tag)?.name}</span>
                    </span>
                  </div>
                  {link ? (
                    <a className="news-headline news-link" href={link} target="_blank" rel="noreferrer">
                      {n.headline}
                    </a>
                  ) : (
                    <p className="news-headline">{n.headline}</p>
                  )}
                  <hr className="rule-hair" />
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* LEDGER — in-app asset updates, saved to this browser */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="smallcaps">Ledger update</div>
                <h3 className="modal-title">Record asset changes</h3>
              </div>
              <button className="modal-close" onClick={() => setEditing(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <p className="modal-note">
              Figures in each holding's native currency. Saved to this browser only — edit{' '}
              <span className="num">src/data.ts</span> to make a change permanent.
            </p>

            <div className="adjust">
              <div className="smallcaps adjust-head">Record a change</div>
              <div className="adjust-grid">
                <label className="ledger-field adjust-target">
                  <span className="smallcaps">Holding</span>
                  <select value={adjTarget} onChange={(e) => setAdjTarget(e.target.value)}>
                    <option value="">Select a holding…</option>
                    {book.map((h) => (
                      <option key={h.name} value={h.name}>
                        {h.name} ({h.currency})
                      </option>
                    ))}
                    <option value={NEW_TARGET}>＋ New holding…</option>
                  </select>
                </label>
                {adjH && (
                  <>
                    <div className="adjust-dir">
                      <button
                        className={`currency-btn ${adjDir === 'inc' ? 'active' : ''}`}
                        onClick={() => setAdjDir('inc')}
                      >
                        ＋ Increase
                      </button>
                      <button
                        className={`currency-btn ${adjDir === 'dec' ? 'active' : ''}`}
                        onClick={() => setAdjDir('dec')}
                      >
                        − Decrease
                      </button>
                    </div>
                    <label className="ledger-field">
                      <span className="smallcaps">{unitLabel}</span>
                      <input
                        className="num"
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        placeholder="0"
                        value={adjAmount}
                        onChange={(e) => setAdjAmount(e.target.value)}
                      />
                    </label>
                    <label className="ledger-field">
                      <span className="smallcaps">Cost impact ({adjH.currency})</span>
                      <input
                        className="num"
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        placeholder={unitField === 'value' ? '= amount' : 'money paid / received'}
                        value={adjCost}
                        onChange={(e) => setAdjCost(e.target.value)}
                      />
                    </label>
                    <button className="btn-solid adjust-apply" onClick={applyAdjustment}>
                      Apply ↓
                    </button>
                  </>
                )}
              </div>
              {adjTarget === NEW_TARGET && (
                <div className="adjust-grid adjust-new">
                  <label className="ledger-field adjust-target">
                    <span className="smallcaps">Name</span>
                    <input
                      value={newDraft.name}
                      onChange={(e) => setNewDraft((n) => ({ ...n, name: e.target.value }))}
                      placeholder="e.g. Long Gilt ETF"
                    />
                  </label>
                  <label className="ledger-field">
                    <span className="smallcaps">Leg</span>
                    <select
                      value={newDraft.leg}
                      onChange={(e) => setNewDraft((n) => ({ ...n, leg: e.target.value as AssetKey }))}
                    >
                      {legOrder.map((k) => (
                        <option key={k} value={k}>
                          {assetMeta[k].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ledger-field">
                    <span className="smallcaps">Currency</span>
                    <select
                      value={newDraft.currency}
                      onChange={(e) => setNewDraft((n) => ({ ...n, currency: e.target.value as Currency }))}
                    >
                      {baseCurrencies.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ledger-field">
                    <span className="smallcaps">Account</span>
                    <input
                      value={newDraft.account}
                      onChange={(e) => setNewDraft((n) => ({ ...n, account: e.target.value }))}
                      placeholder="broker / bank"
                    />
                  </label>
                  <label className="ledger-field">
                    <span className="smallcaps">Value ({newDraft.currency})</span>
                    <input
                      className="num"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      placeholder="0"
                      value={newDraft.value}
                      onChange={(e) => setNewDraft((n) => ({ ...n, value: e.target.value }))}
                    />
                  </label>
                  <label className="ledger-field">
                    <span className="smallcaps">Rate % p.a. (opt.)</span>
                    <input
                      className="num"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      placeholder="e.g. 4.51"
                      value={newDraft.rate}
                      onChange={(e) => setNewDraft((n) => ({ ...n, rate: e.target.value }))}
                    />
                  </label>
                  <button
                    className="btn-solid adjust-apply"
                    onClick={addHolding}
                    disabled={!newDraft.name.trim() || newDraft.value.trim() === ''}
                  >
                    Add holding
                  </button>
                </div>
              )}
              <p className="adjust-note smallcaps">
                Apply updates the rows below · Save writes it to this browser
              </p>
            </div>

            <div className="ledger-rows">
              {book.map((h) => (
                <div className="ledger-row" key={h.name}>
                  <div className="ledger-id">
                    <span className="ledger-sw" style={{ background: assetMeta[h.leg].color }} />
                    <div>
                      <div className="ledger-name">
                        {h.name}
                        {overrides[h.name] && <span className="ledger-edited smallcaps"> · edited</span>}
                        {h.added && (
                          <button
                            className="ledger-remove"
                            onClick={() => removeAddition(h.name)}
                            title="Remove this added holding"
                          >
                            ✕ remove
                          </button>
                        )}
                      </div>
                      <div className="smallcaps ledger-acct">
                        {h.account} · {h.currency}
                        {h.excluded ? ' · reserve' : ''}
                        {h.added ? ' · added in-app' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="ledger-fields">
                    {editableFields.map((f) =>
                      draft[h.name]?.[f] != null ? (
                        <label className="ledger-field" key={f}>
                          <span className="smallcaps">{f}</span>
                          <input
                            className="num"
                            type="number"
                            inputMode="decimal"
                            step="any"
                            min="0"
                            value={draft[h.name]?.[f] ?? ''}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, [h.name]: { ...d[h.name], [f]: e.target.value } }))
                            }
                          />
                        </label>
                      ) : null,
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={resetLedger}>
                Reset all edits
              </button>
              <div className="modal-actions-right">
                <button className="btn-ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button className="btn-solid" onClick={saveLedger}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REGIME PLAYBOOK — a quadrant, expanded into concrete actions */}
      {regimeOpen &&
        (() => {
          const r = regimeList.find((x) => x.key === regimeOpen)!;
          const leg = legs.find((l) => l.key === r.favors)!;
          const gap = (TOTAL_TARGET - leg.weight) * totalValue;
          return (
            <div className="modal-overlay" onClick={() => setRegimeOpen(null)}>
              <div
                className="modal regime-modal"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
                style={{ ['--cell-color' as string]: `var(--c-${r.favors})` } as React.CSSProperties}
              >
                <div className="modal-head">
                  <div>
                    <div className="smallcaps">
                      Regime playbook · {fmtPct(r.probability)} read
                      {r.key === activeKey ? ' · active' : ''}
                    </div>
                    <h3 className="modal-title">
                      {r.name} <span className="regime-modal-favors">favors {assetMeta[r.favors].label}</span>
                    </h3>
                  </div>
                  <button className="modal-close" onClick={() => setRegimeOpen(null)} aria-label="Close">
                    ✕
                  </button>
                </div>
                <p className="modal-note">{r.description}</p>
                <div className="playbook-status">
                  <div className="smallcaps">Your book now</div>
                  <p>
                    The {assetMeta[r.favors].label} leg sits at{' '}
                    <span className="num">{fmtPct(leg.weight)}</span> vs the 25% target —{' '}
                    {Math.abs(gap) < totalValue * 0.005 ? (
                      'already on target; nothing to do.'
                    ) : (
                      <>
                        {gap >= 0 ? 'adding' : 'trimming'}{' '}
                        <span className="num">{fmtMoney(Math.abs(gap), base)}</span> would bring it to
                        target if this regime confirms.
                      </>
                    )}
                  </p>
                </div>
                <div className="smallcaps playbook-head">What to actually do</div>
                <ul className="playbook-list">
                  {r.playbook.map((step, i) => (
                    <li key={i}>
                      <span className="num playbook-idx">{i + 1}</span>
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })()}

      <footer className="colophon">
        <hr className="rule-double" />
        <div className="colophon-row">
          <div className="smallcaps">— end of edition —</div>
          <div className="smallcaps">Demo data · prices &amp; FX live · not investment advice</div>
          <div className="smallcaps">© Demo edition, {today.getFullYear()}</div>
        </div>
      </footer>
    </div>
  );
}

export default App;
