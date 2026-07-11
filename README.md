# The Permanent Portfolio — Demo Edition

A public demo of a live, multi-currency dashboard for the Harry Browne
**Permanent Portfolio** (4 equal legs: equities / long bonds / gold / cash,
rebalanced at Browne's 15–35% bands).

**All holdings are dummy data** — a ¥10,000 book seeded on **1 June 2026** at
that day's real closing prices, 25% per leg:

| Leg | Holding | Entry (2026-06-01) | ¥2,500 bought |
|-----|---------|--------------------|----------------|
| Equities | Nasdaq-100 ETF (QQQ) | $742.74 | 0.4976 shares |
| Long bonds | 20y+ Treasury ETF (TLT) | $85.47 | 4.3237 shares |
| Gold | Gold account (spot GC=F) | $4,475.20/oz | 2.5684 g |
| Cash | Money-market fund | 1.50% p.a. | ¥2,500 |

Everything else is real: prices, FX (USD/GBP/EUR→CNY), spot gold, the regime
engine and the news wire all pull live data — the same logic as a real book.

## Features

- **Live re-pricing** — equities from `shares × quote`, gold from spot,
  totals converted at live FX; base-currency switcher (CNY/USD/GBP/EUR).
- **Wealth change** (Today / MTD / YTD) marked at reference prices + FX,
  entry-date aware; cash accrues its stated rate daily.
- **Entry gauges** — each leg vs its 52-week range and 200-day mean:
  is now a good time to buy?
- **Regime engine** — Browne's four climates scored heuristically from live
  macro signals (illustrative, not a forecast), each with a playbook.
- **In-app ledger** — edit or add holdings; saved to `localStorage` only.
- Installable as a PWA; two themes (Rose / Evening).

## Stack

Vite + React + TypeScript, deployed on **Cloudflare Pages**. Three edge
functions under `functions/api/` proxy Yahoo Finance (keyless): `quote`
(prices + FX + gold), `history` (period reference prices), `market`
(regime signals + CNBC RSS).

## Run it

```bash
npm install
npm run dev        # UI with offline fallback data (no edge functions locally)

npm run build
npx wrangler pages dev dist   # full preview WITH live prices
```

See [DEPLOY.md](DEPLOY.md) to put it on Cloudflare Pages.

> Research/demo only — not investment advice.
