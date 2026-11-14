# RO’Lyfe Personal Trading Desk

A standalone, mobile-first trading research and paper-trading workspace from RO’Lyfe.

## Live architecture

- GitHub Pages hosts the standalone web interface.
- Supabase Auth provides passwordless email sign-in.
- Market quotes, historical bars, and scanner requests run through existing RO’Lyfe Supabase Edge Functions.
- Finnhub and CoinGecko quotes, Tickerbot historical candles/scanner, and Atlas AI use server-side provider secrets.
- The browser contains only the Supabase publishable key; provider keys and Supabase secret/service-role keys remain server-side.
- Watchlists and paper-trade records are stored in browser-local storage, scoped to the signed-in user on that device.

**This is a research and paper-trading application. It does not connect to brokerage order routing and does not place trades.** No synthetic prices or fabricated candles are displayed.

## Features

- RO’Lyfe dark, responsive command-center interface
- Passwordless email sign-in
- Custom stock, ETF, and crypto watchlists (up to 20 symbols)
- Secured Finnhub stock/ETF quotes and CoinGecko mapped crypto quotes
- Multi-timeframe historical candles (5m, 15m, 1h, 4h, 1d) through the existing Tickerbot market-data route
- EMA 20, EMA 50, and SMA 200 chart overlays calculated from provider-returned closes
- Watchlist technical scanner for RSI, relative volume, MACD histogram, ADX, and VWAP context
- TradingView chart handoff for each symbol
- Risk/reward and position-size planning
- Paper-trade journal, simulated close, realized P/L, and CSV export
- Eastern Time market-session clock
- Atlas AI chat through the existing secure `rol-trading-ai` Edge Function

## Deploy with GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, select **GitHub Actions**.
3. The included workflow checks JavaScript syntax and deploys the site when changes are pushed to `main`.
4. Expected project URL: `https://rolrichman.github.io/rolyfe-personal-trading-desk/`.

## One-time Supabase Auth setup

In the existing Supabase project `ROLyfe-Trading-Intelligence-Classroom`:

1. Open **Authentication → URL Configuration**.
2. Add `https://rolrichman.github.io/rolyfe-personal-trading-desk/` to the allowed Redirect URLs.
3. Confirm email sign-in is enabled. The desk uses Supabase passwordless email links.
4. Keep JWT verification enabled on the `market-data` and `rol-trading-ai` Edge Functions.

The app uses the project's publishable key in the browser. This key is designed for public clients. Never put `service_role`, Supabase secret keys, Finnhub, Alpha Vantage, CoinGecko, Massive, Tickerbot, or OpenAI secrets in GitHub or browser code.

## Local development

Serve the repository root with a static web server. Add the local origin to Supabase Auth Redirect URLs if testing passwordless sign-in locally.

## Data limitations

- Quote freshness and symbol coverage depend on provider entitlements and exchange data permissions.
- Crypto quote mapping currently supports BTC, ETH, SOL, XRP, LINK, HYPE, AVAX, and DOGE.
- Historical chart and scanner results require the corresponding Tickerbot access configured in Supabase Edge Function Secrets; daily fallback may be available through Alpha Vantage depending on provider entitlement.
- EMA/SMA overlays are calculated from fetched OHLCV closes. They are not provider-issued recommendations.
- Watchlists and journal records do not sync between devices or browsers yet.
- Market session status is a weekday/time estimate and does not account for exchange holidays or special sessions.
- Atlas explains supplied data and trading concepts; it does not issue guaranteed predictions or place orders.
- No brokerage order routing is implemented.

## Project structure

```
index.html
styles.css
auth.css
chart.css
app.js
manifest.webmanifest
assets/rolyfe-mark.svg
.github/workflows/pages.yml
```

**RO’Lyfe — Funding. Credit. Strategy. Built for People Who Move With Purpose.**
