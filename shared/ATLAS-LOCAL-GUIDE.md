# RO’Lyfe Atlas Local Guide

## Purpose
Atlas Local Guide provides built-in, on-device assistance across RO’Lyfe trading workspaces without requiring an OpenAI key, a Supabase AI request, or another external agent.

## Shared scripts
- `shared/atlas-local.js` — rule-based local response engine. Exposes `window.ROLyfeAtlasLocal.respond(question, context, options)`.
- `shared/atlas-universal.js` — shared Atlas panel, Guided Review, Follow Along and browser speech input on connected engines.
- `shared/rolyfe-global-tools.js` — shared language, instrument, clock and browser speech controls.
- Personal Trading Desk `app.js` — routes its built-in Atlas panel to the local response engine.
- `sw.js` — caches the local guide as part of the Personal Desk offline app shell.

## What Local Guide can do
- Explain the visible workspace, buttons, menus and navigation.
- Use the active symbol and quote/chart/indicator context supplied by the page.
- Explain stock risk-sizing steps and the distinction between underlying-price risk and option-premium risk.
- Explain scanner, options, calendar, watchlist and paper-journal workflows.
- Follow button clicks and describe the likely next step without repeating the action.

## Limitations
Local Guide is deterministic rules-based help, not a generative AI model. It does not fetch fresh quotes, create new market analysis, retrieve options chains, run scans, access brokerage accounts or place orders. It only uses information already visible or explicitly supplied by the page. Replies are currently in English; page translation is a separate feature and may require its configured translation provider.

## External agent connection later
An existing user-owned agent can be added as an optional provider after its exact agent URL and supported embed/API interface are confirmed. Do not put API secrets in browser scripts. Keep the local guide available as the fallback.

## Verification
The scripts should parse without syntax errors. No Atlas Local Guide request calls `rol-trading-ai`, OpenAI, or Supabase. Browser speech input/output uses device capabilities and may not be available in every browser.
