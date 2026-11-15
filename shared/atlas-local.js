/* RO'Lyfe Atlas Local Guide — deterministic on-device help; no API key or network calls. */
(() => {
  "use strict";
  if (window.ROLyfeAtlasLocal) return;
  const read = (value, fallback = "") => String(value == null ? fallback : value).trim();
  const cleanLines = value => read(value).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const classify = question => {
    const q = read(question).toLowerCase();
    if (/risk|stop|position size|sizing|shares|contracts|account size|loss limit/.test(q)) return "risk";
    if (/option|call|put|strike|premium|greek|expiration|expiry/.test(q)) return "options";
    if (/scan|scanner|momentum|signal|indicator|rsi|macd|ema|hma|vwap/.test(q)) return "scan";
    if (/quote|price|market|ticker|symbol|stock|crypto|etf/.test(q)) return "market";
    if (/calendar|earnings|event|date/.test(q)) return "calendar";
    if (/watchlist|watch list|favorites/.test(q)) return "watchlist";
    if (/journal|paper trade|trade history|realized|p&l|pnl/.test(q)) return "journal";
    if (/page|screen|button|menu|navigation|where|how do i|what does|explain|review|analy[sz]e|guided/.test(q)) return "review";
    return "general";
  };
  function respond(question, context = "", options = {}) {
    const q = read(question);
    const ctx = typeof context === "string" ? context : JSON.stringify(context || {});
    const lines = cleanLines(ctx);
    const title = read(options.pageTitle, document.title || "RO'Lyfe workspace");
    const symbol = read(options.symbol,
      localStorage.getItem("rolyfe-active-symbol") ||
      document.querySelector("#symbol,#symbol-select,#classroomSymbol,#chartSymbol,#symbolSearch")?.value ||
      "not selected");
    const localQuoteLines = lines.filter(x => /\b(price|quote|change|provider|tickerbot|finnhub|coingecko)\b/i.test(x) && x.length < 320);
    const chartLines = lines.filter(x => /chart selected|chart data|bars visible|last visible close|timeframe/i.test(x));
    const technicalLines = lines.filter(x => /technical health|score\s*\d|input coverage|ema|hma|rsi|macd|vwap|stochastic/i.test(x));
    const journalLines = lines.filter(x => /paper journal|paper trades|entry |stop |status |realized|closed|p\/l/i.test(x));
    const fundamentalLines = lines.filter(x => /company |sector |fundamental/i.test(x));
    const bodyText = read((document.querySelector("main") || document.body)?.innerText || "");
    const pageHeadings = [...document.querySelectorAll("h1,h2,h3")].map(x => read(x.innerText)).filter(Boolean).slice(0, 10);
    const pageButtons = [...document.querySelectorAll("main button, main [role=button]")].map(x => read(x.innerText || x.getAttribute("aria-label") || x.title)).filter(Boolean).slice(0, 12);
    const matchedQuote = localQuoteLines.find(x => x.toLowerCase().includes(symbol.toLowerCase())) || localQuoteLines[0];
    const mode = classify(q);
    const parts = ["ATLAS · LOCAL DESK GUIDE", "No cloud AI or API key was used. This guide works from the visible page and supplied desk data; it does not invent live market information."];
    if (mode === "risk") {
      parts.push("RISK WORKFLOW", "1. Define the entry and the price that invalidates the idea. 2. Calculate per-share risk as |entry − stop|. 3. Calculate share quantity as the allowed dollar risk ÷ per-share risk, rounded down. 4. Include fees, slippage and any gap risk before evaluating the plan.", "For options, the standard equity-contract multiplier is often 100, but the contract's actual terms must be checked. Option premium risk is not the same as the underlying stock's stop distance.");
      const riskLine = journalLines.find(x => /entry |stop |size /i.test(x));
      if (riskLine) parts.push("PAPER JOURNAL CONTEXT", riskLine);
      else parts.push("No complete entry/stop/quantity combination was supplied in the current context, so I have not calculated a dollar-risk figure.");
    } else if (mode === "options") {
      parts.push("OPTIONS WORKFLOW", "Confirm the underlying quote and its timestamp, contract type, strike, expiration, bid, ask, last and volume/open interest before evaluating a contract. Midpoint is an estimate, not a guaranteed fill. Review the spread, multiplier, breakeven, maximum gain/loss and assignment risk.", "I will not invent a live options chain or Greeks. Use the quote and contract details actually shown by the desk.");
      if (matchedQuote) parts.push("VISIBLE UNDERLYING DATA", matchedQuote);
    } else if (mode === "scan") {
      parts.push("SCANNER REVIEW", "A scan is only as reliable as its universe, provider response, data timestamp and indicator coverage. Treat a qualified row as a research lead, not an entry instruction. Open the selected symbol's chart and verify the source, timeframe, volume and invalidation level.");
      if (technicalLines.length) parts.push("VISIBLE INDICATOR CONTEXT", ...technicalLines.slice(0, 5));
      else parts.push("No scanner result or calculated indicator detail was supplied in the current context.");
    } else if (mode === "market") {
      parts.push("ACTIVE INSTRUMENT", symbol);
      if (matchedQuote) parts.push("VISIBLE QUOTE CONTEXT", matchedQuote);
      else parts.push("I cannot verify a current quote from the visible page context. Check the quote panel's source and timestamp before using a price.");
      if (chartLines.length) parts.push("CHART CONTEXT", ...chartLines.slice(0, 3));
    } else if (mode === "calendar") {
      const events = lines.filter(x => /earnings|event|expiration|economic calendar|calendar/i.test(x)).slice(0, 6);
      parts.push("CALENDAR WORKFLOW", "Check the event date, time zone, source and last-updated time. Earnings and economic events can change the risk profile; do not assume an empty calendar means there are no events.");
      if (events.length) parts.push("VISIBLE CALENDAR CONTEXT", ...events);
      else parts.push("No specific calendar event was included in the current page context.");
    } else if (mode === "watchlist") {
      parts.push("WATCHLIST WORKFLOW", "Use the global instrument selector to set the active symbol, then check that the selected engine supports that asset class. Your selection can carry across connected RO'Lyfe pages on this browser.");
      if (matchedQuote) parts.push("VISIBLE WATCHLIST DATA", matchedQuote);
    } else if (mode === "journal") {
      parts.push("PAPER JOURNAL", "The journal is a simulation record, not a brokerage statement. Review entry, stop, size, exit, fees and notes together; separate realized results from open-position estimates.");
      if (journalLines.length) parts.push("VISIBLE JOURNAL CONTEXT", ...journalLines.slice(0, 8));
      else parts.push("No paper-journal rows were supplied in the current context.");
    } else {
      parts.push("CURRENT WORKSPACE", title, "ACTIVE INSTRUMENT", symbol);
      if (matchedQuote) parts.push("VISIBLE QUOTE", matchedQuote);
      if (chartLines.length) parts.push("CHART", ...chartLines.slice(0, 2));
      if (technicalLines.length) parts.push("INDICATORS", ...technicalLines.slice(0, 3));
      parts.push("WHAT I CAN HELP WITH", "I can explain the visible controls, outline a stock-first research workflow, check the risk-planning steps, and identify which information is missing. I cannot fetch fresh prices, run a remote AI model or place trades in local mode.");
    }
    if (mode === "review") {
      if (pageHeadings.length) parts.push("PAGE SECTIONS", pageHeadings.join(" · "));
      if (pageButtons.length) parts.push("VISIBLE CONTROLS", pageButtons.join(" · "));
      if (fundamentalLines.length) parts.push("FUNDAMENTALS CONTEXT", ...fundamentalLines.slice(0, 3));
    }
    parts.push("IMPORTANT", "This is rule-based local assistance, not a generative AI model or financial advice. It uses only supplied or visible information; no brokerage orders are sent.");
    if (read(options.language, "English") !== "English") parts.push("LANGUAGE NOTE", "The interface can be translated using the page language control. Local Guide replies are currently in English; connect an approved agent later for generated multilingual answers.");
    return parts.join("\n\n");
  }
  window.ROLyfeAtlasLocal = Object.freeze({ respond, mode: "local", version: "1.0.0" });
})();