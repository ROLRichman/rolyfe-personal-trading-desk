# RO'Lyfe Personal Trading Desk — Upgrade Roadmap

## Non-negotiable preservation rules
- Preserve the current trading screen, pricing, scanner, charts, quote/execution planning, indicators, market library, speed, and paper-mode safeguards.
- Do not replace provider-backed quotes or candles with synthetic data.
- Do not add brokerage order routing.
- Atlas must adapt to the desk, never cover the chart, quote, scanner, or execution controls.
- Mobile portrait and landscape must not create horizontal page overflow.

## Delivery order
1. Preserve the current machine and regression-test pricing, scanners, charts, and execution planning.
2. Fix Atlas visibility and mobile positioning. Expanded Atlas becomes a contained full-screen mobile workspace; the active-instrument floater is temporarily hidden while Atlas is open and remains available when Atlas closes.
3. Add Talk to Atlas and Execute with AI controls. This first pass uses browser speech recognition/speech synthesis where supported and falls back to keyboard input when voice APIs are unavailable.
4. Add Follow Along. It explains the desk control the user clicked; it does not autonomously click controls or place orders.
5. Extend Atlas Universal through the existing `rol-trading-ai` Supabase function and existing verified desk context. Keep secrets server-side.
6. Integrate Jotform only for suitable business/intake workflows; it is not the trading AI brain.
7. Add the RO'Lyfe Laboratory project launcher with verified links to existing RO'Lyfe projects.
8. Add a visually distinct Trading Classroom connected to the shared intelligence layer.
9. Add supported casting/screen-sharing and presentation mode, with browser/device compatibility fallbacks.
10. Add offline PWA caching, local-first saved data and later synchronization. Clearly mark quotes, scanners, cloud AI, and provider services unavailable offline. Evaluate a separate local AI host only after hardware and model requirements are established.

## Current PR scope
- Atlas panel layering and mobile containment.
- Voice input/output controls with browser capability checks.
- Execute with AI sends an analysis request using the current selected instrument and existing desk context.
- Follow Along explains the control clicked; it never executes the clicked action.
- Existing chart, quote, scanner and trading calculations are not modified.
