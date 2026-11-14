import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.0";
import { MARKET_LIBRARY, marketSector, marketSectorGroups } from "./market-library.js";

(() => {
  const SUPABASE_URL = "https://ykmdyfbklvuoseqdjnxy.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_FaJPNdtRsZTemxpbp98F2g_U9ngkFaG";
  const MARKET_DATA_URL = SUPABASE_URL + "/functions/v1/market-data";
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const $ = id => document.getElementById(id);
  const library = [...MARKET_LIBRARY.stocks, ...MARKET_LIBRARY.crypto];
  const libraryBySymbol = new Map(library.map(item => [item.symbol, item]));
  const money = value => Number.isFinite(Number(value)) && Number(value) > 0
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(Number(value))
    : "—";
  const safe = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  let session = null;
  let activeSymbol = "";
  let activeItem = null;
  let activeQuote = null;
  let quoteSequence = 0;

  function allItems() {
    const items = new Map(libraryBySymbol);
    const chartSelect = $("chartSymbol");
    for (const option of chartSelect?.options || []) {
      const symbol = String(option.value || "").trim().toUpperCase();
      if (!symbol || items.has(symbol)) continue;
      const label = option.textContent || symbol;
      const type = /Crypto/i.test(label) ? "Crypto" : /ETF/i.test(label) ? "ETF" : "Stock";
      const name = label.split(" · ").slice(1, 2)[0] || symbol;
      items.set(symbol, { symbol, name, type });
    }
    return [...items.values()];
  }

  function groupedOptions(items, placeholder, selected = "") {
    const groups = marketSectorGroups(items);
    const prompt = placeholder ? '<option value="">' + safe(placeholder) + '</option>' : "";
    const html = groups.map(group => {
      const options = group.items.map(item => {
        const visible = item.displaySymbol || item.symbol;
        return '<option value="' + safe(item.symbol) + '">' + safe(visible) + ' · ' + safe(item.name || item.symbol) + ' · ' + safe(item.type) + '</option>';
      }).join("");
      return '<optgroup label="' + safe(group.sector) + ' · ' + group.items.length + '">' + options + '</optgroup>';
    }).join("");
    return prompt + html;
  }

  function populateSymbolControls() {
    const items = allItems();
    const plan = $("planSymbol");
    if (plan) {
      const previous = plan.value || activeSymbol;
      plan.innerHTML = groupedOptions(items, "Select from all market sectors", previous);
      if (previous && [...plan.options].some(option => option.value === previous)) plan.value = previous;
    }
    const event = $("eventSymbol");
    if (event) {
      const previous = event.value;
      event.innerHTML = '<option value="">No symbol linked</option>' + groupedOptions(items, "", previous);
      if (previous && [...event.options].some(option => option.value === previous)) event.value = previous;
    }
    const libraryFilter = $("marketLibraryFilter");
    if (libraryFilter) {
      const previous = libraryFilter.value;
      libraryFilter.innerHTML = '<option value="all">All instruments · sectors</option><option value="Stock">Stocks only</option><option value="ETF">ETFs only</option><option value="Crypto">Crypto only</option>' +
        marketSectorGroups(items).map(group => '<option value="sector:' + safe(group.sector) + '">' + safe(group.sector) + ' · ' + group.items.length + '</option>').join("");
      libraryFilter.value = [...libraryFilter.options].some(option => option.value === previous) ? previous : "all";
    }
    const scanner = $("scanAsset");
    if (scanner && !scanner.dataset.sectorsAdded) {
      scanner.insertAdjacentHTML("beforeend", '<optgroup label="SCAN BY SECTOR">' +
        marketSectorGroups(library).map(group => '<option value="sector:' + safe(group.sector) + '">' + safe(group.sector) + ' · ' + group.items.length + '</option>').join("") +
        '</optgroup>');
      scanner.dataset.sectorsAdded = "true";
    }
    renderInstrumentOptions();
  }

  function renderInstrumentOptions(query = "") {
    const select = $("instrumentSelect");
    if (!select) return;
    const current = activeSymbol || select.value;
    const needle = String(query || "").trim().toLowerCase();
    const items = allItems().filter(item => {
      const sector = marketSector(item);
      return !needle || [item.symbol, item.displaySymbol, item.name, item.type, sector]
        .some(value => String(value || "").toLowerCase().includes(needle));
    });
    select.innerHTML = groupedOptions(items, "Choose stock, ETF or crypto", current);
    if (current && [...select.options].some(option => option.value === current)) select.value = current;
  }

  function timestampLabel(value) {
    if (value === null || value === undefined || value === "") return "Provider timestamp not supplied";
    let ms;
    if (typeof value === "string" && !/^\d+$/.test(value)) {
      ms = Date.parse(value);
    } else {
      let n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return "Provider timestamp not supplied";
      if (n > 1e17) n /= 1e6;
      else if (n > 1e14) n /= 1e3;
      else if (n <= 1e11) n *= 1000;
      ms = n;
    }
    return Number.isFinite(ms) ? new Date(ms).toLocaleString() : "Provider timestamp not supplied";
  }

  function tickerbotSymbol(item) {
    if (item.type !== "Crypto") return item.symbol;
    const base = String(item.api || item.symbol || "").toUpperCase()
      .replace(/-USD$/, "").replace(/^X:/, "").replace(/USD$/, "");
    return base ? "X:" + base + "USD" : item.symbol;
  }

  async function requestProvider(provider, symbol) {
    const url = MARKET_DATA_URL + "?provider=" + encodeURIComponent(provider) + "&symbol=" + encodeURIComponent(symbol);
    const active = session || (await supabase.auth.getSession()).data?.session;
    session = active || null;
    if (!active?.access_token) throw new Error("Sign in to retrieve a verified provider quote.");
    const response = await fetch(url, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + active.access_token, Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || provider + " returned HTTP " + response.status);
    return payload;
  }

  function quoteFromTickerbot(payload, item) {
    const row = payload?.data && !Array.isArray(payload.data) ? payload.data : null;
    const price = Number(row?.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    return {
      price,
      changePercent: Number.isFinite(Number(row.change_1d_pct)) ? Number(row.change_1d_pct) : null,
      high: Number.isFinite(Number(row.high)) ? Number(row.high) : null,
      low: Number.isFinite(Number(row.low)) ? Number(row.low) : null,
      bid: null, ask: null,
      provider: payload.provider || "tickerbot",
      timestamp: payload.asOf || null,
      note: "Tickerbot provider row. Bid/ask is not part of this response."
    };
  }

  async function fetchInstrumentQuote(item) {
    const sequence = ++quoteSequence;
    activeQuote = null;
    $("instrumentPrice").textContent = "Loading…";
    $("instrumentChange").textContent = "Requesting provider snapshot";
    $("instrumentBidAsk").textContent = "Bid — · Ask —";
    $("instrumentQuoteMeta").textContent = "Checking connected market-data providers";
    $("instrumentHigh").textContent = "—";
    $("instrumentLow").textContent = "—";
    $("instrumentQuoteNote").textContent = "No estimated or synthetic quote values are displayed.";
    try {
      let quote = null;
      const normalized = tickerbotSymbol(item);
      if (item.type === "Crypto") {
        try {
          const payload = await requestProvider("tickerbot-row", normalized);
          quote = quoteFromTickerbot(payload, item);
        } catch {}
        if (!quote) {
          try {
            const payload = await requestProvider("coingecko", item.symbol);
            quote = {
              price: Number(payload.price),
              changePercent: Number.isFinite(Number(payload.changePercent24h)) ? Number(payload.changePercent24h) : null,
              high: null, low: null, bid: null, ask: null,
              provider: payload.provider || "coingecko",
              timestamp: payload.lastUpdatedAt || null,
              note: payload.note || "CoinGecko spot snapshot. Venue bid/ask is not supplied by this endpoint."
            };
          } catch {}
        }
      } else {
        try {
          const payload = await requestProvider("massive-stock-snapshot", item.symbol);
          quote = {
            price: Number(payload.price),
            changePercent: Number.isFinite(Number(payload.changePercent)) ? Number(payload.changePercent) : null,
            high: Number.isFinite(Number(payload.high)) ? Number(payload.high) : null,
            low: Number.isFinite(Number(payload.low)) ? Number(payload.low) : null,
            bid: Number.isFinite(Number(payload.bid)) && Number(payload.bid) > 0 ? Number(payload.bid) : null,
            ask: Number.isFinite(Number(payload.ask)) && Number(payload.ask) > 0 ? Number(payload.ask) : null,
            provider: payload.provider || "massive",
            timestamp: payload.timestamp || null,
            note: payload.note || "Massive stock snapshot."
          };
          if (!Number.isFinite(quote.price) || quote.price <= 0) quote = null;
        } catch {}
        if (!quote) {
          try {
            const payload = await requestProvider("finnhub", item.symbol);
            quote = {
              price: Number(payload.price),
              changePercent: Number.isFinite(Number(payload.changePercent)) ? Number(payload.changePercent) : null,
              high: Number.isFinite(Number(payload.high)) ? Number(payload.high) : null,
              low: Number.isFinite(Number(payload.low)) ? Number(payload.low) : null,
              bid: null, ask: null,
              provider: payload.provider || "finnhub",
              timestamp: payload.timestamp || null,
              note: payload.note || "Finnhub quote. Bid/ask is not supplied by this endpoint."
            };
            if (!Number.isFinite(quote.price) || quote.price <= 0) quote = null;
          } catch {}
        }
        if (!quote) {
          try { quote = quoteFromTickerbot(await requestProvider("tickerbot-row", normalized), item); } catch {}
        }
      }
      if (sequence !== quoteSequence || item.symbol !== activeSymbol) return;
      if (!quote || !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0) {
        $("instrumentPrice").textContent = "Unavailable";
        $("instrumentChange").textContent = "No verified quote returned";
        $("instrumentQuoteMeta").textContent = "Provider access, symbol coverage or plan entitlement may limit this request.";
        $("instrumentQuoteNote").textContent = "No quote was substituted. Try another provider-enabled instrument or refresh later.";
        return;
      }
      activeQuote = quote;
      $("instrumentPrice").textContent = money(quote.price);
      $("instrumentChange").textContent = quote.changePercent === null ? "Daily change unavailable" :
        (quote.changePercent > 0 ? "+" : "") + Number(quote.changePercent).toFixed(2) + "% · 1 day";
      $("instrumentBidAsk").textContent = quote.bid && quote.ask
        ? "Bid " + money(quote.bid) + " · Ask " + money(quote.ask)
        : item.type === "Crypto" ? "Spot quote · Bid/ask unavailable" : "Bid — · Ask —";
      $("instrumentQuoteMeta").textContent = (quote.provider || "Provider") + " · " + timestampLabel(quote.timestamp);
      $("instrumentHigh").textContent = money(quote.high);
      $("instrumentLow").textContent = money(quote.low);
      $("instrumentQuoteNote").textContent = item.type === "Crypto"
        ? "Crypto reference uses a provider spot snapshot. This feed does not supply a venue-level executable bid/ask or route orders."
        : quote.bid && quote.ask
          ? "Provider bid/ask is shown where returned. A limit price is a planning reference; no brokerage order is routed."
          : "Last-price snapshot only. This provider response did not include bid/ask; do not treat last price as an executable quote.";
      const limit = $("instrumentLimitPrice");
      if (limit && !limit.value) limit.value = String(quote.price);
      if ($("entryPrice") && !String($("entryPrice").value).trim()) $("entryPrice").value = String(quote.price);
      document.dispatchEvent(new CustomEvent("rolyfe:instrument-quote", {
        detail: { symbol: item.symbol, item, quote }
      }));
    } catch (error) {
      if (sequence !== quoteSequence) return;
      $("instrumentPrice").textContent = "Unavailable";
      $("instrumentChange").textContent = error.message || "Quote request failed";
      $("instrumentQuoteMeta").textContent = "Provider quote not confirmed";
    }
  }

  function activateInstrument(symbol, source = "dock", shouldLoadChart = true) {
    const next = String(symbol || "").trim().toUpperCase();
    if (!next) return;
    const item = allItems().find(candidate => candidate.symbol === next) || { symbol: next, name: next, type: "Stock" };
    const changed = next !== activeSymbol;
    activeSymbol = next;
    activeItem = item;
    $("instrumentSelect").value = next;
    $("instrumentDockSector").textContent = marketSector(item) + " · " + item.type;
    const plan = $("planSymbol");
    if (plan && [...plan.options].some(option => option.value === next)) plan.value = next;
    const chart = $("chartSymbol");
    if (chart && chart.value !== next && [...chart.options].some(option => option.value === next)) {
      chart.value = next;
      if (shouldLoadChart) chart.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (chart && chart.value === next && shouldLoadChart && changed) {
      chart.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (changed) {
      $("instrumentLimitPrice").value = "";
      fetchInstrumentQuote(item);
    }
    document.dispatchEvent(new CustomEvent("rolyfe:instrument-change", {
      detail: { symbol: next, item, source, changed }
    }));
  }

  function syncFromChart() {
    const symbol = String($("chartSymbol")?.value || "").trim().toUpperCase();
    if (symbol) activateInstrument(symbol, "chart", false);
  }

  function go(view) {
    const nav = document.querySelector('[data-view="' + view + '"]');
    if (nav) nav.click();
  }

  $("instrumentSelect").addEventListener("change", () => {
    const symbol = $("instrumentSelect").value;
    if (!symbol) return;
    $("instrumentSearch").value = "";
    renderInstrumentOptions();
    activateInstrument(symbol, "floating-picker", true);
  });
  $("instrumentSearch").addEventListener("input", () => renderInstrumentOptions($("instrumentSearch").value));
  $("instrumentSearch").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      const first = [...$("instrumentSelect").options].find(option => option.value);
      if (first) {
        $("instrumentSelect").value = first.value;
        $("instrumentSearch").value = "";
        renderInstrumentOptions();
        activateInstrument(first.value, "floating-search", true);
      }
    }
  });
  $("chartSymbol")?.addEventListener("change", syncFromChart);
  $("planSymbol")?.addEventListener("change", () => {
    if ($("planSymbol").value) activateInstrument($("planSymbol").value, "trade-planner", true);
  });
  $("eventSymbol")?.addEventListener("change", () => {
    if ($("eventSymbol").value) activateInstrument($("eventSymbol").value, "calendar", true);
  });
  $("instrumentUseQuote").addEventListener("click", () => {
    if (!activeQuote) return;
    const side = $("instrumentOrderSide")?.value || "buy";
    const sidePrice = side === "buy" ? activeQuote.ask : activeQuote.bid;
    const value = Number(sidePrice) > 0 ? Number(sidePrice) : Number(activeQuote.price);
    $("instrumentLimitPrice").value = String(value);
    $("instrumentQuoteNote").textContent = Number(sidePrice) > 0
      ? "Reference limit copied from provider " + (side === "buy" ? "ask" : "bid") + ". This does not send an order."
      : "No provider bid/ask was returned. Last price copied as a reference only, not as an executable quote.";
  });
  $("instrumentUsePlanner").addEventListener("click", () => {
    if (!activeItem) return;
    const symbol = $("planSymbol");
    const entry = $("entryPrice");
    if (symbol && [...symbol.options].some(option => option.value === activeSymbol)) symbol.value = activeSymbol;
    const price = Number($("instrumentLimitPrice").value) || Number(activeQuote?.price);
    if (entry && price > 0) entry.value = String(price);
    go("planner");
  });
  $("instrumentOpenChart").addEventListener("click", () => {
    if (!activeSymbol) return;
    const chart = $("chartSymbol");
    if (chart && [...chart.options].some(option => option.value === activeSymbol)) {
      chart.value = activeSymbol;
      chart.dispatchEvent(new Event("change", { bubbles: true }));
    }
    go("markets");
    $("primaryChartPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("instrumentOpenExecution").addEventListener("click", () => go("execution"));
  $("instrumentDockToggle").addEventListener("click", () => {
    const dock = $("instrumentDock");
    const collapsed = dock.classList.toggle("is-collapsed");
    $("instrumentDockDetails").hidden = collapsed;
    $("instrumentDockToggle").textContent = collapsed ? "+" : "−";
    $("instrumentDockToggle").setAttribute("aria-label", collapsed ? "Expand instrument dock" : "Collapse instrument dock");
  });

  document.addEventListener("rolyfe:symbols-ready", () => {
    populateSymbolControls();
    if (!activeSymbol && $("chartSymbol")?.value) syncFromChart();
  });
  document.addEventListener("rolyfe:instrument-change", event => {
    const item = event.detail?.item;
    if (!item) return;
    const plan = $("planSymbol");
    if (plan && [...plan.options].some(option => option.value === item.symbol)) plan.value = item.symbol;
    if ($("instrumentDock").hidden === false && ![...$("instrumentSelect").options].some(option => option.value === item.symbol)) {
      renderInstrumentOptions();
      $("instrumentSelect").value = item.symbol;
    }
  });

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    session = nextSession;
    $("instrumentDock").hidden = !Boolean(nextSession?.user?.id);
  });
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) return;
    session = data?.session || null;
    $("instrumentDock").hidden = !Boolean(session?.user?.id);
    populateSymbolControls();
    if ($("chartSymbol")?.value) syncFromChart();
  }).catch(() => {
    $("instrumentDock").hidden = true;
  });

  $("instrumentDock").hidden = true;
  populateSymbolControls();
  setInterval(() => {
    if (activeItem && !$("instrumentDock").hidden) fetchInstrumentQuote(activeItem);
  }, 60000);
})();