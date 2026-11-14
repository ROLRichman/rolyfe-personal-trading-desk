import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.0";

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
  let selectedChartSymbol = "", selectedInterval = "1d", currentBars = [];
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
  async function loadUserData() {
    const owner = userId;
    loadingUserId = owner;
    cloudReady = false;
    setCloudStatus("SYNCING PRIVATE DESK");
    $("authGate").hidden = true; $("appShell").hidden = false; $("atlasToggle").hidden = false;
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
      loadedUserId = null;
      loadingUserId = null;
      cloudReady = false;
    }
    if (userId) {
      if (loadedUserId !== userId && loadingUserId !== userId) loadUserData();
    } else {
      watchlist = []; journal = []; calendarEvents = [];
      $("authGate").hidden = false; $("appShell").hidden = true; $("atlasToggle").hidden = true;
    }
  }
  supabase.auth.onAuthStateChange((_event, nextSession) => { setTimeout(() => enterSession(nextSession), 0); });
  supabase.auth.getSession().then(({data}) => enterSession(data.session));

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
  const price = (n) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:6}).format(Number(n)||0);
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

  function loadUserData() {
    watchlist = store.get("watchlist", []);
    journal = store.get("journal", []);
    calendarEvents = store.get("calendar", []);
    quoteCache.clear();
    $("authGate").hidden = true; $("appShell").hidden = false; $("atlasToggle").hidden = false;
    render(); updateClock(); refreshQuotes(); loadChart();
  }
  function enterSession(nextSession) {
    session = nextSession; userId = nextSession?.user?.id || null;
    if (userId) loadUserData();
    else { $("authGate").hidden=false; $("appShell").hidden=true; $("atlasToggle").hidden=true; }
  }
  supabase.auth.onAuthStateChange((_event, nextSession) => { setTimeout(() => enterSession(nextSession), 0); });
  supabase.auth.getSession().then(({data}) => enterSession(data.session));

  function save() { store.set("watchlist",watchlist); store.set("journal",journal); store.set("calendar",calendarEvents); render(); }
  function go(view) {
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "view-" + view));
    document.querySelectorAll(".nav-link").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    $("pageCrumb").textContent = ({overview:"OVERVIEW",markets:"WATCHLISTS",calendar:"CALENDAR",planner:"TRADE PLANNER",journal:"PAPER JOURNAL"})[view] || "OVERVIEW";
    $("sidebar").classList.remove("open"); window.scrollTo({top:0,behavior:"smooth"});
  }
  document.querySelectorAll(".nav-link").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));
  $("menuToggle").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  $("signOutBtn").addEventListener("click", async () => { await supabase.auth.signOut(); });

  function quoteMarkup(symbol) {
    const q=quoteCache.get(symbol);
    if (!q) return {last:'<span class="quote-na">Loading…</span>',change:'<span class="quote-na">—</span>'};
    if (q.error) return {last:'<span class="quote-na">Unavailable</span>',change:'<span class="quote-na" title="'+safe(q.error)+'">—</span>'};
    const pct=typeof q.changePercent==="number"?q.changePercent:NaN;
    const cls=Number.isFinite(pct)?(pct>0?"quote-positive":pct<0?"quote-negative":"quote-neutral"):"quote-neutral";
    return {last:'<b>'+price(q.price)+'</b>',change:Number.isFinite(pct)?'<span class="'+cls+'">'+(pct>0?"+":"")+pct.toFixed(2)+'%</span>':'<span class="quote-na">—</span>'};
  }
  function renderWatchlist() {
    $("watchCount").textContent = watchlist.length + (watchlist.length === 1 ? " SYMBOL" : " SYMBOLS");
    $("metricSymbols").textContent = watchlist.length;
    $("watchlistBody").innerHTML = watchlist.length ? watchlist.map((x,i) => {
      const q=quoteMarkup(x.symbol);
      return '<tr><td class="symbol-cell"><b>'+safe(x.symbol)+'</b><small>'+safe(x.type)+'</small></td><td>'+safe(x.type)+'</td><td>'+q.last+'</td><td>'+q.change+'</td><td><a class="table-action" target="_blank" rel="noopener" href="https://www.tradingview.com/chart/?symbol='+encodeURIComponent(x.symbol)+'">Open chart ↗</a></td><td><button class="table-action remove-btn" data-remove="'+i+'" aria-label="Remove '+safe(x.symbol)+'">Remove</button></td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty-cell">No symbols yet. Add your first symbol above.</td></tr>';
    $("overviewWatchlist").innerHTML = watchlist.length ? watchlist.slice(0,5).map(x => {
      const q=quoteMarkup(x.symbol);
      return '<div class="mini-row"><b>'+safe(x.symbol)+'</b><small>'+safe(x.type)+'</small><span>'+q.last+' '+q.change+'</span></div>';
    }).join("") : '<div class="empty-state">Your watchlist is ready. Add a symbol to begin tracking it.</div>';
    refreshChartOptions();
    document.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => { const removed=watchlist.splice(Number(b.dataset.remove),1)[0]; if (removed) quoteCache.delete(removed.symbol); save(); }));
  }
  $("addSymbolForm").addEventListener("submit", e => {
    e.preventDefault();
    const symbol=$("symbolInput").value.trim().toUpperCase().replace(/\s+/g,"");
    if (!/^[A-Z0-9.^/_-]{1,20}$/.test(symbol)) { alert("Use a valid ticker or pair symbol."); return; }
    if (watchlist.some(x=>x.symbol===symbol)) { alert(symbol+" is already on your watchlist."); return; }
    if (watchlist.length>=20) { alert("Keep this watchlist to 20 symbols to respect provider rate limits."); return; }
    watchlist.push({symbol,type:$("assetType").value,added:new Date().toISOString()});
    $("symbolInput").value=""; save(); refreshQuotes(); loadChart();
  });


  function tickerbotSymbol(item) {
    if (item.type !== "Crypto") return item.symbol;
    const pair = {BTC:"X:BTCUSD",ETH:"X:ETHUSD",SOL:"X:SOLUSD",XRP:"X:XRPUSD",LINK:"X:LINKUSD",HYPE:"X:HYPEUSD",AVAX:"X:AVAXUSD",DOGE:"X:DOGEUSD"};
    return pair[item.symbol] || item.symbol;
  }
  function refreshChartOptions() {
    const select=$("chartSymbol"), previous=selectedChartSymbol || select.value;
    select.innerHTML='<option value="">Select a watchlist symbol</option>'+watchlist.map(x=>'<option value="'+safe(x.symbol)+'">'+safe(x.symbol)+' · '+safe(x.type)+'</option>').join("");
    selectedChartSymbol=watchlist.some(x=>x.symbol===previous)?previous:(watchlist[0]?.symbol||"");
    select.value=selectedChartSymbol;
    if (previous && previous!==selectedChartSymbol) loadChart();
  }
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
      const stamp = dateValue(bar.t), day = Number.isFinite(stamp.getTime()) ? stamp.toISOString().slice(0, 10) : activeDay;
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
  function drawLine(ctx, values, offset, step, left, y, color, width = 1.5) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    let started = false;
    for (let i = offset; i < values.length; i++) {
      const value = values[i];
      if (value === null || !Number.isFinite(value)) { started = false; continue; }
      const x = left + step * (i - offset + 0.5), yy = y(value);
      if (!started) { ctx.moveTo(x, yy); started = true; } else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  function drawChart(bars) {
    const canvas = $("priceChart"); if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), width = Math.max(320, rect.width), height = Math.max(220, rect.height), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#08140f"; ctx.fillRect(0, 0, width, height);
    if (!bars.length) { ctx.fillStyle = "#81988c"; ctx.font = "12px DM Sans"; ctx.fillText("No verified candles available for this request.", 18, 32); return; }
    const visible = bars.slice(-120), offset = bars.length - visible.length;
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
      for (const value of series.slice(offset)) if (Number.isFinite(value)) { max = Math.max(max, value); min = Math.min(min, value); }
    }
    const pad = (max - min) * .08 || 1; max += pad; min -= pad;
    const left = 12, right = 64, top = 16, bottom = 28, plotW = width - left - right, plotH = height - top - bottom;
    const y = v => top + (max - v) / (max - min) * plotH;
    ctx.strokeStyle = "#1b3027"; ctx.lineWidth = 1; ctx.fillStyle = "#789084"; ctx.font = "9px DM Mono";
    for (let i = 0; i <= 4; i++) {
      const yy = top + plotH * i / 4; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(width - right, yy); ctx.stroke();
      const value = max - (max - min) * i / 4; ctx.fillText(value.toFixed(value < 10 ? 3 : 2), width - right + 7, yy + 3);
    }
    const step = plotW / visible.length, candleW = Math.max(2, Math.min(9, step * .62));
    visible.forEach((bar, i) => {
      const x = left + step * (i + .5), open = y(Number(bar.o)), close = y(Number(bar.c)), high = y(Number(bar.h)), low = y(Number(bar.l));
      const up = Number(bar.c) >= Number(bar.o); ctx.strokeStyle = up ? "#72e6a5" : "#ef7777"; ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.moveTo(x, high); ctx.lineTo(x, low); ctx.stroke();
      ctx.fillRect(x - candleW / 2, Math.min(open, close), candleW, Math.max(1, Math.abs(close - open)));
    });
    for (const [key, series, color] of overlays) if ($("indicator-" + key)?.checked) drawLine(ctx, series, offset, step, left, y, color, key === "vwap" ? 1.8 : 1.35);
    ctx.fillStyle = "#789084"; ctx.font = "9px DM Mono"; ctx.fillText(dateValue(visible[0].t).toLocaleDateString(), left, height - 8);
    ctx.textAlign = "right"; ctx.fillText(dateValue(visible[visible.length - 1].t).toLocaleDateString(), width - right, height - 8); ctx.textAlign = "left";
  }
  function drawPane(canvasId, bars, series, min, max, levels = [], histogram = false) {
    const canvas = $(canvasId); if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), width = Math.max(250, rect.width), height = Math.max(90, rect.height), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#08140f"; ctx.fillRect(0, 0, width, height);
    if (!bars.length) { ctx.fillStyle = "#81988c"; ctx.font = "10px DM Sans"; ctx.fillText("Waiting for provider candles", 10, 22); return; }
    const count = Math.min(120, bars.length), offset = bars.length - count, plotLeft = 8, plotRight = 8, plotTop = 9, plotBottom = 9;
    const plotW = width - plotLeft - plotRight, plotH = height - plotTop - plotBottom, step = plotW / count;
    const y = value => plotTop + (max - value) / (max - min) * plotH;
    ctx.strokeStyle = "#1b3027"; ctx.lineWidth = 1; ctx.fillStyle = "#789084"; ctx.font = "8px DM Mono";
    levels.forEach(level => { const yy = y(level); ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.moveTo(plotLeft, yy); ctx.lineTo(width - plotRight, yy); ctx.stroke(); ctx.setLineDash([]); });
    for (const item of series) {
      if (histogram && item.type === "bars") {
        const zero = y(0);
        for (let i = offset; i < bars.length; i++) {
          const value = item.values[i]; if (value === null || !Number.isFinite(value)) continue;
          ctx.fillStyle = value >= 0 ? "#72e6a5" : "#ef7777";
          const x = plotLeft + step * (i - offset + .2), yy = y(value);
          ctx.fillRect(x, Math.min(yy, zero), Math.max(1, step * .6), Math.max(1, Math.abs(zero - yy)));
        }
      } else drawLine(ctx, item.values, offset, step, plotLeft, y, item.color, item.width || 1.3);
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
    if (!bars.length) return;
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
  async function loadChart() {
    if(!userId)return;
    const item=watchlist.find(x=>x.symbol===selectedChartSymbol);
    if(!item){currentBars=[];$("chartStatus").textContent="Add a symbol to your watchlist to load a chart.";drawChart([]);drawIndicatorPanels([]);return;}
    $("chartStatus").textContent="Loading "+item.symbol+" · "+selectedInterval+" candles…";
    const range=$("chartRange")?.value||"6M",months=({"1M":1,"3M":3,"6M":6,"1Y":12})[range],fromDate=months?new Date(Date.now()-months*30.4375*86400000).toISOString().slice(0,10):"",symbol=tickerbotSymbol(item),url=MARKET_DATA_URL+"?provider=tickerbot&symbol="+encodeURIComponent(symbol)+"&interval="+selectedInterval+"&limit="+(range==="MAX"?1000:500)+"&session=all"+(fromDate?"&from="+fromDate:"");
    try{
      const {data:{session:active}}=await supabase.auth.getSession();
      const response=await fetch(url,{headers:{"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+active.access_token,"Accept":"application/json"}});
      const payload=await response.json();
      if(!response.ok||!Array.isArray(payload.bars)){currentBars=[];drawChart([]);drawIndicatorPanels([]);$("chartStatus").textContent=payload.error||"Historical data is not available for this symbol/timeframe.";return;}
      currentBars=[...payload.bars].filter(b=>[b.o,b.h,b.l,b.c].every(v=>Number.isFinite(Number(v)))&&Number.isFinite(dateValue(b.t).getTime())).sort((a,b)=>dateValue(a.t).getTime()-dateValue(b.t).getTime());
      drawChart(currentBars);drawIndicatorPanels(currentBars);
      $("chartStatus").textContent=item.symbol+" · "+selectedInterval+" · "+currentBars.length+" provider candles · "+(payload.provider||"unknown provider");
      $("chartFootnote").textContent="Source: "+(payload.provider||"provider")+" · As of "+(payload.asOf||"provider timestamp not supplied")+" · Coverage: "+(payload.coverage||"provider response")+". Indicator overlays are calculated from returned closes.";
    }catch{currentBars=[];drawChart([]);drawIndicatorPanels([]);$("chartStatus").textContent="Could not reach the secure historical-data service.";}
  }
  $("chartSymbol").addEventListener("change",()=>{selectedChartSymbol=$("chartSymbol").value;loadChart();});
  document.querySelectorAll("[data-interval]").forEach(b=>b.addEventListener("click",()=>{selectedInterval=b.dataset.interval;document.querySelectorAll("[data-interval]").forEach(x=>x.classList.toggle("active",x===b));loadChart();}));
  $("chartRange").addEventListener("change",loadChart);
  document.querySelectorAll("[data-indicator]").forEach(b=>b.addEventListener("change",()=>{drawChart(currentBars);drawIndicatorPanels(currentBars);}));
  window.addEventListener("resize",()=>{if(currentBars.length){drawChart(currentBars);drawIndicatorPanels(currentBars);}});

  async function runScanner() {
    const asset=$("scanAsset").value;
    const items=watchlist.filter(x=>asset==="stocks"?(x.type==="Stock"||x.type==="ETF"):x.type==="Crypto");
    if(!items.length){$("scannerStatus").textContent="Add "+(asset==="stocks"?"stock or ETF":"crypto")+" symbols to your watchlist before scanning.";return;}
    $("runScanner").disabled=true;$("runScanner").textContent="Scanning…";$("scannerStatus").textContent="Requesting current provider scan…";
    const symbols=items.map(tickerbotSymbol);
    const url=MARKET_DATA_URL+"?provider=tickerbot-scan&asset_class="+asset+"&symbols="+encodeURIComponent(symbols.join(","))+"&limit=100";
    try{
      const {data:{session:active}}=await supabase.auth.getSession();
      const response=await fetch(url,{headers:{"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+active.access_token,"Accept":"application/json"}});
      const payload=await response.json();
      if(!response.ok||!Array.isArray(payload.results)){ $("scannerBody").innerHTML='<tr><td colspan="7" class="empty-cell">'+safe(payload.error||"Scanner data is unavailable.")+'</td></tr>';$("scannerStatus").textContent="Scan not completed. Check provider entitlement and server-side secret configuration.";return;}
      const fmt=v=>v===null||v===undefined||v===""?"—":Number.isFinite(Number(v))?Number(v).toFixed(2):safe(String(v));
      $("scannerBody").innerHTML=payload.results.length?payload.results.map(x=>'<tr><td><b>'+safe(x.ticker||x.symbol||"—")+'</b></td><td>'+fmt(x.price)+'</td><td>'+fmt(x.rsi_14)+'</td><td>'+fmt(x.relative_volume)+'</td><td>'+fmt(x.macd_histogram)+'</td><td>'+fmt(x.adx_14)+'</td><td>'+((x.above_vwap===true)?"YES":(x.above_vwap===false)?"NO":"—")+'</td></tr>').join(""):'<tr><td colspan="7" class="empty-cell">The provider returned no scan matches for these symbols.</td></tr>';
      $("scannerStatus").textContent="Provider scan complete · "+(payload.count??payload.results.length)+" rows · "+(payload.asOf||"provider timestamp not supplied")+".";
    }catch{$("scannerStatus").textContent="Could not reach the secure scanner service.";}
    finally{$("runScanner").disabled=false;$("runScanner").textContent="Run scan";}
  }
  $("runScanner").addEventListener("click",runScanner);

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
      const marketContext=watchlist.map(x=>{const q=quoteCache.get(x.symbol);return x.symbol+" ("+x.type+"): "+(q&&!q.error?"price "+q.price+", change "+q.changePercent+"%, source "+q.provider:"quote unavailable/not verified");}).join("\n");
      const tradeContext=journal.slice(-10).map(t=>t.symbol+" "+t.side+" entry "+t.entry+" stop "+t.stop+" size "+t.qty+" status "+t.status+(t.status==="Closed"?" P/L "+t.pnl:"")).join("\n");
      const chartContext=currentBars.length?"Chart selected "+selectedChartSymbol+" timeframe "+selectedInterval+"; "+currentBars.length+" verified bars; latest close "+currentBars[currentBars.length-1].c+".":"No chart bars loaded.";
      const context="RO’Lyfe Personal Trading Desk.\nWATCHLIST / VERIFIED QUOTES:\n"+(marketContext||"No watchlist symbols.")+"\n\nRECENT PAPER JOURNAL:\n"+(tradeContext||"No paper trades.")+"\n\nCHART DATA:\n"+chartContext+"\n\nNo brokerage connection; paper mode only.";
      const response=await fetch(SUPABASE_URL+"/functions/v1/rol-trading-ai",{method:"POST",headers:{"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+active.access_token,"Content-Type":"application/json"},body:JSON.stringify({action:"analyze",question,context,sidekickMode:"analyst"})});
      const payload=await response.json();pending.remove();
      if(!response.ok||!payload.answer)throw new Error(payload.error||"Atlas could not complete the request.");
      appendAtlas(payload.answer,"assistant");$("atlasStatus").textContent="ATLAS CONNECTED · "+(payload.model||"AI");
    }catch(err){pending.remove();appendAtlas(err.message||"Atlas connection unavailable.","assistant");$("atlasStatus").textContent="AI SERVICE NEEDS ATTENTION";}
    finally{$("atlasSend").disabled=false;}
  }
  $("atlasForm").addEventListener("submit",sendAtlas);

  async function fetchQuote(item) {
    const crypto=["BTC","ETH","SOL","XRP","LINK","HYPE","AVAX","DOGE"].includes(item.symbol);
    const provider=item.type==="Crypto"?"coingecko":"finnhub";
    if (item.type==="Crypto"&&!crypto) return {error:"This crypto symbol is not in the current CoinGecko mapping."};
    const url=MARKET_DATA_URL+"?provider="+provider+"&symbol="+encodeURIComponent(item.symbol);
    try {
      const {data:{session:active}}=await supabase.auth.getSession();
      if (!active?.access_token) return {error:"Sign-in session expired. Sign in again."};
      const response=await fetch(url,{headers:{"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+active.access_token,"Accept":"application/json"}});
      const payload=await response.json();
      if (!response.ok) return {error:payload.error||"Market-data provider returned HTTP "+response.status};
      if (!Number.isFinite(Number(payload.price))||Number(payload.price)<=0) return {error:"Provider returned no valid price."};
      let changePercent=Number(payload.changePercent);
      if (provider==="coingecko") changePercent=Number(payload.changePercent24h);
      return {price:Number(payload.price),changePercent:Number.isFinite(changePercent)?changePercent:null,timestamp:payload.timestamp||payload.lastUpdatedAt||null,provider:payload.provider};
    } catch { return {error:"Could not reach the secure market-data service."}; }
  }
  async function refreshQuotes() {
    if (!userId) return;
    $("dataStatus").textContent="REFRESHING QUOTES";
    const items=[...watchlist];
    for (const item of items) {
      const result=await fetchQuote(item);
      quoteCache.set(item.symbol,result);
      renderWatchlist();
    }
    const failures=items.filter(x=>quoteCache.get(x.symbol)?.error).length;
    $("dataStatus").textContent=items.length?(failures?"PARTIAL DATA":"DATA CONNECTED"):"ADD WATCHLIST SYMBOLS";
    $("quoteUpdated").textContent=items.length?"Last checked "+new Date().toLocaleTimeString()+" · provider timestamps are displayed where supplied.":"Quotes will display their provider-reported timestamp when available.";
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
  function render(){renderWatchlist();renderJournal();renderCalendar();}

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
})();