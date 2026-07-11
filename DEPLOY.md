# Deploying the demo — public, live, multi-device

This app is a static site + three edge functions (`/api/quote`, `/api/history`,
`/api/market`) that fetch live prices, FX and news. Hosting on **Cloudflare
Pages** gives you a public URL that works on every device — no login, since
the data is dummy.

## 1. Connect the repo to Cloudflare Pages

1. Go to **dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git**.
2. Pick the `permanent-portfolio-demo` repo.
3. Build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. **Save and Deploy.** You get a URL like `permanent-portfolio-demo.pages.dev`.

The functions under `/functions/api/` deploy automatically — no extra step.
Prices then update live on every page load (cached a few minutes at the edge).

> Tip: install the site as an app on your phone (Safari/Chrome → "Add to Home
> Screen") for a one-tap, full-screen dashboard.

Note: `package-lock.json` is gitignored on purpose — Vite/rolldown native
bindings drift across npm versions and break Cloudflare's `npm ci`; without a
lockfile Pages falls back to `npm install`.

## Local development

```bash
npm run dev            # Vite only — offline fallback prices (no /api functions)
npm run build
npx wrangler pages dev dist   # full preview WITH the live price functions
```

## Changing the demo book

Edit `holdings[]` in `src/data.ts`: set `shares` / `grams` / `value`, `cost`,
`currency`, `since` and `yahooSymbol` per position. Prices come from the live
feed. Commit + push and Pages redeploys automatically. You can also edit
holdings in-app (✎ Ledger) — those changes stay in your browser only.
