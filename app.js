import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.0";
import { calculateMarketHealth, normalizeCashFlowReports } from "./market-metrics.js";
import { MARKET_LIBRARY, MARKET_LIBRARY_COUNTS, MARKET_SECTOR_GROUPS } from "./market-library.js";

(() => {
  const SUPABASE_URL = "https://ykmdyfbklvuoseqdjnxy.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_FaJPNdtRsZTemxpbp98F2g_U9ngkFaG";
  const MARKET_DATA_URL = SUPABASE_URL + "/functions/v1/market-data";
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const $ = (id) => document.getElementById(id);
  let userId = null, session = null, watchlist = [], journal = [], calendarEvents = [], currentPlan = null;
  let cloudReady = false, loadingUserId = null, loadedUserId = null;
  let syncQueue = Promise.resolve();
  const knownCloud = { watchlist: new Set(), journal: new Set(), calendar: new Set() };
  const quoteCache = new Map();
  const MARKET_LIBRARY_ITEMS = [...MARKET_LIBRARY.stocks, ...MARKET_LIBRARY.crypto];
  const MARKET_LIBRARY_BY_SYMBOL = new Map(MARKET_LIBRARY_ITEMS.map(item => [item.symbol, item]));
  const MARKET_SECTOR_GROUP_BY_ID = new Map(MARKET_SECTOR_GROUPS.map(group => [group.id, group]));
  let selectedChartSymbol = "", selectedInterval = "1d", currentBars = [], chartStyle = "candles";
  let replayIndex = -1, replayTimer = null, fundamentalsCache = new Map(), currentFundamentals = null, chartZoom = 1, chartPanOffset = 0;
  let studyBars = [], studySymbolValue = "", studyIntervalValue = "1d", studyStyleValue = "candles";
  let activeInstrumentSymbol = "", plannerEntryAutoFilled = true;
  const store = {
    get(key, fallback) { try { const value = JSON.parse(localStorage.getItem("rolyfe-desk-" + userId + "-" + key)); return value ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem("rolyfe-desk-" + userId + "-" + key, JSON.stringify(value)); } catch {} }
  };
  function makeId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }
  function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
  function numberOrNull(value) { const n = Number(value); return value === null || value === undefined || value === "" || !Number.isFinite(n) ? null : n; }
  function validSymbol(value) { return /^[A-Z0-9][A-Z0-9.^/_-]{0,19}$/.test(String(value || "")); }
  function setCloudStatus(message) { const node = $("cloudStatus"); if (node) node.textContent = message; }
  async function getCloudRows(table) {
    const orderColumn = table === "desk_watchlists" ? "created_at" : table === "desk_paper_trades" ? "trade_date" : "event_date";
    const { data, error } = await supabase.from(table).select("*").eq("user_id", userId).order(orderColumn, { ascending: true });
    if (error) throw error;
    return data || [];
  }
  function legacyWatchlistRows(items, owner = userId) {
    return items.filter(x => validSymbol(String(x.symbol || "").trim().toUpperCase())).map(x => ({
      user_id: owner, symbol: String(x.symbol).trim().toUpperCase(),
      asset_type: ["Stock", "ETF", "Crypto"].includes(x.type) ? x.type : "Stock"
    }));
  }
  function legacyTradeRows(items, owner = userId) {
    return items.flatMap(x => {
      const symbol = String(x.symbol || "").trim().toUpperCase();
      const entry = Number(x.entry), stop = Number(x.stop), qty = Number(x.qty);
      if (!validSymbol(symbol) || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop) || stop <= 0 || !Number.isFinite(qty) || qty <= 0) return [];
      if (!isUuid(x.id)) x.id = makeId();
      return [{
        id: x.id, user_id: owner, trade_date: x.date || new Date().toISOString(), symbol,
        side: x.side === "Short" ? "Short" : "Long", entry, stop,
        target: numberOrNull(x.target), qty, risk_dollars: numberOrNull(x.riskDollars),
        reward: numberOrNull(x.reward), risk_reward: numberOrNull(x.rr),
        status: x.status === "Closed" ? "Closed" : "Open", exit_price: numberOrNull(x.exit),
        pnl: numberOrNull(x.pnl), closed_at: x.closed || null
      }];
    });
  }
  function legacyCalendarRows(items, owner = userId) {
    const types = ["Earnings", "Economic", "Options expiration", "Personal reminder"];
    return items.flatMap(x => {
      const title = String(x.title || "").trim().slice(0, 120);
      const symbol = String(x.symbol || "").trim().toUpperCase();
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ""))) return [];
      if (!isUuid(x.id)) x.id = makeId();
      return [{
        id: x.id, user_id: owner, title, event_date: x.date,
        event_time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x.time || "")) ? x.time : null,
        event_type: types.includes(x.type) ? x.type : "Personal reminder",
        symbol: validSymbol(symbol) ? symbol : null
      }];
    });
  }
  function mapCloudRows(watchRows, tradeRows, calendarRows) {
    watchlist = watchRows.map(x => ({ symbol: x.symbol, type: x.asset_type, added: x.created_at }));
    journal = tradeRows.map(x => ({
      id: x.id, date: x.trade_date, symbol: x.symbol, side: x.side,
      entry: Number(x.entry), stop: Number(x.stop), target: numberOrNull(x.target),
      qty: Number(x.qty), riskDollars: numberOrNull(x.risk_dollars),
      reward: numberOrNull(x.reward), rr: numberOrNull(x.risk_reward),
      status: x.status, exit: numberOrNull(x.exit_price), pnl: numberOrNull(x.pnl),
      closed: x.closed_at || null
    }));
    calendarEvents = calendarRows.map(x => ({
      id: x.id, title: x.title, date: x.event_date, time: x.event_time || "",
      type: x.event_type, symbol: x.symbol || "", created: x.created_at
    }));
    knownCloud.watchlist = new Set(watchRows.map(x => x.symbol));
    knownCloud.journal = new Set(tradeRows.map(x => x.id));
    knownCloud.calendar = new Set(calendarRows.map(x => x.id));
  }
  function setSessionVisibility(isAuthenticated) {
    $("authGate").hidden = isAuthenticated;
    $("appShell").hidden = !isAuthenticated;
    $("atlasToggle").hidden = !isAuthenticated;
    $("instrumentFloater").hidden = !isAuthenticated;
    if (!isAuthenticated) $("instrumentPickerBackdrop").hidden = true;
    document.documentElement.classList.toggle("desk-authenticated", isAuthenticated);
  }
  async function loadUserData() {
    const owner = userId;
    loadingUserId = owner;
    cloudReady = false;
    setCloudStatus("SYNCING PRIVATE DESK");
    setSessionVisibility(true);
    try {
      let [watchRows, tradeRows, calendarRows] = await Promise.all([
        getCloudRows("desk_watchlists"), getCloudRows("desk_paper_trades"), getCloudRows("desk_calendar_events")
      ]);
      if (owner !== userId) return;
      const legacyWatch = store.get("watchlist", []);
      const legacyTrades = store.get("journal", []);
      const legacyCalendar = store.get("calendar", []);
      const imports = [];
      if (!watchRows.length && legacyWatch.length) {
        const rows = legacyWatchlistRows(legacyWatch, owner);
        if (rows.length) imports.push(supabase.from("desk_watchlists").upsert(rows, { onConflict: "user_id,symbol" }));
      }
      if (!tradeRows.length && legacyTrades.length) {
        const rows = legacyTradeRows(legacyTrades, owner);
        if (rows.length) imports.push(supabase.from("desk_paper_trades").upsert(rows, { onConflict: "id" }));
      }
      if (!calendarRows.length && legacyCalendar.length) {
        const rows = legacyCalendarRows(legacyCalendar, owner);
        if (rows.length) imports.push(supabase.from("desk_calendar_events").upsert(rows, { onConflict: "id" }));
      }
      for (const request of imports) {
        const result = await request;
        if (result.error) throw result.error;
      }
      if (imports.length) {
        [watchRows, tradeRows, calendarRows] = await Promise.all([
          getCloudRows("desk_watchlists"), getCloudRows("desk_paper_trades"), getCloudRows("desk_calendar_events")
        ]);
      }
      if (owner !== userId) return;
      mapCloudRows(watchRows, tradeRows, calendarRows);
      cloudReady = true;
      store.set("watchlist", watchlist); store.set("journal", journal); store.set("calendar", calendarEvents);
      setCloudStatus("PRIVATE CLOUD DATA SYNCED");
    } catch (error) {
      if (owner !== userId) return;
      watchlist = store.get("watchlist", []);
      journal = store.get("journal", []);
      calendarEvents = store.get("calendar", []);
      cloudReady = false;
      setCloudStatus("CLOUD SYNC UNAVAILABLE · LOCAL COPY KEPT");
      console.error("RO’Lyfe cloud data load failed:", error);
    }
    if (owner !== userId) return;
    loadingUserId = null;
    loadedUserId = owner;
    quoteCache.clear();
    render(); updateClock(); refreshQuotes(); loadChart();
  }
  function enterSession(nextSession) {
    const nextUserId = nextSession?.user?.id || null;
    session = nextSession;
    if (nextUserId !== userId) {
      userId = nextUserId;
      currentBars = []; replayIndex = -1; chartPanOffset = 0; chartZoom = 1;
      selectedChartSymbol = ""; studyBars = []; studySymbolValue = "";
      loadedUserId = null;
      loadingUserId = null;
      cloudReady = false;
    }
    if (userId) {
      setSessionVisibility(true);
      if (loadedUserId !== userId && loadingUserId !== userId) loadUserData();
    } else {
      watchlist = []; journal = []; calendarEvents = [];
      currentBars = []; replayIndex = -1; chartPanOffset = 0; chartZoom = 1;
      studyBars = []; selectedChartSymbol = ""; studySymbolValue = ""; currentFundamentals = null;
      loadedUserId = null; loadingUserId = null; cloudReady = false;
      setSessionVisibility(false);
    }
  }
  let authEventResolved = false;
  supabase.auth.onAuthStateChange((_event, nextSession) => {
    setTimeout(() => { authEventResolved = true; enterSession(nextSession); }, 0);
  });
  supabase.auth.getSession().then(({data, error}) => {
    if (!authEventResolved) {
      if (error) console.error("RO’Lyfe session check failed:", error);
      enterSession(data?.session || null);
    }
  }).catch(error => console.error("RO’Lyfe session initialization failed:", error));

  async function syncRows(table, rows, keyColumn, knownSet, onConflict, owner) {
    const nextKeys = new Set(rows.map(x => String(x[keyColumn])));
    if (rows.length) {
      const { error } = await supabase.from(table).upsert(rows, { onConflict });
      if (error) throw error;
    }
    const removed = [...knownSet].filter(key => !nextKeys.has(String(key)));
    if (removed.length) {
      const { error } = await supabase.from(table).delete().eq("user_id", owner).in(keyColumn, removed);
      if (error) throw error;
    }
    knownSet.clear();
    nextKeys.forEach(key => knownSet.add(key));
  }
  async function syncSnapshot(owner, snapshot) {
    const watchRows = legacyWatchlistRows(snapshot.watchlist, owner);
    const tradeRows = legacyTradeRows(snapshot.journal, owner);
    const calendarRows = legacyCalendarRows(snapshot.calendar, owner);
    await Promise.all([
      syncRows("desk_watchlists", watchRows, "symbol", knownCloud.watchlist, "user_id,symbol", owner),
      syncRows("desk_paper_trades", tradeRows, "id", knownCloud.journal, "id", owner),
      syncRows("desk_calendar_events", calendarRows, "id", knownCloud.calendar, "id", owner)
    ]);
  }
  function save() {
    store.set("watchlist", watchlist); store.set("journal", journal); store.set("calendar", calendarEvents);
    render();
    if (!cloudReady || !userId) return;
    const owner = userId;
    const snapshot = {
      watchlist: watchlist.map(x => ({...x})),
      journal: journal.map(x => ({...x})),
      calendar: calendarEvents.map(x => ({...x}))
    };
    setCloudStatus("SAVING PRIVATE DESK DATA");
    syncQueue = syncQueue.then(async () => {
      if (owner !== userId || !cloudReady) return;
      try {
        await syncSnapshot(owner, snapshot);
        if (owner === userId) setCloudStatus("PRIVATE CLOUD DATA SYNCED");
      } catch (error) {
        if (owner === userId) setCloudStatus("SYNC ISSUE · LOCAL COPY KEPT");
        console.error("RO’Lyfe cloud data save failed:", error);
      }
    });
  }
  const money = (n) => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(Number(n)||0);
  const price = (n) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:10}).format(Number(n)||0);
  const safe = (s) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const setAuthMessage = (message, kind="") => { $("authStatus").textContent=message; $("authStatus").className="auth-status "+kind; };

  async function sendSignInLink(e) {
    e.preventDefault();
    const email = $("authEmail").value.trim().toLowerCase();
    if (!email) return;
    $("authSubmit").disabled = true;
    $("authSubmit").textContent = "Sending secure link…";
    setAuthMessage("Preparing your secure email link…");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) throw error;
      setAuthMessage(
        "Check your inbox for the secure sign-in link. New customers can create an account by verifying that email. Open the link on this device to enter your desk.",
        "success"
      );
    } catch (error) {
      setAuthMessage(error?.message || "We could not send the email link. Please try again.", "error");
    } finally {
      $("authSubmit").disabled = false;
      $("authSubmit").textContent = "Continue with secure email link";
    }
  }
  $("authForm").addEventListener("submit", sendSignInLink);

  function go(view) {
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "view-" + view));
    document.querySelectorAll(".nav-link").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    $("pageCrumb").textContent = ({overview:"OVERVIEW",markets:"WATCHLISTS",calendar:"CALENDAR",planner:"TRADE PLANNER",journal:"PAPER JOURNAL",execution:"PERSONAL EXECUTION"})[view] || "OVERVIEW";
    $("sidebar").classList.remove("open"); window.scrollTo({top:0,behavior:"smooth"});
    if(view==="markets"&&currentBars.length){const bars=replayBars();drawChart(bars);drawIndicatorPanels(bars);renderMarketHealth(bars);if(currentFundamentals)renderFundamentals(currentFundamentals);if(!$("studyChartPanel").hidden)drawStudyChart(studyBars);}
  }
  document.querySelectorAll(".nav-link").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
  document.querySelectorAll("a.brand[href=\"#\"]").forEach(link=>link.addEventListener("click",event=>{event.preventDefault();go("overview");}));
  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));
  $("menuToggle").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  document.querySelectorAll("[data-jump]").forEach(button => button.addEventListener("click", () => {
    const target = $(button.dataset.jump);
    if (!target) return;
    if (button.dataset.jumpView) go(button.dataset.jumpView);
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof target.focus === "function") setTimeout(() => target.focus({ preventScroll: true }), 250);
    });
  }));
  $("signOutBtn").addEventListener("click", async () => { await supabase.auth.signOut(); });

  function quoteMarkup(symbol) {
    const q=quoteCache.get(symbol);
    if (!q) return {last:'<span class="quote-na">Loading…</span>',change:'<span class="quote-na">—</span>'};
    if (q.error) return {last:'<span class="quote-na">Unavailable</span>',change:'<span class="quote-na" title="'+safe(q.error)+'">—</span>'};
    const pct=typeof q.changePercent==="number"?q.changePercent:NaN;
    const cls=Number.isFinite(pct)?(pct>0?"quote-positive":pct<0?"quote-negative":"quote-neutral"):"quote-neutral";
    const quoteStamp=q.timestamp?dateValue(q.timestamp).toLocaleString():"provider timestamp not supplied";
    const quoteMeta=safe(q.provider||"provider")+" · "+safe(quoteStamp);
    return {last:'<span class="quote-value"><b title="Source: '+safe(q.provider||"provider")+' · As of '+safe(quoteStamp)+'">'+price(q.price)+'</b><small>'+quoteMeta+'</small></span>',change:Number.isFinite(pct)?'<span class="'+cls+'">'+(pct>0?"+":"")+pct.toFixed(2)+'%</span>':'<span class="quote-na">—</span>'};
  }
  function renderWatchlist() {
    $("watchCount").textContent = watchlist.length + (watchlist.length === 1 ? " SYMBOL" : " SYMBOLS");
    $("metricSymbols").textContent = watchlist.length;
    const indexed=watchlist.map((item,index)=>({...item,index}));
    const grouped=MARKET_SECTOR_GROUPS.map(group=>({
      sector:group.label,
      items:indexed.filter(item=>group.symbols.includes(item.symbol))
    })).filter(group=>group.items.length);
    const mapped=new Set(MARKET_SECTOR_GROUPS.flatMap(group=>group.symbols));
    const custom=indexed.filter(item=>!mapped.has(item.symbol));
    if(custom.length)grouped.push({sector:"Custom / Other Instruments",items:custom});
    const firstActive=grouped[0]?.sector;
    $("watchlistGroups").innerHTML=grouped.length?grouped.map(group=>{
      const rows=group.items.map(item=>{
        const q=quoteMarkup(item.symbol);
        return '<div class="watch-item"><div class="watch-item-main"><b>'+safe(item.symbol)+'</b><small>'+safe(item.type)+' · '+safe(group.sector)+'</small></div><div class="watch-item-quote">'+q.last+'</div><div class="watch-item-change">'+q.change+'</div><div class="watch-item-actions"><button class="table-action" type="button" data-open-chart="'+safe(item.symbol)+'">Open chart ↗</button><button class="table-action remove-btn" type="button" data-remove="'+item.index+'">Remove</button></div></div>';
      }).join("");
      const types=[...new Set(group.items.map(item=>item.type))].join(" · ");
      return '<details class="watch-group watch-group-sector" '+(group.sector===firstActive?"open":"")+'><summary><span class="watch-group-mark">◆</span><span class="watch-group-title"><b>'+safe(group.sector)+'</b><small>'+safe(types)+'</small></span><span class="watch-group-count">'+group.items.length+(group.items.length===1?" symbol":" symbols")+'</span></summary><div class="watch-group-list">'+rows+'</div></details>';
    }).join(""):'<div class="watch-group-empty">No favorites yet. Pick any instrument from the floating sector selector or the full market browser.</div>';
    $("overviewWatchlist").innerHTML = watchlist.length ? watchlist.slice(0,5).map(x => {
      const q=quoteMarkup(x.symbol);
      return '<div class="mini-row"><b>'+safe(x.symbol)+'</b><small>'+safe(x.type)+'</small><span>'+q.last+' '+q.change+'</span></div>';
    }).join("") : '<div class="empty-state">Your watchlist is ready. Add a symbol to begin tracking it.</div>';
    refreshChartOptions(); refreshStudyOptions();
    document.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => { const removed=watchlist.splice(Number(b.dataset.remove),1)[0]; if (removed) quoteCache.delete(removed.symbol); save(); }));
    document.querySelectorAll("[data-open-chart]").forEach(b => b.addEventListener("click", () => openChartForSymbol(b.dataset.openChart)));
  }
  $("addSymbolForm").addEventListener("submit", e => {
    e.preventDefault();
    const symbol=$("symbolInput").value.trim().toUpperCase().replace(/\s+/g,"");
    if (!/^[A-Z0-9.^/_-]{1,20}$/.test(symbol)) { alert("Use a valid ticker or pair symbol."); return; }
    if (watchlist.some(x=>x.symbol===symbol)) { alert(symbol+" is already on your watchlist."); return; }
    if (watchlist.length>=20) { alert("This desk currently supports 20 tracked symbols while provider request limits are verified."); return; }
    watchlist.push({symbol,type:$("assetType").value,added:new Date().toISOString()});
    $("symbolInput").value=""; save(); refreshQuotes(); loadChart();
  });


  function tickerbotSymbol(item) {
    if (item.type !== "Crypto") return item.symbol;
    const base=String(item.api||item.symbol||"").toUpperCase().replace(/-USD$/,"").replace(/^X:/,"").replace(/USD$/,"");
    return base ? "X:"+base+"USD" : item.symbol;
  }
  function getMarketItem(symbol) {
    return watchlist.find(item=>item.symbol===symbol) || MARKET_LIBRARY_BY_SYMBOL.get(symbol) || null;
  }
  function allChartItems() {
    const bySymbol=new Map();
    watchlist.forEach(item=>bySymbol.set(item.symbol,item));
    MARKET_LIBRARY_ITEMS.forEach(item=>{if(!bySymbol.has(item.symbol))bySymbol.set(item.symbol,item);});
    return [...bySymbol.values()];
  }
  function chartOptionsMarkup() {
    const mySymbols=new Set(watchlist.map(item=>item.symbol));
    const personal=watchlist.map(item=>'<option value="'+safe(item.symbol)+'">'+safe(item.symbol)+' · '+safe(item.type)+' · My Watchlist</option>').join("");
    const sectorGroups=MARKET_SECTOR_GROUPS.map(group=>{
      const options=group.symbols.filter(symbol=>!mySymbols.has(symbol)).map(symbol=>{
        const item=MARKET_LIBRARY_BY_SYMBOL.get(symbol);if(!item)return "";
        return '<option value="'+safe(item.symbol)+'">'+safe(item.displaySymbol||item.symbol)+' · '+safe(item.name)+'</option>';
      }).join("");
      return options?'<optgroup label="'+safe(group.label)+' · '+group.symbols.length+'">'+options+'</optgroup>':"";
    }).join("");
    return '<option value="">Select a symbol</option>'+(personal?'<optgroup label="MY WATCHLIST">'+personal+'</optgroup>':"")+sectorGroups;
  }
  function refreshChartOptions() {
    const select=$("chartSymbol"), previous=selectedChartSymbol || select.value;
    select.innerHTML=chartOptionsMarkup();
    let savedSymbol="";try{savedSymbol=localStorage.getItem("rolyfe-active-instrument")||"";}catch{}
    selectedChartSymbol=getMarketItem(previous)?previous:(getMarketItem(savedSymbol)?savedSymbol:(watchlist[0]?.symbol||""));
    select.value=selectedChartSymbol;
    if (selectedChartSymbol) syncActiveInstrument(getMarketItem(selectedChartSymbol));
    if (previous && previous!==selectedChartSymbol) loadChart();
  }
  function refreshStudyOptions() {
    const select=$("studySymbol");if(!select)return;
    const previous=studySymbolValue||selectedChartSymbol||select.value;
    select.innerHTML=chartOptionsMarkup();
    studySymbolValue=getMarketItem(previous)?previous:(selectedChartSymbol||watchlist[0]?.symbol||"");
    select.value=studySymbolValue;
  }
  function openChartForSymbol(symbol) {
    selectActiveInstrument(symbol,{scrollToChart:true});
  }
  function renderMarketLibrary() {
    const host=$("marketLibraryResults");if(!host)return;
    const query=$("marketLibrarySearch").value.trim().toLowerCase();
    const filter=$("marketLibraryFilter").value;
    const sectorFilter=$("marketLibrarySector")?.value||"all";
    const groups=MARKET_SECTOR_GROUPS.filter(group=>sectorFilter==="all"||group.id===sectorFilter).map(group=>{
      const items=group.symbols.map(symbol=>MARKET_LIBRARY_BY_SYMBOL.get(symbol)).filter(item=>item&&(filter==="all"||item.type===filter)&&(!query||[item.symbol,item.displaySymbol,item.name,group.label].some(value=>String(value||"").toLowerCase().includes(query))));
      if(!items.length)return "";
      const rows=items.map(item=>{
        const q=quoteCache.get(item.symbol);
        const qText=q&&!q.error&&Number(q.price)>0?price(q.price):"Price on selection";
        return '<div class="library-symbol-row"><div class="library-symbol-name"><b>'+safe(item.displaySymbol||item.symbol)+'</b><small>'+safe(item.name)+' · '+safe(group.label)+'</small></div><span class="library-symbol-type">'+safe(item.type)+'</span><span class="library-symbol-price">'+safe(qText)+'</span><button class="table-action" type="button" data-open-library="'+safe(item.symbol)+'">Select / Chart</button><button class="table-action" type="button" data-add-library="'+safe(item.symbol)+'" '+(watchlist.some(x=>x.symbol===item.symbol)?"disabled":"")+'>Add</button></div>';
      }).join("");
      return '<details class="market-sector-group" open><summary><b>'+safe(group.label)+'</b><span>'+items.length+' instruments</span></summary><div class="market-sector-items">'+rows+'</div></details>';
    }).join("");
    const count=groups?MARKET_LIBRARY_ITEMS.filter(item=>(filter==="all"||item.type===filter)&&(!query||[item.symbol,item.displaySymbol,item.name].some(value=>String(value||"").toLowerCase().includes(query)))&&(sectorFilter==="all"||MARKET_SECTOR_GROUPS.find(group=>group.id===sectorFilter)?.symbols.includes(item.symbol))).length:0;
    $("marketLibraryStatus").textContent="Showing "+count+" matching instruments · "+MARKET_LIBRARY_COUNTS.total+" total symbols · organized by sector and crypto theme. Select any symbol to make it active everywhere.";
    host.innerHTML=groups||'<div class="empty-state">No matching market symbols.</div>';
    host.querySelectorAll("[data-open-library]").forEach(button=>button.addEventListener("click",()=>selectActiveInstrument(button.dataset.openLibrary,{scrollToChart:true})));
    host.querySelectorAll("[data-add-library]").forEach(button=>button.addEventListener("click",()=>{
      const item=MARKET_LIBRARY_BY_SYMBOL.get(button.dataset.addLibrary);if(!item)return;
      if(watchlist.some(x=>x.symbol===item.symbol)){button.disabled=true;return;}
      if(watchlist.length>=20){$("marketLibraryStatus").textContent="My Watchlist is at its 20-symbol tracking limit. The global instrument picker, chart selectors, and scanners still retain the full library.";return;}
      watchlist.push({symbol:item.symbol,type:item.type,added:new Date().toISOString()});
      save();refreshQuotes();renderMarketLibrary();
    }));
  }
  function marketItemForSymbol(symbol) { return getMarketItem(String(symbol||"").trim().toUpperCase()); }
  function sectorOptionsMarkup() {
    return '<option value="all">All sectors & themes</option>'+MARKET_SECTOR_GROUPS.map(group=>'<option value="'+safe(group.id)+'">'+safe(group.label)+'</option>').join("");
  }
  function renderSymbolSuggestions() {
    const node=$("marketSymbolSuggestions");if(!node)return;
    node.innerHTML=MARKET_SECTOR_GROUPS.flatMap(group=>group.symbols.map(symbol=>{
      const item=MARKET_LIBRARY_BY_SYMBOL.get(symbol);return item?'<option value="'+safe(item.symbol)+'" label="'+safe(item.name)+' · '+safe(group.label)+'"></option>':"";
    })).join("");
  }
  function renderScannerOptions() {
    const select=$("scanAsset");if(!select)return;
    const current=select.value||"watchlist";
    select.innerHTML='<option value="watchlist">My Watchlist</option><option value="all">Full symbol universe · '+MARKET_LIBRARY_COUNTS.total+'</option><option value="stocks">All stocks + ETFs · '+MARKET_LIBRARY_COUNTS.stocks+'</option><option value="etfs">ETFs only · 7</option><option value="crypto">All crypto · '+MARKET_LIBRARY_COUNTS.crypto+'</option>'+MARKET_SECTOR_GROUPS.map(group=>'<option value="sector:'+safe(group.id)+'">'+safe(group.label)+' · '+group.symbols.length+'</option>').join("");
    select.value=[...select.options].some(option=>option.value===current)?current:"watchlist";
  }
  function quoteTimestampLabel(value) {
    if(!value)return "Provider timestamp not supplied";
    const stamp=dateValue(value);return Number.isFinite(stamp.getTime())?stamp.toLocaleString():"Provider timestamp not supplied";
  }
  function renderActiveInstrumentQuote(item, quote) {
    if(!item)return;
    const typeLabel=item.type==="Crypto"?"CRYPTO SPOT":item.type==="ETF"?"ETF":"STOCK";
    $("instrumentFloatSymbol").textContent=item.displaySymbol||item.symbol;
    $("instrumentFloatPrice").textContent=quote&&!quote.error&&Number(quote.price)>0?price(quote.price):"Price unavailable";
    const hasBid=quote&&!quote.error&&Number.isFinite(Number(quote.bid))&&Number(quote.bid)>0;
    const hasAsk=quote&&!quote.error&&Number.isFinite(Number(quote.ask))&&Number(quote.ask)>0;
    const bidAsk=hasBid||hasAsk?"Bid "+(hasBid?price(quote.bid):"—")+" · Ask "+(hasAsk?price(quote.ask):"—"):"Bid/ask unavailable";
    $("instrumentFloatChange").textContent=quote&&!quote.error?(Number.isFinite(quote.changePercent)?(quote.changePercent>0?"+":"")+quote.changePercent.toFixed(2)+"% · ":"")+typeLabel+" · "+(quote.provider||"provider")+(hasBid||hasAsk?" · "+bidAsk:"")+(quote.quoteMode==="latest 1-minute bar close"?" · bar close":""):(typeLabel+" · provider quote not returned");
    $("instrumentSelectedSymbol").textContent=(item.displaySymbol||item.symbol)+" · "+item.name;
    $("instrumentSelectedPrice").textContent=quote&&!quote.error&&Number(quote.price)>0?price(quote.price):"—";
    $("instrumentSelectedMeta").textContent=quote&&!quote.error
      ?(quote.provider||"Provider")+" · "+(quote.quoteMode||"provider quote")+" · "+quoteTimestampLabel(quote.timestamp)+(Number.isFinite(quote.changePercent)?" · change "+(quote.changePercent>0?"+":"")+quote.changePercent.toFixed(2)+"%":"")+" · "+bidAsk+(quote.high||quote.low?" · Day H "+(quote.high?price(quote.high):"—")+" / L "+(quote.low?price(quote.low):"—"):"")+(quote.quoteNote?" · "+quote.quoteNote:"")
      :(quote?.error||"Requesting a verified provider quote. No estimated price is substituted.");
    const level=$("instrumentLimitPrice");
    const side=$("instrumentQuoteSide")?.value||"buy";
    const sidePrice=side==="buy"?(hasAsk?Number(quote.ask):Number(quote?.price)):(hasBid?Number(quote.bid):Number(quote?.price));
    if(quote&&!quote.error&&Number.isFinite(sidePrice)&&sidePrice>0&&(level.dataset.auto==="true"||!level.value)){
      level.value=String(sidePrice);level.dataset.auto="true";
    }
    if(plannerEntryAutoFilled&&quote&&!quote.error&&Number(quote.price)>0)$("entryPrice").value=String(quote.price);
    const active=window.ROLYFE_ACTIVE_INSTRUMENT||{};
    window.ROLYFE_ACTIVE_INSTRUMENT={...active,...item,quote:quote||null};
    document.dispatchEvent(new CustomEvent("rolyfe:instrument-selected",{detail:{...item,quote:quote||null,quoteOnly:true,levels:{limit:$("instrumentLimitPrice").value,stop:$("instrumentStopPrice").value,target:$("instrumentTargetPrice").value}}}));
    renderInstrumentPicker();
  }
  function syncActiveInstrument(item, options={}) {
    if(!item)return;
    const changed=activeInstrumentSymbol!==item.symbol;
    activeInstrumentSymbol=item.symbol;
    try{localStorage.setItem("rolyfe-active-instrument",item.symbol);}catch{}
    $("planSymbol").value=item.symbol;
    $("eventSymbol").value=item.symbol;
    const quote=quoteCache.get(item.symbol)||null;
    window.ROLYFE_ACTIVE_INSTRUMENT={...item,quote};
    if(changed){
      $("instrumentLimitPrice").value="";$("instrumentLimitPrice").dataset.auto="true";
      $("instrumentStopPrice").value="";$("instrumentTargetPrice").value="";
      $("planError").textContent="";
      document.dispatchEvent(new CustomEvent("rolyfe:instrument-selected",{detail:{...item,quote,quoteOnly:false,levels:{limit:"",stop:"",target:""}}}));
    }
    renderActiveInstrumentQuote(item,quote);
    const addButton=$("instrumentAddWatchlist");
    addButton.disabled=watchlist.some(x=>x.symbol===item.symbol)||watchlist.length>=20;
    addButton.textContent=watchlist.some(x=>x.symbol===item.symbol)?"Already in My Watchlist":watchlist.length>=20?"Watchlist limit reached":"Add to My Watchlist";
    if(options.requestQuote!==false&&userId&&(options.forceQuote===true||!quoteCache.has(item.symbol))){
      fetchQuote(item).then(result=>{
        quoteCache.set(item.symbol,result);
        if(activeInstrumentSymbol===item.symbol)renderActiveInstrumentQuote(item,result);
        if(watchlist.some(x=>x.symbol===item.symbol))renderWatchlist();
        if(activeInstrumentSymbol===item.symbol)renderInstrumentPicker();
      });
    }
  }
  function selectActiveInstrument(symbol, options={}) {
    const item=marketItemForSymbol(symbol);if(!item)return;
    const changed=selectedChartSymbol!==item.symbol;
    selectedChartSymbol=item.symbol;
    $("chartSymbol").value=item.symbol;
    chartZoom=1;chartPanOffset=0;replayIndex=-1;stopReplay();
    syncActiveInstrument(item,{requestQuote:true,forceQuote:true});
    if(changed||!currentBars.length)loadChart();
    if(options.closePicker!==false)$("instrumentPickerBackdrop").hidden=true;
    if(options.scrollToChart){
      go("markets");
      requestAnimationFrame(()=>$("primaryChartPanel").scrollIntoView({behavior:"smooth",block:"start"}));
    }
  }
  function renderInstrumentPicker() {
    const host=$("instrumentPickerResults");if(!host)return;
    const query=$("instrumentSearch").value.trim().toLowerCase();
    const asset=$("instrumentAssetFilter").value,sector=$("instrumentSectorFilter").value;
    const groups=MARKET_SECTOR_GROUPS.filter(group=>sector==="all"||group.id===sector).map(group=>{
      const items=group.symbols.map(symbol=>MARKET_LIBRARY_BY_SYMBOL.get(symbol)).filter(item=>item&&(asset==="all"||item.type===asset)&&(!query||[item.symbol,item.displaySymbol,item.name,group.label].some(value=>String(value||"").toLowerCase().includes(query))));
      if(!items.length)return "";
      return '<section class="instrument-sector-list"><header><b>'+safe(group.label)+'</b><small>'+items.length+' symbols</small></header>'+items.map(item=>{
        const q=quoteCache.get(item.symbol),active=item.symbol===activeInstrumentSymbol;
        const quoteText=q&&!q.error&&Number(q.price)>0?price(q.price):(q?.error?"Quote unavailable":"Select for quote");
        return '<button type="button" class="instrument-result '+(active?"active":"")+'" data-select-instrument="'+safe(item.symbol)+'"><span class="instrument-result-code"><b>'+safe(item.displaySymbol||item.symbol)+'</b><small>'+safe(item.name)+'</small></span><span class="instrument-result-data"><b>'+safe(quoteText)+'</b><small>'+safe(item.type)+(Number.isFinite(q?.changePercent)?" · "+(q.changePercent>0?"+":"")+q.changePercent.toFixed(2)+"%":"")+'</small></span></button>';
      }).join("")+'</section>';
    }).join("");
    host.innerHTML=groups||'<div class="empty-state">No symbols match these filters.</div>';
    host.querySelectorAll("[data-select-instrument]").forEach(button=>button.addEventListener("click",()=>selectActiveInstrument(button.dataset.selectInstrument)));
  }
  function openInstrumentPicker() {
    $("instrumentPickerBackdrop").hidden=false;
    $("instrumentSearch").focus();
    renderInstrumentPicker();
  }
  $("instrumentFloatOpen").addEventListener("click",openInstrumentPicker);
  $("instrumentFloatBrowse").addEventListener("click",openInstrumentPicker);
  $("instrumentPickerClose").addEventListener("click",()=>$("instrumentPickerBackdrop").hidden=true);
  $("instrumentPickerBackdrop").addEventListener("click",event=>{if(event.target===$("instrumentPickerBackdrop"))$("instrumentPickerBackdrop").hidden=true;});
  $("instrumentSearch").addEventListener("input",renderInstrumentPicker);
  $("instrumentAssetFilter").addEventListener("change",renderInstrumentPicker);
  $("instrumentSectorFilter").innerHTML=sectorOptionsMarkup();
  $("instrumentSectorFilter").addEventListener("change",renderInstrumentPicker);
  $("instrumentApplyPlan").addEventListener("click",()=>{
    const item=marketItemForSymbol(activeInstrumentSymbol);if(!item)return;
    $("planSymbol").value=item.symbol;
    const quote=quoteCache.get(item.symbol);
    $("entryPrice").value=$("instrumentLimitPrice").value||(quote&&!quote.error?String(quote.price):"");
    $("stopPrice").value=$("instrumentStopPrice").value;
    $("targetPrice").value=$("instrumentTargetPrice").value;
    plannerEntryAutoFilled=false;
    $("instrumentPickerBackdrop").hidden=true;
    go("planner");
    $("entryPrice").focus();
  });
  $("instrumentLimitPrice").addEventListener("input",()=>{$("instrumentLimitPrice").dataset.auto="false";});
  $("instrumentQuoteSide").addEventListener("change",()=>{
    const quote=quoteCache.get(activeInstrumentSymbol);
    if(!quote||quote.error||$("instrumentLimitPrice").dataset.auto!=="true")return;
    const side=$("instrumentQuoteSide").value;
    const candidate=side==="buy"?Number(quote.ask):Number(quote.bid);
    $("instrumentLimitPrice").value=String(Number.isFinite(candidate)&&candidate>0?candidate:Number(quote.price)||"");
  });
  $("instrumentAddWatchlist").addEventListener("click",()=>{
    const item=marketItemForSymbol(activeInstrumentSymbol);if(!item)return;
    if(watchlist.some(x=>x.symbol===item.symbol)||watchlist.length>=20)return;
    watchlist.push({symbol:item.symbol,type:item.type,added:new Date().toISOString()});
    save();refreshQuotes();renderMarketLibrary();renderInstrumentPicker();
  });
  $("instrumentOpenExecution").addEventListener("click",()=>{$("instrumentPickerBackdrop").hidden=true;go("execution");});
  $("entryPrice").addEventListener("input",()=>{plannerEntryAutoFilled=false;});
  $("planSymbol").addEventListener("change",()=>{const item=marketItemForSymbol($("planSymbol").value);if(item)selectActiveInstrument(item.symbol);});
  $("eventSymbol").addEventListener("change",()=>{const item=marketItemForSymbol($("eventSymbol").value);if(item)selectActiveInstrument(item.symbol);});
  $("symbolInput").addEventListener("change",()=>{const item=marketItemForSymbol($("symbolInput").value);if(item)selectActiveInstrument(item.symbol);});
  document.addEventListener("keydown",event=>{if(event.key==="Escape")$("instrumentPickerBackdrop").hidden=true;});
  document.addEventListener("rolyfe:use-quote-in-plan",()=>{
    const quote=quoteCache.get(activeInstrumentSymbol);
    if(! $("instrumentLimitPrice").value && quote && !quote.error)$("instrumentLimitPrice").value=String(quote.price);
    $("instrumentApplyPlan").click();
  });
  renderScannerOptions();
  renderSymbolSuggestions();
  renderInstrumentPicker();
  function drawStudyChart(bars) {
    const canvas=$("studyChart");if(!canvas)return;
    const rect=canvas.getBoundingClientRect(),w=Math.max(320,rect.width),h=Math.max(220,rect.height),dpr=window.devicePixelRatio||1;
    canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);
    const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle="#08140f";ctx.fillRect(0,0,w,h);
    if(!bars.length){ctx.fillStyle="#81988c";ctx.font="12px DM Sans";ctx.fillText("No verified candles available for this study chart.",16,30);return;}
    const closes=bars.map(b=>Number(b.c)),ema20=movingAverage(closes,20,true),ema50=movingAverage(closes,50,true);
    let max=Math.max(...bars.map(b=>Number(b.h))),min=Math.min(...bars.map(b=>Number(b.l)));
    [...ema20,...ema50].forEach(v=>{if(Number.isFinite(v)){max=Math.max(max,v);min=Math.min(min,v);}});
    const pad=(max-min)*.08||1;max+=pad;min-=pad;
    const left=12,right=62,top=15,bottom=26,plotW=w-left-right,plotH=h-top-bottom;
    const y=v=>top+(max-v)/(max-min)*plotH;
    ctx.strokeStyle="#1b3027";ctx.fillStyle="#789084";ctx.font="9px DM Mono";
    for(let i=0;i<=4;i++){const yy=top+plotH*i/4;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();ctx.fillText((max-(max-min)*i/4).toFixed(2),w-right+5,yy+3);}
    const step=plotW/bars.length,candleW=Math.max(1,Math.min(8,step*.6));
    if(studyStyleValue==="line")drawLine(ctx,closes,0,step,left,y,"#72e6a5",2);
    else bars.forEach((bar,i)=>{const x=left+step*(i+.5),o=y(Number(bar.o)),c=y(Number(bar.c)),hi=y(Number(bar.h)),lo=y(Number(bar.l)),up=Number(bar.c)>=Number(bar.o);ctx.strokeStyle=up?"#72e6a5":"#ef7777";ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(x,hi);ctx.lineTo(x,lo);ctx.stroke();ctx.fillRect(x-candleW/2,Math.min(o,c),candleW,Math.max(1,Math.abs(c-o)));});
    drawLine(ctx,ema20,0,step,left,y,"#f0b24b",1.5);drawLine(ctx,ema50,0,step,left,y,"#63b8c8",1.5);
    ctx.fillStyle="#789084";ctx.fillText(dateValue(bars[0].t).toLocaleDateString(),left,h-7);ctx.textAlign="right";ctx.fillText(dateValue(bars.at(-1).t).toLocaleDateString(),w-right,h-7);ctx.textAlign="left";
  }
  async function loadStudyChart() {
    const item=getMarketItem(studySymbolValue);
    if(!item){studyBars=[];drawStudyChart([]);$("studyChartStatus").textContent="Choose a symbol from the RTIC library or your watchlist.";return;}
    $("studyChartStatus").textContent="Loading "+item.symbol+" · "+studyIntervalValue+" study candles…";
    try{
      const {data:{session:active}}=await supabase.auth.getSession();
      if(!active?.access_token)throw new Error("Sign in again to load historical study data.");
      const symbol=tickerbotSymbol(item),url=MARKET_DATA_URL+"?provider=tickerbot&symbol="+encodeURIComponent(symbol)+"&interval="+studyIntervalValue+"&limit=500&session=all";
      const response=await fetch(url,{headers:{"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+active.access_token,"Accept":"application/json"}});
      const payload=await response.json();
      if(!response.ok||!Array.isArray(payload.bars))throw new Error(payload.error||"Study chart history is unavailable.");
      studyBars=[...payload.bars].filter(b=>[b.o,b.h,b.l,b.c].every(v=>Number.isFinite(Number(v)))&&Number.isFinite(dateValue(b.t).getTime())).sort((x,y)=>dateValue(x.t)-dateValue(y.t));
      drawStudyChart(studyBars);
      $("studyChartStatus").textContent=item.symbol+" · "+studyIntervalValue.toUpperCase()+" · "+studyBars.length+" candles · "+(payload.provider||"provider")+" · "+(payload.asOf||"timestamp not supplied");
    }catch(error){studyBars=[];drawStudyChart([]);$("studyChartStatus").textContent=error.message||"Study chart could not be loaded.";}
  }
  $("addStudyChart").addEventListener("click",()=>{
    const panel=$("studyChartPanel");panel.hidden=!panel.hidden;
    if(!panel.hidden){refreshStudyOptions();studySymbolValue=studySymbolValue||selectedChartSymbol;$("studySymbol").value=studySymbolValue;loadStudyChart();}
  });
  $("closeStudyChart").addEventListener("click",()=>{$("studyChartPanel").hidden=true;});
  $("studySymbol").addEventListener("change",()=>{studySymbolValue=$("studySymbol").value;loadStudyChart();});
  $("studyInterval").addEventListener("change",()=>{studyIntervalValue=$("studyInterval").value;loadStudyChart();});
  $("studyStyle").addEventListener("change",()=>{studyStyleValue=$("studyStyle").value;drawStudyChart(studyBars);});

  function dateValue(value) { const n=Number(value); return typeof value==="number" || (Number.isFinite(n) && String(value).length>=10 && String(value).length<=13) ? new Date(n<1e12?n*1000:n) : new Date(value); }
  function movingAverage(values, period, exponential=false) {
    const out=Array(values.length).fill(null);
    if (exponential) {
      let sum=0, count=0, ema=null, alpha=2/(period+1);
      for(let i=0;i<values.length;i++){const raw=values[i];if(raw===null||raw===undefined||raw==="" )continue;const v=Number(raw);if(!Number.isFinite(v))continue;if(count<period){sum+=v;count++;if(count===period){ema=sum/period;out[i]=ema;}}else{ema=v*alpha+ema*(1-alpha);out[i]=ema;}}
    } else {
      for(let i=period-1;i<values.length;i++){
        const rawWindow=values.slice(i-period+1,i+1);
        const window=rawWindow.map(Number);
        if(rawWindow.every(value=>value!==null&&value!==undefined&&value!=="")&&window.every(Number.isFinite))out[i]=window.reduce((sum,value)=>sum+value,0)/period;
      }
    }
    return out;
  }
  function weightedMovingAverage(values, period) {
    const out = Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let total = 0, weightTotal = 0, valid = true;
      for (let j = 0; j < period; j++) {
        const raw = values[i - j];
        const value = Number(raw);
        if (raw === null || raw === undefined || raw === "" || !Number.isFinite(value)) { valid = false; break; }
        const weight = period - j;
        total += value * weight;
        weightTotal += weight;
      }
      if (valid && weightTotal) out[i] = total / weightTotal;
    }
    return out;
  }
  function hullMovingAverage(values, period = 32) {
    const half = Math.max(1, Math.floor(period / 2));
    const root = Math.max(1, Math.round(Math.sqrt(period)));
    const halfWma = weightedMovingAverage(values, half);
    const fullWma = weightedMovingAverage(values, period);
    const diff = values.map((_, i) => halfWma[i] === null || fullWma[i] === null ? null : 2 * halfWma[i] - fullWma[i]);
    return weightedMovingAverage(diff, root);
  }
  function vwapSeries(bars, resetEachSession) {
    let totalPV = 0, totalVolume = 0, activeDay = "";
    return bars.map(bar => {
      const volume = Number(bar.v ?? bar.volume);
      const high = Number(bar.h), low = Number(bar.l), close = Number(bar.c);
      const stamp = dateValue(bar.t), parts = Number.isFinite(stamp.getTime()) ? Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(stamp).map(x => [x.type, x.value])) : null, day = parts ? parts.year + "-" + parts.month + "-" + parts.day : activeDay;
      if (resetEachSession && activeDay && day !== activeDay) {
        totalPV = 0; totalVolume = 0;
      }
      activeDay = day;
      if (![volume, high, low, close].every(Number.isFinite) || volume <= 0) return null;
      totalPV += ((high + low + close) / 3) * volume;
      totalVolume += volume;
      return totalVolume > 0 ? totalPV / totalVolume : null;
    });
  }
  function rsiSeries(values, period = 14) {
    const out = Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const change = Number(values[i]) - Number(values[i - 1]);
      if (change >= 0) gain += change; else loss -= change;
    }
    let avgGain = gain / period, avgLoss = loss / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < values.length; i++) {
      const change = Number(values[i]) - Number(values[i - 1]);
      avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }
  function macdSeries(values) {
    const fast = movingAverage(values, 12, true), slow = movingAverage(values, 26, true);
    const line = values.map((_, i) => fast[i] === null || slow[i] === null ? null : fast[i] - slow[i]);
    const signal = movingAverage(line, 9, true);
    const histogram = line.map((value, i) => value === null || signal[i] === null ? null : value - signal[i]);
    return { line, signal, histogram };
  }
  function stochasticSeries(bars, period = 14, smooth = 3) {
    const k = Array(bars.length).fill(null);
    for (let i = period - 1; i < bars.length; i++) {
      const window = bars.slice(i - period + 1, i + 1);
      const highest = Math.max(...window.map(x => Number(x.h)));
      const lowest = Math.min(...window.map(x => Number(x.l)));
      const close = Number(bars[i].c);
      if ([highest, lowest, close].every(Number.isFinite)) k[i] = highest === lowest ? 50 : 100 * (close - lowest) / (highest - lowest);
    }
    return { k, d: movingAverage(k, smooth, false) };
  }
  function drawLine(ctx, values, offset, step, left, y, color, width = 1.5, end = values.length) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    let started = false;
    for (let i = offset; i < Math.min(values.length,end); i++) {
      const value = values[i];
      if (value === null || !Number.isFinite(value)) { started = false; continue; }
      const x = left + step * (i - offset + 0.5), yy = y(value);
      if (!started) { ctx.moveTo(x, yy); started = true; } else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  function chartVisibleCount() {
    const range = $("chartRange")?.value || "200";
    if (range === "200") return Math.min(500,Math.max(10,Math.round(200*chartZoom)));
    if (range === "MAX") return Math.min(500,Math.max(10,Math.round(500*chartZoom)));
    const months = ({"1M":1,"3M":3,"6M":6,"1Y":12})[range] || 6;
    const barsPerMonth = ({"1m":8580,"5m":1716,"15m":572,"30m":286,"1h":154,"2h":88,"4h":44,"1d":21,"1w":4.3,"1mo":1})[selectedInterval] || 21;
    return Math.min(500, Math.max(10, Math.round(months * barsPerMonth * chartZoom)));
  }
  function heikinBars(bars) {
    let previousOpen=null, previousClose=null;
    return bars.map(bar=>{
      const o=Number(bar.o),h=Number(bar.h),l=Number(bar.l),c=Number(bar.c);
      const close=(o+h+l+c)/4;
      const open=previousOpen===null?(o+c)/2:(previousOpen+previousClose)/2;
      const high=Math.max(h,open,close),low=Math.min(l,open,close);
      previousOpen=open;previousClose=close;
      return {...bar,o:open,h:high,l:low,c:close};
    });
  }
  function drawChart(bars) {
    const canvas = $("priceChart"); if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), width = Math.max(320, rect.width), height = Math.max(220, rect.height), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#08140f"; ctx.fillRect(0, 0, width, height);
    if (!bars.length) { ctx.fillStyle = "#81988c"; ctx.font = "12px DM Sans"; ctx.fillText("No verified candles available for this request.", 18, 32); return; }
    const chartBars = chartStyle === "heikin" ? heikinBars(bars) : bars;
    const windowRange=getChartWindow(bars.length),visible=chartBars.slice(windowRange.start,windowRange.end),offset=windowRange.start;
    const closes = bars.map(x => Number(x.c));
    const resetVwap = !["1d", "1w", "1mo"].includes(selectedInterval);
    const overlays = [
      ["ema5", movingAverage(closes, 5, true), "#f0b24b"],
      ["ema10", movingAverage(closes, 10, true), "#f3d275"],
      ["ema20", movingAverage(closes, 20, true), "#e9bd68"],
      ["ema40", movingAverage(closes, 40, true), "#d59c65"],
      ["ema50", movingAverage(closes, 50, true), "#63b8c8"],
      ["ema200", movingAverage(closes, 200, true), "#b69cff"],
      ["hma32", hullMovingAverage(closes, 32), "#ff8bba"],
      ["vwap", vwapSeries(bars, resetVwap), "#f0f4f1"]
    ];
    let max = Math.max(...visible.map(x => Number(x.h))), min = Math.min(...visible.map(x => Number(x.l)));
    for (const [key, series] of overlays) {
      if (!$("indicator-" + key)?.checked) continue;
      for (const value of series.slice(offset,windowRange.end)) if (Number.isFinite(value)) { max = Math.max(max, value); min = Math.min(min, value); }
    }
    const pad = (max - min) * .08 || 1; max += pad; min -= pad;
    const left = 12, right = 64, top = 16, bottom = 28, plotW = width - left - right, plotH = height - top - bottom;
    const y = v => top + (max - v) / (max - min) * plotH;
    ctx.strokeStyle = "#1b3027"; ctx.lineWidth = 1; ctx.fillStyle = "#789084"; ctx.font = "9px DM Mono";
    for (let i = 0; i <= 4; i++) {
      const yy = top + plotH * i / 4; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(width - right, yy); ctx.stroke();
      const value = max - (max - min) * i / 4; ctx.fillText(value.toFixed(value < 10 ? 3 : 2), width - right + 7, yy + 3);
    }
    const step = plotW / visible.length, candleW = Math.max(1, Math.min(9, step * .62));
    if (chartStyle === "line") {
      drawLine(ctx, visible.map(bar => Number(bar.c)), 0, step, left, y, "#72e6a5", 2);
    } else {
      visible.forEach((bar, i) => {
        const x = left + step * (i + .5), open = y(Number(bar.o)), close = y(Number(bar.c)), high = y(Number(bar.h)), low = y(Number(bar.l));
        const up = Number(bar.c) >= Number(bar.o); ctx.strokeStyle = up ? "#72e6a5" : "#ef7777"; ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath(); ctx.moveTo(x, high); ctx.lineTo(x, low); ctx.stroke();
        ctx.fillRect(x - candleW / 2, Math.min(open, close), candleW, Math.max(1, Math.abs(close - open)));
      });
    }
    for (const [key, series, color] of overlays) if ($("indicator-" + key)?.checked) drawLine(ctx, series, offset, step, left, y, color, key === "vwap" ? 1.8 : 1.35, windowRange.end);
    const optionMarkers = Array.isArray(window.ROLYFE_OPTION_MARKERS) ? window.ROLYFE_OPTION_MARKERS : [];
    for (const marker of optionMarkers) {
      const entry = Number(marker.underlying_entry);
      const stamp = Date.parse(marker.trade_date || "");
      if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stamp)) continue;
      let nearest = 0, best = Infinity;
      const latestVisibleMs = dateValue(visible[visible.length-1].t).getTime();
      if(stamp>latestVisibleMs)continue;
      visible.forEach((bar, index) => {
        const barMs = dateValue(bar.t).getTime();
        const delta = Math.abs(barMs - stamp);
        if (delta < best) { best = delta; nearest = index; }
      });
      const x = left + step * (nearest + .5);
      ctx.save(); ctx.strokeStyle = "#f0b24b"; ctx.fillStyle = "#f0b24b"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, height - bottom); ctx.stroke(); ctx.setLineDash([]);
      if (entry >= min && entry <= max) {
        const yy = y(entry); ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(width - right, yy); ctx.stroke();
        ctx.font = "9px DM Mono"; ctx.fillText("OPTION ENTRY " + entry.toFixed(2), left + 5, Math.max(top + 10, yy - 5));
      }
      ctx.font = "9px DM Mono"; ctx.fillText((marker.contract_type || "OPTION").toUpperCase() + " ENTRY", Math.min(x + 5, width - right - 90), top + 12);
      ctx.restore();
    }
    ctx.fillStyle = "#789084"; ctx.font = "9px DM Mono"; ctx.fillText(dateValue(visible[0].t).toLocaleDateString(), left, height - 8);
    ctx.textAlign = "right"; ctx.fillText(dateValue(visible[visible.length - 1].t).toLocaleDateString(), width - right, height - 8); ctx.textAlign = "left";
  }
  document.addEventListener("rolyfe:execution-markers", () => drawChart(currentBars));

  function drawPane(canvasId, bars, series, min, max, levels = [], histogram = false) {
    const canvas = $(canvasId); if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), width = Math.max(250, rect.width), height = Math.max(90, rect.height), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#08140f"; ctx.fillRect(0, 0, width, height);
    if (!bars.length) { ctx.fillStyle = "#81988c"; ctx.font = "10px DM Sans"; ctx.fillText("Waiting for provider candles", 10, 22); return; }
    const windowRange=getChartWindow(bars.length),count=windowRange.count,offset=windowRange.start,end=windowRange.end,plotLeft = 8, plotRight = 8, plotTop = 9, plotBottom = 9;
    const plotW = width - plotLeft - plotRight, plotH = height - plotTop - plotBottom, step = plotW / count;
    const y = value => plotTop + (max - value) / (max - min) * plotH;
    ctx.strokeStyle = "#1b3027"; ctx.lineWidth = 1; ctx.fillStyle = "#789084"; ctx.font = "8px DM Mono";
    levels.forEach(level => { const yy = y(level); ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.moveTo(plotLeft, yy); ctx.lineTo(width - plotRight, yy); ctx.stroke(); ctx.setLineDash([]); });
    for (const item of series) {
      if (histogram && item.type === "bars") {
        const zero = y(0);
        for (let i = offset; i < end; i++) {
          const value = item.values[i]; if (value === null || !Number.isFinite(value)) continue;
          ctx.fillStyle = value >= 0 ? "#72e6a5" : "#ef7777";
          const x = plotLeft + step * (i - offset + .2), yy = y(value);
          ctx.fillRect(x, Math.min(yy, zero), Math.max(1, step * .6), Math.max(1, Math.abs(zero - yy)));
        }
      } else drawLine(ctx, item.values, offset, step, plotLeft, y, item.color, item.width || 1.3, end);
    }
  }
  function lastValueText(values, suffix = "") {
    for (let i = values.length - 1; i >= 0; i--) if (Number.isFinite(values[i])) return Number(values[i]).toFixed(2) + suffix;
    return "—";
  }
  function drawIndicatorPanels(bars) {
    const enabled = key => Boolean($("indicator-" + key)?.checked);
    const panes = [
      ["rsiPane", "rsi14", "rsiChart"],
      ["macdPane", "macd", "macdChart"],
      ["stochPane", "stoch", "stochChart"]
    ];
    panes.forEach(([paneId, controlId]) => { const pane = $(paneId); if (pane) pane.hidden = !enabled(controlId); });
    const closes = bars.map(x => Number(x.c));
    if (enabled("rsi14")) {
      const rsi = rsiSeries(closes, 14);
      drawPane("rsiChart", bars, [{ values: rsi, color: "#e9bd68", width: 1.6 }], 0, 100, [30, 50, 70]);
      $("rsiValue").textContent = lastValueText(rsi);
    }
    if (enabled("macd")) {
      const macd = macdSeries(closes);
      const vals = [...macd.line, ...macd.signal, ...macd.histogram].filter(Number.isFinite);
      const extent = Math.max(0.01, ...vals.map(x => Math.abs(x))) * 1.15;
      drawPane("macdChart", bars, [
        { values: macd.histogram, type: "bars" },
        { values: macd.line, color: "#e9bd68" },
        { values: macd.signal, color: "#63b8c8" }
      ], -extent, extent, [0], true);
      $("macdValue").textContent = lastValueText(macd.line) + " / " + lastValueText(macd.signal);
    }
    if (enabled("stoch")) {
      const stoch = stochasticSeries(bars, 14, 3);
      drawPane("stochChart", bars, [
        { values: stoch.k, color: "#e9bd68", width: 1.5 },
        { values: stoch.d, color: "#63b8c8", width: 1.3 }
      ], 0, 100, [20, 50, 80]);
      $("stochValue").textContent = lastValueText(stoch.k) + " / " + lastValueText(stoch.d);
    }
  }
  function stopReplay() {
    if(replayTimer){clearInterval(replayTimer);replayTimer=null;}
    if($("replayToggle"))$("replayToggle").textContent="▶ Play";
  }
  function replayBars() { return replayIndex>=0?currentBars.slice(0,replayIndex+1):currentBars; }
  function updateReplayUI() {
    const slider=$("replaySlider");if(!slider)return;
    slider.min="0";slider.max=String(Math.max(0,currentBars.length-1));
    slider.value=String(Math.max(0,replayIndex));
    slider.disabled=currentBars.length<2;
    const count=replayIndex+1;
    $("replayProgress").textContent=count+" / "+currentBars.length+" bars";
    $("replayDate").textContent=count?dateValue(currentBars[count-1].t).toLocaleString():"No replay data";
  }
  function renderMarketHealth(bars) {
    const result=calculateMarketHealth(bars,selectedInterval);
    const score=$("healthScore"),label=$("healthLabel"),coverage=$("healthCoverage"),gauge=$("healthGauge");
    if(!score||!label||!coverage||!gauge)return;
    if(result.score===null){score.textContent="—";label.textContent="Waiting for more candles";coverage.textContent="Load a symbol with sufficient provider data.";gauge.style.setProperty("--health-angle","0deg");$("healthSignals").innerHTML='<span>EMA alignment · RSI · MACD · VWAP · volume</span>';return;}
    score.textContent=String(result.score);label.textContent=result.label;coverage.textContent="Input coverage "+result.confidence+"% · "+selectedChartSymbol+" · "+selectedInterval;
    gauge.style.setProperty("--health-angle",(result.score*3.6)+"deg");
    $("healthSignals").innerHTML=result.signals.map(x=>'<div class="health-signal"><span>'+safe(x.name)+'</span><b>'+safe(x.detail)+' · '+x.points+'/'+x.weight+' pts</b></div>').join("");
  }
  function drawFundamentalsChart(rows) {
    const canvas=$("fundamentalsChart");if(!canvas)return;
    const rect=canvas.getBoundingClientRect(),w=Math.max(300,rect.width),h=220,dpr=window.devicePixelRatio||1;
    canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);
    const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle="#08140f";ctx.fillRect(0,0,w,h);
    if(!rows.length){ctx.fillStyle="#81988c";ctx.font="12px DM Sans";ctx.fillText("No reported cash-flow periods available.",14,28);return;}
    const series=[["operatingCashFlow","Operating cash flow","#72e6a5"],["capitalExpenditures","CAPEX","#f0b24b"],["freeCashFlow","Free cash flow","#63b8c8"]];
    const values=rows.flatMap(r=>series.map(s=>r[s[0]])).filter(v=>Number.isFinite(v));
    const max=Math.max(0,...values),min=Math.min(0,...values),extent=Math.max(Math.abs(max),Math.abs(min),1);
    const left=12,right=10,top=16,bottom=38,plotH=h-top-bottom,zero=top+(max/((max-min)||1))*plotH;
    ctx.strokeStyle="#294238";ctx.beginPath();ctx.moveTo(left,zero);ctx.lineTo(w-right,zero);ctx.stroke();
    const groupW=(w-left-right)/rows.length,barW=Math.max(2,Math.min(12,groupW*.2));
    rows.forEach((row,i)=>series.forEach((s,j)=>{
      const v=row[s[0]];if(!Number.isFinite(v))return;
      const x=left+groupW*(i+.5)+(j-1)*(barW+2),y=top+(max-v)/((max-min)||1)*plotH;
      ctx.fillStyle=s[2];ctx.fillRect(x-barW/2,Math.min(y,zero),barW,Math.max(1,Math.abs(zero-y)));
    }));
    ctx.fillStyle="#9ab0a4";ctx.font="9px DM Mono";ctx.textAlign="center";
    rows.forEach((r,i)=>ctx.fillText(r.period.slice(0,7),left+groupW*(i+.5),h-12));
    ctx.textAlign="left";
  }
  function renderFundamentals(payload) {
    currentFundamentals=payload;
    const rows=normalizeCashFlowReports($("fundamentalPeriod")?.value==="annual"?payload.annualReports:payload.quarterlyReports);
    const company=payload.company;
    $("companyDescription").textContent=company?.description?company.description:payload.error||"Company description is not available from the connected provider.";
    if(company){
      const meta=[company.name,company.sector,company.industry,company.exchange].filter(Boolean).join(" · ");
      $("fundamentalSymbol").textContent=meta||payload.symbol;
    } else $("fundamentalSymbol").textContent=payload.symbol+" · company profile unavailable";
    $("fundamentalsBody").innerHTML=rows.length?[...rows].reverse().map(r=>'<tr><td>'+safe(r.period)+'</td><td>'+(r.operatingCashFlow===null?"—":money(r.operatingCashFlow))+'</td><td>'+(r.capitalExpenditures===null?"—":money(r.capitalExpenditures))+'</td><td>'+(r.freeCashFlow===null?"—":money(r.freeCashFlow))+'</td></tr>').join(""):'<tr><td colspan="4" class="empty-cell">Provider returned no usable cash-flow periods.</td></tr>';
    drawFundamentalsChart(rows.slice(-8));
    $("fundamentalStatus").textContent=(payload.note||"Source: "+(payload.provider||"provider")+" · Financial data availability depends on provider coverage and plan entitlement.")+(payload.retrievedAt?" · Retrieved "+dateValue(payload.retrievedAt).toLocaleString():"");
  }
  async function loadFundamentals() {
    const symbol=selectedChartSymbol;
    if(!symbol){$("fundamentalStatus").textContent="Select a stock or ETF chart symbol first.";return;}
    if(fundamentalsCache.has(symbol)){renderFundamentals(fundamentalsCache.get(symbol));return;}
    $("loadFundamentals").disabled=true;$("fundamentalStatus").textContent="Requesting company overview and cash-flow statements…";
    try{
      const {data:{session:active}}=await supabase.auth.getSession();
      if(!active?.access_token)throw new Error("Sign-in session expired. Sign in again.");
      const url=MARKET_DATA_URL+"?provider=alphavantage-fundamentals&symbol="+encodeURIComponent(symbol);
      const response=await fetch(url,{headers:{"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+active.access_token,"Accept":"application/json"}});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Company fundamentals are not available.");
      fundamentalsCache.set(symbol,payload);renderFundamentals(payload);
    }catch(error){$("fundamentalStatus").textContent=error.message||"Fundamental data is unavailable. Check Alpha Vantage access and server-side configuration.";}
    finally{$("loadFundamentals").disabled=false;}
  }
  function redrawChartAndPanels() {
    const bars=replayBars();drawChart(bars);drawIndicatorPanels(bars);renderMarketHealth(bars);updateReplayUI();
  }
  $("chartStyle").addEventListener("change",()=>{chartStyle=$("chartStyle").value;redrawChartAndPanels();});
  $("replaySlider").addEventListener("input",()=>{stopReplay();replayIndex=Number($("replaySlider").value);redrawChartAndPanels();});
  $("replayToggle").addEventListener("click",()=>{
    if(replayTimer){stopReplay();return;}
    if(currentBars.length<2)return;
    if(replayIndex>=currentBars.length-1)replayIndex=0;
    $("replayToggle").textContent="Ⅱ Pause";
    replayTimer=setInterval(()=>{
      if(replayIndex<currentBars.length-1){replayIndex++;redrawChartAndPanels();}
      if(replayIndex>=currentBars.length-1)stopReplay();
    },Number($("replaySpeed").value)||600);
    redrawChartAndPanels();
  });
  $("replayReset").addEventListener("click",()=>{stopReplay();replayIndex=currentBars.length-1;chartPanOffset=0;redrawChartAndPanels();});
  $("replaySpeed").addEventListener("change",()=>{if(replayTimer){stopReplay();$("replayToggle").click();}});
  function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
  function getChartWindow(total) {
    if(!total)return {start:0,end:0,count:0};
    const count=Math.min(total,chartVisibleCount());
    const maxPan=Math.max(0,total-count);
    chartPanOffset=clamp(chartPanOffset,0,maxPan);
    const end=total-Math.round(chartPanOffset);
    const start=Math.max(0,end-count);
    return {start,end,count:end-start};
  }
  function zoomChartAt(multiplier,ratio=.5) {
    if(!currentBars.length)return;
    const oldWindow=getChartWindow(currentBars.length);
    const anchor=oldWindow.start+oldWindow.count*clamp(ratio,0,1);
    chartZoom=clamp(chartZoom*multiplier,.25,5);
    const nextCount=Math.min(currentBars.length,chartVisibleCount());
    const nextStart=anchor-nextCount*clamp(ratio,0,1);
    chartPanOffset=clamp(currentBars.length-(nextStart+nextCount),0,currentBars.length-nextCount);
    redrawChartAndPanels();
  }
  $("zoomIn").addEventListener("click",()=>zoomChartAt(.8));
  $("zoomOut").addEventListener("click",()=>zoomChartAt(1.25));
  $("zoomReset").addEventListener("click",()=>{chartZoom=1;chartPanOffset=0;redrawChartAndPanels();});
  const interactiveChart=$("priceChart"),chartPointers=new Map();
  let chartDragSession=null,chartPinchSession=null;
  function chartXRatio(clientX){
    const rect=interactiveChart.getBoundingClientRect(),left=12,right=64,plotWidth=Math.max(1,rect.width-left-right);
    return clamp((clientX-rect.left-left)/plotWidth,0,1);
  }
  function chartPinchDistance(){
    const points=[...chartPointers.values()];
    if(points.length<2)return 0;
    return Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
  }
  function beginChartPinch(){
    const points=[...chartPointers.values()];if(points.length<2||!currentBars.length)return;
    const middle=(points[0].x+points[1].x)/2,ratio=chartXRatio(middle),windowNow=getChartWindow(currentBars.length);
    chartPinchSession={distance:Math.max(1,chartPinchDistance()),zoom:chartZoom,ratio,anchor:windowNow.start+windowNow.count*ratio};
    chartDragSession=null;
  }
  interactiveChart.addEventListener("pointerdown",event=>{
    if(event.pointerType==="mouse"&&event.button!==0)return;
    interactiveChart.setPointerCapture?.(event.pointerId);
    chartPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(chartPointers.size===1)chartDragSession={x:event.clientX,pan:chartPanOffset,count:getChartWindow(currentBars.length).count};
    else if(chartPointers.size===2)beginChartPinch();
  });
  interactiveChart.addEventListener("pointermove",event=>{
    if(!chartPointers.has(event.pointerId))return;
    chartPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(chartPointers.size>=2&&chartPinchSession&&currentBars.length){
      const points=[...chartPointers.values()],distance=Math.max(1,chartPinchDistance()),ratio=chartXRatio((points[0].x+points[1].x)/2);
      chartZoom=clamp(chartPinchSession.zoom*chartPinchSession.distance/distance,.25,5);
      const nextCount=Math.min(currentBars.length,chartVisibleCount()),nextStart=chartPinchSession.anchor-nextCount*ratio;
      chartPanOffset=clamp(currentBars.length-(nextStart+nextCount),0,currentBars.length-nextCount);
      redrawChartAndPanels();
    }else if(chartPointers.size===1&&chartDragSession&&currentBars.length){
      const rect=interactiveChart.getBoundingClientRect(),plotWidth=Math.max(1,rect.width-12-64);
      const moved=event.clientX-chartDragSession.x,barsPerPixel=chartDragSession.count/plotWidth;
      chartPanOffset=clamp(chartDragSession.pan+moved*barsPerPixel,0,currentBars.length-chartDragSession.count);
      redrawChartAndPanels();
    }
  });
  function endChartPointer(event){
    chartPointers.delete(event.pointerId);
    if(chartPointers.size>=2)beginChartPinch();
    else if(chartPointers.size===1){
      const remaining=[...chartPointers.values()][0];
      chartDragSession={x:remaining.x,pan:chartPanOffset,count:getChartWindow(currentBars.length).count};
      chartPinchSession=null;
    }else{chartDragSession=null;chartPinchSession=null;}
  }
  interactiveChart.addEventListener("pointerup",endChartPointer);
  interactiveChart.addEventListener("pointercancel",endChartPointer);
  interactiveChart.addEventListener("wheel",event=>{
    if(!currentBars.length)return;
    event.preventDefault();
    zoomChartAt(event.deltaY>0?1.18:.85,chartXRatio(event.clientX));
  },{passive:false});
  $("chartSnapshot").addEventListener("click",()=>{
    const canvas=$("priceChart");if(!canvas||!currentBars.length)return;
    canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=(selectedChartSymbol||"rolyfe-chart")+"-"+selectedInterval+"-snapshot.png";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},"image/png");
  });
  $("exportFundamentals").addEventListener("click",()=>{
    if(!currentFundamentals)return;
    const rows=normalizeCashFlowReports($("fundamentalPeriod").value==="annual"?currentFundamentals.annualReports:currentFundamentals.quarterlyReports);
    if(!rows.length)return;
    const fields=["period","operatingCashFlow","capitalExpenditures","freeCashFlow"];
    const csv=[fields.join(","),...rows.map(row=>fields.map(key=>String(row[key]??"")).join(","))].join(String.fromCharCode(10));
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=(selectedChartSymbol||"company")+"-cash-flow.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $("loadFundamentals").addEventListener("click",loadFundamentals);
  $("fundamentalPeriod").addEventListener("change",()=>{if(currentFundamentals)renderFundamentals(currentFundamentals);});

  async function loadChart() {
    if(!userId)return;
    const item=getMarketItem(selectedChartSymbol);
    stopReplay();
    if(!item){currentBars=[];replayIndex=-1;chartPanOffset=0;$("chartStatus").textContent="Choose a symbol from your watchlist or the RTIC market library.";drawChart([]);drawIndicatorPanels([]);renderMarketHealth([]);updateReplayUI();$("fundamentalSymbol").textContent="Select a stock or ETF";return;}
    $("chartStatus").textContent="Loading "+item.symbol+" · "+selectedInterval+" candles…";
    const range=$("chartRange")?.value||"200",months=range==="200"?null:({"1M":1,"3M":3,"6M":6,"1Y":12})[range],warmupMonths=months?months+12:0,fromDate=warmupMonths&&!["1w","1mo"].includes(selectedInterval)?new Date(Date.now()-warmupMonths*30.4375*86400000).toISOString().slice(0,10):"",symbol=tickerbotSymbol(item),url=MARKET_DATA_URL+"?provider=tickerbot&symbol="+encodeURIComponent(symbol)+"&interval="+selectedInterval+"&limit=1000&session=all"+(fromDate?"&from="+fromDate:"");
    try{
      const {data:{session:active}}=await supabase.auth.getSession();
      const response=await fetch(url,{headers:{"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+active.access_token,"Accept":"application/json"}});
      const payload=await response.json();
      if(!response.ok||!Array.isArray(payload.bars)){currentBars=[];replayIndex=-1;drawChart([]);drawIndicatorPanels([]);renderMarketHealth([]);updateReplayUI();$("chartStatus").textContent=payload.error||"Historical data is not available for this symbol/timeframe.";return;}
      currentBars=[...payload.bars].filter(b=>[b.o,b.h,b.l,b.c].every(v=>Number.isFinite(Number(v)))&&Number.isFinite(dateValue(b.t).getTime())).sort((a,b)=>dateValue(a.t).getTime()-dateValue(b.t).getTime());
      replayIndex=currentBars.length-1;redrawChartAndPanels();
      $("fundamentalSymbol").textContent=item.symbol+" · click Load financials";
      const visibleCount=Math.min(chartVisibleCount(),currentBars.length);
      $("chartStatus").textContent=item.symbol+" · "+selectedInterval.toUpperCase()+" · Showing "+visibleCount+" of "+currentBars.length+" candles · "+(payload.provider||"unknown provider");
      $("chartFootnote").textContent="Source: "+(payload.provider||"provider")+" · As of "+(payload.asOf||"provider timestamp not supplied")+" · Coverage: "+(payload.coverage||"provider response")+". Indicator overlays are calculated from returned closes.";
    }catch{currentBars=[];replayIndex=-1;drawChart([]);drawIndicatorPanels([]);renderMarketHealth([]);updateReplayUI();$("chartStatus").textContent="Could not reach the secure historical-data service.";}
  }
  $("chartSymbol").addEventListener("change",()=>{selectedChartSymbol=$("chartSymbol").value;chartPanOffset=0;chartZoom=1;currentFundamentals=null;$("companyDescription").textContent="Load financials to retrieve the selected company profile.";syncActiveInstrument(getMarketItem(selectedChartSymbol));loadChart();});
  document.querySelectorAll("[data-interval]").forEach(b=>b.addEventListener("click",()=>{selectedInterval=b.dataset.interval;chartPanOffset=0;chartZoom=1;document.querySelectorAll("[data-interval]").forEach(x=>x.classList.toggle("active",x===b));loadChart();}));
  $("chartRange").addEventListener("change",()=>{chartPanOffset=0;chartZoom=1;loadChart();});
  $("chartStyle").value=chartStyle;
  document.querySelectorAll("[data-indicator]").forEach(b=>b.addEventListener("change",()=>redrawChartAndPanels()));
  window.addEventListener("resize",()=>{if(currentBars.length)redrawChartAndPanels();if(currentFundamentals)renderFundamentals(currentFundamentals);if(studyBars.length)drawStudyChart(studyBars);});

  async function runScanner() {
    const universe=$("scanAsset").value;
    const groups=[];
    if(universe.startsWith("sector:")){
      const sector=MARKET_SECTOR_GROUP_BY_ID.get(universe.slice(7));
      if(sector)groups.push({assetClass:sector.assetClass,items:sector.symbols.map(symbol=>MARKET_LIBRARY_BY_SYMBOL.get(symbol)).filter(Boolean),label:sector.label});
    }else if(universe==="watchlist"){
      const stocks=watchlist.filter(item=>item.type==="Stock"||item.type==="ETF");
      const crypto=watchlist.filter(item=>item.type==="Crypto");
      if(stocks.length)groups.push({assetClass:"stocks",items:stocks,label:"My Watchlist stocks/ETFs"});
      if(crypto.length)groups.push({assetClass:"crypto",items:crypto,label:"My Watchlist crypto"});
    }else if(universe==="all"){
      groups.push({assetClass:"stocks",items:MARKET_LIBRARY.stocks,label:"RTIC stocks and ETFs"});
      groups.push({assetClass:"crypto",items:MARKET_LIBRARY.crypto,label:"RTIC crypto"});
    }else if(universe==="etfs"){
      groups.push({assetClass:"stocks",items:MARKET_LIBRARY.stocks.filter(item=>item.type==="ETF"),label:"RTIC ETFs"});
    }else if(universe==="crypto"){
      groups.push({assetClass:"crypto",items:MARKET_LIBRARY.crypto,label:"RTIC crypto"});
    }else{
      groups.push({assetClass:"stocks",items:MARKET_LIBRARY.stocks,label:"RTIC stocks and ETFs"});
    }
    const totalRequested=groups.reduce((sum,group)=>sum+group.items.length,0);
    if(!totalRequested){$("scannerStatus").textContent="Your personal watchlist is empty. Add favorites or choose an RTIC library universe.";return;}
    $("runScanner").disabled=true;$("runScanner").textContent="Scanning…";
    $("scannerStatus").textContent="Requesting verified Tickerbot scan data for "+totalRequested+" symbols…";
    $("scannerBody").innerHTML='<tr><td colspan="8" class="empty-cell">Scanner is running. Results will appear here when the provider responds.</td></tr>';
    try{
      const {data:{session:active}}=await supabase.auth.getSession();
      if(!active?.access_token)throw new Error("Your secure session expired. Sign in again to scan.");
      const allResults=[],notFound=[];
      for(const group of groups){
        const symbols=group.items.map(tickerbotSymbol);
        for(let start=0;start<symbols.length;start+=100){
          const batch=symbols.slice(start,start+100);
          const url=MARKET_DATA_URL+"?provider=tickerbot-scan&asset_class="+group.assetClass+"&symbols="+encodeURIComponent(batch.join(","))+"&limit="+batch.length;
          const response=await fetch(url,{headers:{"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+active.access_token,"Accept":"application/json"}});
          const payload=await response.json();
          if(!response.ok)throw new Error(payload.error||"Tickerbot scanner returned HTTP "+response.status);
          if(Array.isArray(payload.results))allResults.push(...payload.results);
          if(Array.isArray(payload.notFound))notFound.push(...payload.notFound);
        }
      }
      const fmt=value=>value===null||value===undefined||value===""?"—":Number.isFinite(Number(value))?Number(value).toFixed(2):safe(String(value));
      const rows=[...allResults].sort((a,b)=>Number(b.relative_volume||0)-Number(a.relative_volume||0));
      $("scannerBody").innerHTML=rows.length?rows.map(item=>{
        const ticker=String(item.ticker||item.symbol||"—");
        return '<tr><td><b>'+safe(ticker)+'</b></td><td>'+fmt(item.price)+'</td><td>'+fmt(item.rsi_14)+'</td><td>'+fmt(item.relative_volume)+'</td><td>'+fmt(item.macd_histogram)+'</td><td>'+fmt(item.adx_14)+'</td><td>'+((item.above_vwap===true)?"YES":(item.above_vwap===false)?"NO":"—")+'</td><td><button type="button" class="table-action" data-scan-chart="'+safe(ticker)+'">Chart ↗</button></td></tr>';
      }).join(""):'<tr><td colspan="8" class="empty-cell">The provider returned no scan matches for these symbols.</td></tr>';
      $("scannerStatus").textContent="Tickerbot returned "+rows.length+" rows from "+totalRequested+" requested symbols · "+notFound.length+" not found · "+new Date().toLocaleTimeString()+" request time. Provider timestamps and indicator coverage vary.";
      $("scannerBody").querySelectorAll("[data-scan-chart]").forEach(button=>button.addEventListener("click",()=>{
        const raw=button.dataset.scanChart;
        const normalized=raw.replace(/^X:/,"").replace(/USD$/,"");
        const match=allChartItems().find(item=>tickerbotSymbol(item)===raw || tickerbotSymbol(item).replace(/^X:/,"").replace(/USD$/,"")===normalized || item.symbol===raw);
        openChartForSymbol(match?.symbol||raw);
      }));
    }catch(error){
      $("scannerBody").innerHTML='<tr><td colspan="8" class="empty-cell">'+safe(error.message||"Scanner did not return verified results.")+'</td></tr>';
      $("scannerStatus").textContent="Scan not completed. No estimated scan results were displayed.";
    }finally{$("runScanner").disabled=false;$("runScanner").textContent="Run scan";}
  }
  $("runScanner").addEventListener("click",runScanner);

  const scannerPanelUrls={
    sector:"https://rolrichman.github.io/RO-Lyfe-Live-Sports-Center/?embed=market-lab",
    tactical:"https://rolrichman.github.io/RO-Lyfe-Tactical-Intelligence-Center-/rtic-scanner.js/?embed=desk"
  };
  $("loadScannerPanel").addEventListener("click",()=>{
    const url=scannerPanelUrls[$("scannerPanelChoice").value];
    if(!url)return;
    $("scannerPanelFrame").src=url;
    $("scannerEmbedWrap").hidden=false;
  });
  $("closeScannerPanel").addEventListener("click",()=>{
    $("scannerEmbedWrap").hidden=true;
    $("scannerPanelFrame").removeAttribute("src");
  });


  function appendAtlas(text,role) {
    const node=document.createElement("div");node.className="atlas-message "+role;node.textContent=text;
    $("atlasConversation").appendChild(node);$("atlasConversation").scrollTop=$("atlasConversation").scrollHeight;
    return node;
  }
  async function sendAtlas(e) {
    e.preventDefault();const question=$("atlasInput").value.trim();if(!question)return;
    $("atlasInput").value="";appendAtlas(question,"user");
    const pending=appendAtlas("Reviewing the supplied desk context…","assistant loading");
    $("atlasSend").disabled=true;$("atlasStatus").textContent="ATLAS IS THINKING";
    try{
      const {data:{session:active}}=await supabase.auth.getSession();
      const replayWindow=replayBars();
      const replayActive=currentBars.length>0&&replayIndex<currentBars.length-1;
      const marketContext=replayActive?"Historical replay is active; live quote cache is suppressed to avoid look-ahead.":watchlist.map(x=>{const q=quoteCache.get(x.symbol);return x.symbol+" ("+x.type+"): "+(q&&!q.error?"price "+q.price+", change "+q.changePercent+"%, source "+q.provider:"quote unavailable/not verified");}).join("\n");
      const replayCutoff=replayWindow.length?dateValue(replayWindow[replayWindow.length-1].t).getTime():Infinity;
      const visibleTrades=replayActive?journal.filter(t=>new Date(t.date).getTime()<=replayCutoff):journal;
      const tradeContext=visibleTrades.slice(-10).map(t=>t.symbol+" "+t.side+" entry "+t.entry+" stop "+t.stop+" size "+t.qty+" status "+t.status+(t.status==="Closed"?" P/L "+t.pnl:"")).join("\n");
      const chartContext=replayWindow.length?"Chart selected "+selectedChartSymbol+" timeframe "+selectedInterval+"; "+replayWindow.length+" bars visible through "+dateValue(replayWindow[replayWindow.length-1].t).toLocaleDateString()+"; last visible close "+replayWindow[replayWindow.length-1].c+(replayActive?" (historical replay; future candles excluded).":"."):"No chart bars loaded.";
      const health=calculateMarketHealth(replayBars(),selectedInterval);
      const healthContext=health.score===null?"Technical health score unavailable.":"Technical health score "+health.score+"/100 ("+health.label+"), input coverage "+health.confidence+"%; "+health.signals.map(x=>x.name+": "+x.detail).join("; ");
      const fundamentalsContext=replayActive?"Company fundamentals are omitted during historical replay to avoid using later-reported information.":currentFundamentals?.company?"Company "+currentFundamentals.company.name+"; sector "+(currentFundamentals.company.sector||"not reported")+"; description "+(currentFundamentals.company.description||"not reported"):"No company fundamentals loaded.";
      const context="RO’Lyfe Personal Trading Desk.\nWATCHLIST / VERIFIED QUOTES:\n"+(marketContext||"No watchlist symbols.")+"\n\nRECENT PAPER JOURNAL:\n"+(tradeContext||"No paper trades.")+"\n\nCHART DATA:\n"+chartContext+"\n\nTECHNICAL HEALTH:\n"+healthContext+"\n\nCOMPANY FUNDAMENTALS:\n"+fundamentalsContext+"\n\nNo brokerage connection; paper mode only.";
      const response=await fetch(SUPABASE_URL+"/functions/v1/rol-trading-ai",{method:"POST",headers:{"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+active.access_token,"Content-Type":"application/json"},body:JSON.stringify({action:"analyze",question,context,sidekickMode:"analyst"})});
      const payload=await response.json();pending.remove();
      if(!response.ok||!payload.answer)throw new Error(payload.error||"Atlas could not complete the request.");
      appendAtlas(payload.answer,"assistant");$("atlasStatus").textContent="ATLAS CONNECTED · "+(payload.model||"AI");
    }catch(err){pending.remove();appendAtlas(err.message||"Atlas connection unavailable.","assistant");$("atlasStatus").textContent="AI SERVICE NEEDS ATTENTION";}
    finally{$("atlasSend").disabled=false;}
  }
  $("atlasForm").addEventListener("submit",sendAtlas);

  async function fetchQuote(item) {
    const apiSymbol=String(item.api||item.symbol).replace(/-USD$/,"").toUpperCase();
    const assetClass=item.type==="Crypto"?"crypto":"stocks";
    try {
      const {data:{session:active}}=await supabase.auth.getSession();
      if(!active?.access_token)return {error:"Sign-in session expired. Sign in again."};
      const headers={"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+active.access_token,"Accept":"application/json"};
      const request=async(provider,symbol)=>{
        const url=MARKET_DATA_URL+"?provider="+encodeURIComponent(provider)+"&symbol="+encodeURIComponent(symbol);
        const response=await fetch(url,{headers});
        const payload=await response.json().catch(()=>({}));
        return {ok:response.ok,payload};
      };
      const validPrice=value=>Number.isFinite(Number(value))&&Number(value)>0;
      const maybeNumber=value=>value===null||value===undefined||value===""||!Number.isFinite(Number(value))?null:Number(value);

      // Ask for an exchange/provider snapshot first so execution can use real bid/ask
      // when the selected venue supplies it. Last price is never relabeled as bid or ask.
      const snapshotProvider=item.type==="Crypto"?"coinbase-crypto-snapshot":"massive-stock-snapshot";
      try{
        const {ok,payload}=await request(snapshotProvider,apiSymbol);
        if(ok&&validPrice(payload.price)){
          const pct=maybeNumber(payload.changePercent);
          return {
            price:Number(payload.price),changePercent:pct,
            bid:maybeNumber(payload.bid),ask:maybeNumber(payload.ask),
            high:maybeNumber(payload.high),low:maybeNumber(payload.low),
            timestamp:payload.timestamp||payload.lastUpdatedAt||null,
            provider:payload.provider||(item.type==="Crypto"?"Coinbase Exchange":"Massive"),
            quoteMode:item.type==="Crypto"?"Coinbase Exchange spot snapshot":"Massive stock snapshot",
            quoteNote:payload.note||"Provider snapshot. Bid/ask fields are shown only when returned."
          };
        }
      }catch{}

      // Tickerbot's scan endpoint supports the full configured RTIC stock/ETF/crypto set.
      const scanUrl=MARKET_DATA_URL+"?provider=tickerbot-scan&asset_class="+assetClass+"&symbols="+encodeURIComponent(tickerbotSymbol(item))+"&limit=1";
      try{
        const response=await fetch(scanUrl,{headers});
        const payload=await response.json();
        const row=Array.isArray(payload.results)?payload.results.find(x=>validPrice(x.price)):null;
        if(response.ok&&row){
          const change=maybeNumber(row.change_1d_pct??row.changePercent??row.change_percent??row.change_pct);
          return {
            price:Number(row.price),changePercent:change,bid:null,ask:null,
            high:maybeNumber(row.high),low:maybeNumber(row.low),
            timestamp:row.quoteTimestamp||row.timestamp||payload.asOf||payload.retrievedAt||null,
            provider:payload.provider||"Tickerbot",quoteMode:"scanner snapshot",
            quoteNote:"Tickerbot scan snapshot. This response did not include an executable bid/ask."
          };
        }
      }catch{}

      // Retain the existing Finnhub / CoinGecko fallbacks for symbols covered by those feeds.
      const crypto=["BTC","ETH","SOL","XRP","LINK","HYPE","AVAX","DOGE"].includes(apiSymbol);
      const provider=item.type==="Crypto"?"coingecko":"finnhub";
      if(item.type!=="Crypto"||crypto){
        try{
          const {ok,payload}=await request(provider,apiSymbol);
          if(ok&&validPrice(payload.price)){
            const rawChange=provider==="coingecko"?payload.changePercent24h:payload.changePercent;
            return {
              price:Number(payload.price),changePercent:maybeNumber(rawChange),
              bid:null,ask:null,high:maybeNumber(payload.high),low:maybeNumber(payload.low),
              timestamp:payload.timestamp||payload.lastUpdatedAt||null,
              provider:payload.provider||provider,
              quoteMode:provider==="coingecko"?"CoinGecko spot snapshot":"Finnhub quote",
              quoteNote:"This provider response did not include a venue-level bid/ask."
            };
          }
        }catch{}
      }

      // A final, explicitly labeled real candle close is preferable to a fabricated quote.
      try{
        const historyUrl=MARKET_DATA_URL+"?provider=tickerbot&symbol="+encodeURIComponent(tickerbotSymbol(item))+"&interval=1m&limit=1&session=all";
        const historyResponse=await fetch(historyUrl,{headers});
        const history=await historyResponse.json();
        const bar=Array.isArray(history.bars)?history.bars.at(-1):null;
        if(historyResponse.ok&&bar&&validPrice(bar.c)){
          return {price:Number(bar.c),changePercent:null,bid:null,ask:null,high:null,low:null,timestamp:bar.t,provider:history.provider||"Tickerbot",quoteMode:"latest 1-minute bar close",quoteNote:"Latest 1-minute candle close only; not a live bid/ask."};
        }
      }catch{}
      return {error:"No verified quote returned for this symbol by the connected providers."};
    }catch{return {error:"Could not reach the secure market-data service."};}
  }
  async function refreshQuotes() {
    if (!userId) return;
    $("dataStatus").textContent="REFRESHING QUOTES";
    const items=[...watchlist];
    for (const item of items) {
      const result=await fetchQuote(item);
      quoteCache.set(item.symbol,result);
      if(activeInstrumentSymbol===item.symbol)renderActiveInstrumentQuote(item,result);
      renderWatchlist();
    }
    const failures=items.filter(x=>quoteCache.get(x.symbol)?.error).length;
    $("dataStatus").textContent=items.length?(failures?"PARTIAL DATA":"DATA CONNECTED"):"ADD WATCHLIST SYMBOLS";
    $("quoteUpdated").textContent=items.length?"Last checked "+new Date().toLocaleTimeString()+" · provider timestamps are displayed where supplied.":"Quotes will display their provider-reported timestamp when available.";
  }
  async function refreshActiveInstrumentQuote() {
    if(!userId||!activeInstrumentSymbol||watchlist.some(item=>item.symbol===activeInstrumentSymbol))return;
    const item=marketItemForSymbol(activeInstrumentSymbol);
    if(!item)return;
    const result=await fetchQuote(item);
    if(activeInstrumentSymbol!==item.symbol)return;
    quoteCache.set(item.symbol,result);
    renderActiveInstrumentQuote(item,result);
  }
  $("refreshQuotes").addEventListener("click",refreshQuotes);

  function renderJournal() {
    const closed=journal.filter(t=>t.status==="Closed");
    const pnl=closed.reduce((sum,t)=>sum+(Number(t.pnl)||0),0);
    const open=journal.filter(t=>t.status==="Open").length;
    $("metricTrades").textContent=journal.length; $("metricPnl").textContent=money(pnl);
    $("journalCount").textContent=journal.length; $("journalPnl").textContent=money(pnl); $("journalOpen").textContent=open;
    $("journalBody").innerHTML=journal.length?[...journal].reverse().map(t=>'<tr><td>'+new Date(t.date).toLocaleDateString()+'</td><td><b>'+safe(t.symbol)+'</b></td><td>'+safe(t.side)+'</td><td>'+money(t.entry)+'</td><td>'+money(t.stop)+'</td><td>'+Number(t.qty).toLocaleString()+'</td><td class="'+(t.status==="Open"?"status-open":"status-closed")+'">'+safe(t.status)+'</td><td>'+(t.status==="Open"?'<button class="table-action" data-close="'+safe(t.id)+'">Close</button>':'<span>'+money(t.pnl)+'</span>')+'</td></tr>').join(""):'<tr><td colspan="8" class="empty-cell">No paper trades recorded yet.</td></tr>';
    document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>closeTrade(b.dataset.close)));
  }
  function render(){renderWatchlist();renderJournal();renderCalendar();renderMarketLibrary();}

  function renderCalendar() {
    const today=new Date();today.setHours(0,0,0,0);
    const cutoff=new Date(today);cutoff.setDate(cutoff.getDate()-7);
    const visible=[...calendarEvents].filter(e=>new Date(e.date+"T00:00:00")>=cutoff).sort((a,b)=>(a.date+" "+(a.time||"00:00")).localeCompare(b.date+" "+(b.time||"00:00")));
    $("eventCount").textContent=calendarEvents.length+(calendarEvents.length===1?" EVENT":" EVENTS");
    $("calendarList").innerHTML=visible.length?visible.map(e=>{
      const date=new Date(e.date+"T00:00:00");
      const day=date.toLocaleDateString("en-US",{month:"short",day:"numeric"});
      const weekday=date.toLocaleDateString("en-US",{weekday:"short"});
      return '<div class="calendar-event"><div class="event-date"><b>'+safe(day)+'</b><small>'+safe(weekday)+'</small></div><div class="event-detail"><b>'+safe(e.title)+'</b><small>'+safe(e.type)+(e.symbol?" · "+safe(e.symbol):"")+(e.time?" · "+safe(e.time)+" ET":"")+'</small></div><button class="table-action remove-btn" data-event-remove="'+safe(e.id)+'">Remove</button></div>';
    }).join(""):'<div class="empty-state">No upcoming events. Add an earnings date, economic release, expiration, or personal reminder above.</div>';
    document.querySelectorAll("[data-event-remove]").forEach(b=>b.addEventListener("click",()=>{calendarEvents=calendarEvents.filter(e=>e.id!==b.dataset.eventRemove);save();}));
  }
  $("calendarForm").addEventListener("submit",e=>{
    e.preventDefault();
    const title=$("eventTitle").value.trim(),date=$("eventDate").value;
    if(!title||!date){return;}
    calendarEvents.push({id:makeId(),title,date,time:$("eventTime").value,type:$("eventType").value,symbol:$("eventSymbol").value.trim().toUpperCase(),created:new Date().toISOString()});
    $("calendarForm").reset();save();
  });

  function closeTrade(id){
    const trade=journal.find(t=>t.id===id);if(!trade)return;
    const raw=prompt("Enter simulated exit price for "+trade.symbol+" (no live quote is used):");if(raw===null)return;
    const exit=Number(raw);if(!Number.isFinite(exit)||exit<=0){alert("Enter a valid positive exit price.");return;}
    const direction=trade.side==="Long"?1:-1;
    trade.exit=exit;trade.pnl=(exit-trade.entry)*direction*trade.qty;trade.status="Closed";trade.closed=new Date().toISOString();save();
  }

  function calculatePlan(e){
    if(e)e.preventDefault();
    const symbol=$("planSymbol").value.trim().toUpperCase(),side=$("planSide").value;
    const account=Number($("accountSize").value),pct=Number($("riskPct").value),entry=Number($("entryPrice").value),stop=Number($("stopPrice").value),target=Number($("targetPrice").value);
    const err=$("planError");err.textContent="";currentPlan=null;$("savePlan").disabled=true;
    if(!symbol||![account,pct,entry,stop].every(Number.isFinite)||account<=0||pct<=0||pct>100||entry<=0||stop<=0){err.textContent="Enter a symbol and valid positive account, risk, entry, and stop values.";return;}
    const riskPerShare=side==="Long"?entry-stop:stop-entry;
    if(riskPerShare<=0){err.textContent="Your stop must be below entry for Long, and above entry for Short.";return;}
    const riskDollars=account*pct/100,qty=Math.floor(riskDollars/riskPerShare);
    if(qty<1){err.textContent="At this risk setting, calculated size is less than one whole unit.";return;}
    let reward=null,rr=null;
    if(target>0){reward=side==="Long"?target-entry:entry-target;if(reward<=0){err.textContent="Target must be above entry for Long, and below entry for Short.";return;}rr=reward/riskPerShare;}
    currentPlan={id:makeId(),date:new Date().toISOString(),symbol,side,entry,stop,target:target>0?target:null,qty,riskDollars:qty*riskPerShare,reward:reward===null?null:qty*reward,rr,status:"Open",pnl:0};
    $("planResults").innerHTML='<div class="result-grid"><div class="result-tile"><small>POSITION SIZE</small><b>'+qty.toLocaleString()+' units</b></div><div class="result-tile"><small>PLANNED RISK</small><b>'+money(qty*riskPerShare)+'</b></div><div class="result-tile"><small>RISK / UNIT</small><b>'+money(riskPerShare)+'</b></div><div class="result-tile"><small>RISK : REWARD</small><b>'+(rr===null?"—":"1 : "+rr.toFixed(2))+'</b></div></div><p class="result-note">Estimated position value: '+money(qty*entry)+'. '+(reward===null?"Add a target to calculate potential reward.":"Potential reward at target: "+money(qty*reward)+". ")+'Sizing excludes fees, slippage, liquidity limits, and fractional-share rules. This is a planning estimate, not investment advice.</p>';
    $("savePlan").disabled=false;
  }
  $("planForm").addEventListener("submit",calculatePlan);
  $("savePlan").addEventListener("click",()=>{if(!currentPlan)return;journal.push(currentPlan);save();$("savePlan").disabled=true;$("planResults").insertAdjacentHTML("beforeend",'<p class="result-note">Saved to your private cloud paper journal.</p>');currentPlan=null;});
  $("exportJournal").addEventListener("click",()=>{
    if(!journal.length){alert("Your journal is empty.");return;}
    const cols=["date","symbol","side","entry","stop","target","qty","status","exit","pnl"];
    const csv=[cols.join(","),...journal.map(t=>cols.map(k=>JSON.stringify(t[k]??"")).join(","))].join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="rolyfe-paper-journal.csv";a.click();URL.revokeObjectURL(url);
  });
  function updateClock(){
    const now=new Date();
    $("clock").textContent=now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true,timeZone:"America/New_York"});
    $("today").textContent=now.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric",year:"numeric",timeZone:"America/New_York"})+" · ET";
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(now);
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value])),mins=Number(p.hour)*60+Number(p.minute),weekday=!["Sat","Sun"].includes(p.weekday);
    $("marketStatus").textContent=!weekday?"WEEKEND":mins>=570&&mins<960?"CORE SESSION":mins>=240&&mins<570?"PRE-MARKET":mins>=960&&mins<1200?"AFTER-HOURS":"CLOSED";
  }
  $("atlasToggle").addEventListener("click",()=>{$("atlasPanel").hidden=!$("atlasPanel").hidden;});
  $("atlasClose").addEventListener("click",()=>{$("atlasPanel").hidden=true;});
  setInterval(updateClock,1000);
  setInterval(refreshQuotes,60000);
  setInterval(refreshActiveInstrumentQuote,60000);
})();