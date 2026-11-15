# RO’Lyfe Personal Trading Desk

A standalone, mobile-first trading research and paper-trading workspace from RO’Lyfe.

## Live architecture

- GitHub Pages hosts the standalone web interface.
- Supabase Auth provides passwordless email sign-in.
- Market quotes, historical bars, and scanner requests run through existing RO’Lyfe Supabase Edge Functions.
- Finnhub and CoinGecko quotes, Tickerbot historical candles/scanner, and Atlas AI use server-side provider secrets.
- The browser contains only the Supabase publishable key; provider keys and Supabase secret/service-role keys remain server-side.
- Watchlists, paper-trade records, and manual calendar events sync to Supabase under the signed-in user's account. Row Level Security isolates each account's data.

**This is a research and paper-trading application. It does not connect to brokerage order routing and does not place trades.** No synthetic prices or fabricated candles are displayed.

## Offline readiness

- Installable PWA with a service worker that caches the app shell, core local assets, and successfully fetched ESM runtime modules.
- When the device loses connectivity, the cached shell can reopen and the toolbar reports OFFLINE mode.
- Offline mode is not a live trading mode: fresh quotes, scanners, historical-data requests, Supabase authentication/sync, AI answers, and third-party chart embeds require an internet connection.
- Open the desk while online after the service worker update, then reload it once while still online so the service worker can cache the application shell and runtime modules. On Android, use the browser menu's **Install app** or **Add to Home screen** option.
- A battery backup / UPS or mobile hotspot can extend access during outages; an API key alone cannot provide internet or run a cloud AI service offline.

## Features

- RO’Lyfe dark, responsive command-center interface
- Passwordless email sign-in
- Personal stock, ETF, and crypto favorites (up to 20 symbols), plus a searchable RTIC market library of 69 stocks, 7 ETFs, and 50 crypto pairs (126 total)
- Secured Finnhub stock/ETF quotes and CoinGecko mapped crypto quotes
- Multi-timeframe historical candles (1m, 5m, 15m, 30m, 1h, 2h, 4h, 1d, 1w, 1mo) through the existing Tickerbot market-data route
- EMA 5/10/20/40/50/200, HMA 32, and volume-aware VWAP overlays; RSI 14, MACD 12/26/9, and Stochastic 14/3 panels calculated from provider-returned candles
- Technical scanner for My Watchlist, all 126 RTIC library symbols, stocks/ETFs, ETFs only, or crypto; results include RSI, relative volume, MACD histogram, ADX, and VWAP context
- TradingView chart handoff for each symbol
- Candlestick, Heikin-Ashi, and line chart styles; 200-bar default viewport, direct drag-to-pan, mouse-wheel and two-finger pinch zoom, collapsible indicator controls, chart PNG snapshots, and historical bar-by-bar replay with adjustable playback speed
- Optional independent second study chart with its own market-library symbol, timeframe, chart style, and EMA 20/50 overlays; changing it never changes the primary chart symbol
- Optional Scanner Directory with the Sector Scanner + Chart Lab and Tactical RTIC scanner available in separate tabs or embedded panels
- A per-symbol technical health gauge (EMA alignment, RSI, MACD, VWAP, relative volume) with input coverage shown; not a market-wide breadth index or prediction
- Company description and quarterly/annual cash-flow panel through a secured Alpha Vantage fundamentals route, including operating cash flow, CAPEX, and calculated free cash flow, plus CSV export
- Risk/reward and position-size planning for shares and ETFs
- Personal Execution options-chain snapshots through the secured Massive route, with contract identifiers, bid/ask/mid/last, IV, open interest, and provider quote timestamps
- Per-contract ask-side quote math for every fresh option row: one-contract debit, premium stop/target, planned stop risk, full-premium maximum loss, target profit, risk/reward, and whole-contract capital/risk limit. Recalculates when the user's stop, target, capital, or risk budget changes.
- Options paper execution with buy-to-open / sell-to-close only, whole-contract sizing, premium stop levels (1%, 2%, 5%, 7%, 10%, 15%, 20%, custom), target reward, risk budget, full-premium maximum loss, compounding P/L, private options journal, and downloadable reports
- Option entries plotted on the underlying price chart from the stored underlying quote
- Paper-trade journal, simulated close, realized P/L, and CSV export
- Personal trading calendar for earnings, economic dates, options expirations, and reminders (manual entry)
- Eastern Time market-session clock
- Atlas AI chat through the existing secure `rol-trading-ai` Edge Function, with a Jotform opt-in link for the launch email and separate optional SMS consent

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
- Historical chart and scanner results require the corresponding Tickerbot access configured in Supabase Edge Function Secrets; daily/weekly/monthly fallback may be available through Alpha Vantage depending on provider entitlement. Chart requests load up to 1,000 candles per provider page; the default viewport shows 200, and direct zoom can display up to 500 at a time while dragging pans across the loaded page. Deeper paging is not yet implemented.
- EMA, HMA, VWAP, RSI, MACD, and Stochastic are locally calculated from provider-returned OHLCV bars. VWAP is omitted when volume is unavailable; intraday VWAP resets by session date, while daily/weekly/monthly VWAP is cumulative over the loaded window.
- Desk data syncs across devices when the same verified account signs in. Browser storage remains a local fallback; a failed cloud read/save is shown in the desk status.
- Market session status is a weekday/time estimate and does not account for exchange holidays or special sessions.
- Atlas explains supplied data and trading concepts; it does not issue guaranteed predictions or place orders.
- Options snapshot availability requires an eligible Massive subscription and the `ROLYFE_RTIC_MARKET_INTELLIGENCE` secret in Supabase Edge Function Secrets. A missing or stale bid/ask quote is not replaced by a guessed premium.
- Options paper calculations use the contract multiplier returned by the provider (defaulting to 100 only when the provider omits it), and distinguish planned stop risk from the full premium-at-risk maximum loss. Stops can gap; simulated stop prices are not guaranteed.
- Options short opening and live brokerage order routing are not implemented.
- Company fundamentals require `ALPHA_VANTAGE_API_KEY` in Supabase Edge Function Secrets and the corresponding Alpha Vantage API entitlements. If overview or cash-flow endpoints are unavailable, the panel reports the provider limitation instead of inventing financials.
- The technical health gauge is a transparent weighted score of the selected symbol's loaded candles: price/EMA20 (20%), EMA20/EMA50 alignment (20%), price/EMA200 (15%), RSI (15%), MACD histogram (15%), VWAP (10%), and last-bar volume versus prior 20-bar average (5%). Missing inputs are excluded and displayed as reduced coverage. It is a technical context aid, not a prediction or a market-wide index.
- Historical replay reveals only candles up to the selected replay point, suppresses future-dated option entry markers, and withholds live quotes, later journal trades, and current fundamentals from Atlas while replay is active. Chart PNG and fundamentals CSV exports use the data currently rendered/loaded.

## Project structure

```
index.html
styles.css
auth.css
chart.css
app.js
execution.js
execution.css
options-math.js
market-metrics.js
tests/options-math.test.mjs
tests/market-metrics.test.mjs
manifest.webmanifest
assets/rolyfe-mark.svg
.github/workflows/pages.yml
```

**RO’Lyfe — Funding. Credit. Strategy. Built for People Who Move With Purpose.**
