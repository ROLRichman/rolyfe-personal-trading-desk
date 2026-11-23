# RO’Lyfe Personal Trading Desk — Continuity Backup

**Status:** DEMO / PREVIEW — the app is not yet verified end-to-end on the user's Android device.
**Last updated:** 2026-11-23
**Purpose:** Preserve the project's goals, decisions, current status, pending work, and testing requirements so work can resume without relying on a single chat thread.

> This file is a project-context backup, not a full source-code backup or an export of every chat message. The repository's Git history preserves code changes; this file preserves important working context. Update it as milestones and decisions change.

## Project identity
- Repository: https://github.com/ROLRichman/rolyfe-personal-trading-desk
- Live Pages site: https://rolrichman.github.io/rolyfe-personal-trading-desk/
- Project: standalone, mobile-first trading research and paper-trading desk.
- No brokerage order routing or live order execution.
- User works primarily from Android mobile and has not yet verified the recent features on-device.

## Working rules
1. Always label demos, mockups, simulations, previews, and unverified builds prominently: **DEMO / PREVIEW — NOT YET VERIFIED**.
2. Do not equate rendering with working functionality. Report what was actually tested and what remains unverified.
3. Functionality-first: investigate and repair existing buttons, menus, charts, scanners, planners, journals, replay and overlays before adding new features.
4. Focus on mobile-first validation, particularly Android. Do not claim device testing unless actually performed.
5. Atlas must have useful core functionality without a valid OpenAI key; OpenAI may remain an optional advanced engine. Atlas is not allowed to execute trades or have unrestricted authority.
6. No invented candles or quote data; clearly label simulations and fallback data.

## Recent merged work (conversation-reported)
- PR #15 merged: historical Future Bars/replay learning, saved notebook, options learning mode. Commit: 4ccdb07f9d1cad3706f7c3c383cad787a7fe98b9.
- PR #16 merged: chart crosshair, five glow themes, OHLC readout. Merge commit: 1243baff05f3b85dc327b7c2e461484b27df1e8b.
- PR #16 CI was reported passing on corrected head commit 060561def94fd5910e74e019de0d14cbe9be66bd. Pages deployment completion was not verified at last check.
- These features have not been verified in real Android touch testing.

## Current audit / requested work
### Chart and touch interaction
- Verify touch crosshair, drag/pan, pinch zoom, candle selection, price and OHLC readouts on Android.
- Ensure chart interaction does not freeze or trap the page scroll; make mobile controls usable.
- Verify overlays, entry/stop/target placement and precision price interaction.

### Risk and position sizing
- Flexible stop distances including custom presets and wider stops (up to 20% or beyond when appropriate).
- Wider stop distance must not automatically increase account risk; position sizing must scale to the defined risk budget.
- Validate formulas and displayed values against hand-calculated examples.

### Indicators and calculations
- Audit and verify rendering, calculation and toggling for EMA 5/10/20/40/50/200, HMA32, VWAP, RSI14, MACD 12/26/9, Stochastic, and RL Pullback.
- Verify data alignment across timeframe/session, replay/look-ahead handling, and toggle state.
- Indicator paths/lines must actually render, not merely appear as menu labels.

### Themes
- Five or more chart themes with color/glow; ensure contrast, readability and mobile performance.

### Atlas
- Core/contextual assistant should function independently of rejected/missing provider API keys.
- Understand selected workspace, symbol, timeframe, candles, planner/chart state, controls, toggles and relevant context.
- No trade execution, and no unrestricted authority.

### Functionality testing
- Test buttons, dropdowns, scanner, planner, journal, replay/Future Bars, chart controls and overlays end-to-end.
- Clearly identify any simulated, placeholder, or non-working feature.

## Status matrix (last reported, not device-verified)
| Area | Last known status |
|---|---|
| Quotes/market data | Some data reported loading; completeness/freshness not fully verified |
| Watchlists | Partially functional / needs end-to-end verification |
| Chart candles | Loaded in prior view; touch and controls unverified |
| Crosshair/pinch/zoom/pan | Unverified on Android |
| Indicator rendering/calculations | Not fully verified; user reported indicators/features not working |
| RL Pullback | Inputs visible; calculations and outputs unverified |
| Risk/position sizing | Unverified end-to-end |
| Future Bars/replay | Feature merged; on-device test pending |
| Atlas | Provider key rejected; core offline/independent behavior needs repair/verification |
| Scanner | Unverified |
| Planner/journal | Unverified end-to-end |
| GitHub Pages deployment | Last completion status not verified |

## Backup expectations
- This continuity file should be updated when major decisions, merges, repairs, test outcomes, or unresolved issues change.
- Git commit history is version history but is not, by itself, an independent backup.
- A durable external mirror or separate backup destination still needs setup and a successful verification run. Do not claim automatic external backup is active until verified.
- GitHub Actions artifacts alone are not a durable backup because they can expire.

## Next priorities
1. Establish and verify an independent repository backup strategy.
2. Functionality-first audit and focused repairs of mobile chart interactions and existing controls.
3. Audit indicators and risk calculations against reference values.
4. Restore useful Atlas core functionality without relying on a provider API key.
5. Confirm deployment, then have the user test on Android and report concrete failures.
6. Update this backup file after each meaningful milestone.

## Update log
- 2026-11-23: Initial continuity backup created to preserve current project scope, decisions, merge history, test status, and priorities.