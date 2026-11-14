# RO’Lyfe Personal Trading Desk

A standalone, mobile-first trading research and paper-trading workspace from RO’Lyfe.

**Live market data and brokerage order routing are not included in this initial release.** The desk does not invent prices or candles. Watchlists, trade plans, and paper-trade records are stored locally in the user's browser.

## Initial features

- Dark RO’Lyfe command-center interface
- Custom stock, ETF, and crypto watchlists
- Symbol search/add/remove with persistent browser storage
- TradingView chart handoff for the selected symbol
- Risk/reward and position-size planning
- Paper-trade journal with local performance totals
- Market session clock and responsive mobile navigation
- Atlas assistant panel prepared for a future secure server-side AI connection

## Run locally

Open `index.html` in a modern browser, or serve this directory with any static web server.

## Deploy with GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, choose **GitHub Actions**.
3. The included workflow deploys the site whenever changes are pushed to `main`.

After the first successful deployment, GitHub will show the public Pages URL in Settings → Pages.

## Security and data integrity

- Do not place Finnhub, Alpha Vantage, OpenAI, Supabase service-role, or other private API keys in browser code.
- Live quotes should be added through a secure server-side endpoint or a provider-approved public client key.
- No simulated quote feed or fabricated candle data is presented as live market information.
- Local watchlists and paper-trade records remain in the browser where they were created; they are not yet synced across devices.

## Project structure

```
index.html
styles.css
app.js
manifest.webmanifest
assets/rolyfe-mark.svg
.github/workflows/pages.yml
```

## Roadmap

1. Connect a verified quote provider through a secure backend.
2. Add real multi-timeframe chart data and technical indicators.
3. Connect the RO’Lyfe Supabase project for optional account-based sync.
4. Connect Atlas through a server-side AI endpoint.
5. Add export/import, alerts, and expanded performance analytics.

**RO’Lyfe — Funding. Credit. Strategy. Built for People Who Move With Purpose.**
