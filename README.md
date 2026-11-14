# RO’Lyfe Personal Trading Desk

A standalone, mobile-first trading research and paper-trading workspace from RO’Lyfe.

## Live architecture

- GitHub Pages hosts the standalone web interface.
- Supabase Auth uses passwordless email sign-in.
- Market quotes are requested through the existing RO’Lyfe Supabase Edge Function `market-data`.
- Provider credentials stay in Supabase Edge Function Secrets; the browser contains only the Supabase publishable key.
- Finnhub supplies supported stock/ETF quotes; CoinGecko supplies the mapped crypto quotes.
- Watchlists and paper-trade records are stored in browser-local storage, scoped to the signed-in user on that device.

**This is a research and paper-trading application. It does not connect to brokerage order routing and does not place trades.** No synthetic prices or fabricated candles are displayed.

## Features

- RO’Lyfe dark, responsive command-center interface
- Passwordless email sign-in
- Custom stock, ETF, and crypto watchlists (up to 20 symbols)
- Secured market quote requests with manual refresh and 60-second refresh cadence
- TradingView chart handoff for each symbol
- Risk/reward and position-size planning
- Paper-trade journal, simulated close, realized P/L, and CSV export
- Eastern Time market-session clock
- Atlas assistant panel prepared for a future secure AI connection

## Deploy with GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, select **GitHub Actions**.
3. The included workflow deploys the site when changes are pushed to `main`.
4. The expected project URL is `https://rolrichman.github.io/rolyfe-personal-trading-desk/`.

## One-time Supabase Auth setup

In the existing Supabase project `ROLyfe-Trading-Intelligence-Classroom`:

1. Open **Authentication → URL Configuration**.
2. Add `https://rolrichman.github.io/rolyfe-personal-trading-desk/` to the allowed Redirect URLs.
3. Confirm email sign-in is enabled. The desk uses Supabase passwordless email links.
4. Keep the existing `market-data` Edge Function JWT verification enabled.

The app uses the project's publishable key in the browser. This key is designed for public clients. Never put `service_role`, Supabase secret keys, Finnhub, Alpha Vantage, CoinGecko, Massive, Tickerbot, or OpenAI secrets in GitHub or browser code.

## Local development

Serve the repository root with a static web server. Add the local origin to Supabase Auth Redirect URLs if testing passwordless sign-in locally.

## Data limitations

- Stock quote coverage and freshness depend on Finnhub plan entitlements.
- Crypto quote mapping currently supports BTC, ETH, SOL, XRP, LINK, HYPE, AVAX, and DOGE.
- The quote service's existing Edge Function supports additional providers and historical bars; chart candles and technical indicators are the next integration phase.
- Browser-local data does not sync between devices or browsers yet.
- Market session status is a weekday/time estimate and does not account for exchange holidays or special sessions.
- No brokerage order routing is implemented.

## Project structure

```
index.html
styles.css
auth.css
app.js
manifest.webmanifest
assets/rolyfe-mark.svg
.github/workflows/pages.yml
```

**RO’Lyfe — Funding. Credit. Strategy. Built for People Who Move With Purpose.**
