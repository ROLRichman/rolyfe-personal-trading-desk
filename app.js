(() => {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(key, fallback) { try { const value = JSON.parse(localStorage.getItem("rolyfe-desk-" + key)); return value ?? fallback; } catch { return fallback; } },
    set(key, value) { localStorage.setItem("rolyfe-desk-" + key, JSON.stringify(value)); }
  };
  let watchlist = store.get("watchlist", []);
  let journal = store.get("journal", []);
  let currentPlan = null;
  let activeSymbol = "";

  const money = (n) => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(Number(n)||0);
  const safe = (s) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const save = () => { store.set("watchlist", watchlist); store.set("journal", journal); render(); };

  function go(view) {
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "view-" + view));
    document.querySelectorAll(".nav-link").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    $("pageCrumb").textContent = ({overview:"OVERVIEW",markets:"WATCHLISTS",planner:"TRADE PLANNER",journal:"PAPER JOURNAL"})[view] || "OVERVIEW";
    $("sidebar").classList.remove("open");
    window.scrollTo({top:0,behavior:"smooth"});
  }
  document.querySelectorAll(".nav-link").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));
  $("menuToggle").addEventListener("click", () => $("sidebar").classList.toggle("open"));

  function renderWatchlist() {
    $("watchCount").textContent = watchlist.length + (watchlist.length === 1 ? " SYMBOL" : " SYMBOLS");
    $("metricSymbols").textContent = watchlist.length;
    $("watchlistBody").innerHTML = watchlist.length ? watchlist.map((x,i) => `<tr><td class="symbol-cell"><b>${safe(x.symbol)}</b><small>${safe(x.name || x.symbol)}</small></td><td>${safe(x.type)}</td><td class="quote-na">Not connected</td><td><a class="table-action" target="_blank" rel="noopener" href="https://www.tradingview.com/chart/?symbol=${encodeURIComponent(x.symbol)}">Open chart ↗</a></td><td><button class="table-action remove-btn" data-remove="${i}" aria-label="Remove ${safe(x.symbol)}">Remove</button></td></tr>`).join("") : '<tr><td colspan="5" class="empty-cell">No symbols yet. Add your first symbol above.</td></tr>';
    $("overviewWatchlist").innerHTML = watchlist.length ? watchlist.slice(0,5).map(x => `<div class="mini-row"><b>${safe(x.symbol)}</b><small>${safe(x.type)}</small><span class="quote-na">— no quote</span></div>`).join("") : '<div class="empty-state">Your watchlist is ready. Add a symbol to begin tracking it.</div>';
    document.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => { watchlist.splice(Number(b.dataset.remove),1); save(); }));
  }
  $("addSymbolForm").addEventListener("submit", e => {
    e.preventDefault();
    const symbol = $("symbolInput").value.trim().toUpperCase().replace(/\s+/g,"");
    if (!/^[A-Z0-9.^/_-]{1,20}$/.test(symbol)) { alert("Use a valid ticker or pair symbol."); return; }
    if (watchlist.some(x => x.symbol === symbol)) { alert(symbol + " is already on your watchlist."); return; }
    watchlist.push({symbol,type:$("assetType").value,added:new Date().toISOString()});
    $("symbolInput").value = ""; save();
  });

  function renderJournal() {
    const closed = journal.filter(t => t.status === "Closed");
    const pnl = closed.reduce((sum,t) => sum + (Number(t.pnl)||0),0);
    const open = journal.filter(t => t.status === "Open").length;
    $("metricTrades").textContent = journal.length;
    $("metricPnl").textContent = money(pnl);
    $("journalCount").textContent = journal.length;
    $("journalPnl").textContent = money(pnl);
    $("journalOpen").textContent = open;
    $("journalBody").innerHTML = journal.length ? [...journal].reverse().map(t => `<tr><td>${new Date(t.date).toLocaleDateString()}</td><td><b>${safe(t.symbol)}</b></td><td>${safe(t.side)}</td><td>${money(t.entry)}</td><td>${money(t.stop)}</td><td>${Number(t.qty).toLocaleString()}</td><td class="${t.status==="Open"?"status-open":"status-closed"}">${t.status}</td><td>${t.status==="Open"?`<button class="table-action" data-close="${t.id}">Close</button>`:`<span>${money(t.pnl)}</span>`}</td></tr>`).join("") : '<tr><td colspan="8" class="empty-cell">No paper trades recorded yet.</td></tr>';
    document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeTrade(b.dataset.close)));
  }
  function render() { renderWatchlist(); renderJournal(); }
  function closeTrade(id) {
    const trade = journal.find(t => t.id === id); if (!trade) return;
    const raw = prompt("Enter simulated exit price for " + trade.symbol + " (no live quote is used):");
    if (raw === null) return;
    const exit = Number(raw);
    if (!Number.isFinite(exit) || exit <= 0) { alert("Enter a valid positive exit price."); return; }
    const direction = trade.side === "Long" ? 1 : -1;
    trade.exit = exit; trade.pnl = (exit - trade.entry) * direction * trade.qty; trade.status = "Closed"; trade.closed = new Date().toISOString(); save();
  }

  function calculatePlan(e) {
    if (e) e.preventDefault();
    const symbol = $("planSymbol").value.trim().toUpperCase();
    const side = $("planSide").value;
    const account = Number($("accountSize").value), pct = Number($("riskPct").value);
    const entry = Number($("entryPrice").value), stop = Number($("stopPrice").value), target = Number($("targetPrice").value);
    const err = $("planError"); err.textContent = ""; currentPlan = null; $("savePlan").disabled = true;
    if (!symbol || ![account,pct,entry,stop].every(Number.isFinite) || account<=0 || pct<=0 || pct>100 || entry<=0 || stop<=0) { err.textContent = "Enter a symbol and valid positive account, risk, entry, and stop values."; return; }
    const riskPerShare = side === "Long" ? entry-stop : stop-entry;
    if (riskPerShare <= 0) { err.textContent = "Your stop must be below entry for Long, and above entry for Short."; return; }
    const riskDollars = account * pct / 100;
    const qty = Math.floor(riskDollars / riskPerShare);
    if (qty < 1) { err.textContent = "At this risk setting, calculated size is less than one whole unit."; return; }
    let reward = null, rr = null;
    if (target > 0) { reward = side === "Long" ? target-entry : entry-target; if (reward <= 0) { err.textContent = "Target must be above entry for Long, and below entry for Short."; return; } rr = reward/riskPerShare; }
    currentPlan = {id:crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),date:new Date().toISOString(),symbol,side,entry,stop,target:target>0?target:null,qty,riskDollars:qty*riskPerShare,reward:reward===null?null:qty*reward,rr,status:"Open",pnl:0};
    $("planResults").innerHTML = `<div class="result-grid"><div class="result-tile"><small>POSITION SIZE</small><b>${qty.toLocaleString()} units</b></div><div class="result-tile"><small>PLANNED RISK</small><b>${money(qty*riskPerShare)}</b></div><div class="result-tile"><small>RISK / UNIT</small><b>${money(riskPerShare)}</b></div><div class="result-tile"><small>RISK : REWARD</small><b>${rr===null?"—": "1 : "+rr.toFixed(2)}</b></div></div><p class="result-note">Estimated position value: ${money(qty*entry)}. ${reward===null?"Add a target to calculate potential reward.":"Potential reward at target: "+money(qty*reward)+". " }Sizing excludes fees, slippage, liquidity limits, and fractional-share rules. This is a planning estimate, not investment advice.</p>`;
    $("savePlan").disabled = false;
  }
  $("planForm").addEventListener("submit", calculatePlan);
  $("savePlan").addEventListener("click", () => { if (!currentPlan) return; journal.push(currentPlan); save(); $("savePlan").disabled = true; $("planResults").insertAdjacentHTML("beforeend",'<p class="result-note">Saved to your local paper journal.</p>'); currentPlan = null; });

  $("exportJournal").addEventListener("click", () => {
    if (!journal.length) { alert("Your journal is empty."); return; }
    const cols = ["date","symbol","side","entry","stop","target","qty","status","exit","pnl"];
    const csv = [cols.join(","),...journal.map(t => cols.map(k => JSON.stringify(t[k] ?? "")).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv],{type:"text/csv"})); const a=document.createElement("a"); a.href=url; a.download="rolyfe-paper-journal.csv"; a.click(); URL.revokeObjectURL(url);
  });

  function updateClock() {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true,timeZone:"America/New_York"});
    $("today").textContent = now.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric",year:"numeric",timeZone:"America/New_York"}) + " · ET";
    const parts = new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(now);
    const p = Object.fromEntries(parts.map(x=>[x.type,x.value])); const mins=Number(p.hour)*60+Number(p.minute);
    const weekday = !["Sat","Sun"].includes(p.weekday);
    const status = !weekday ? "WEEKEND" : mins>=570&&mins<960 ? "CORE SESSION" : mins>=240&&mins<570 ? "PRE-MARKET" : mins>=960&&mins<1200 ? "AFTER-HOURS" : "CLOSED";
    $("marketStatus").textContent = status;
  }
  $("atlasToggle").addEventListener("click",()=>{$("atlasPanel").hidden=!$("atlasPanel").hidden;});
  $("atlasClose").addEventListener("click",()=>{$("atlasPanel").hidden=true;});
  render(); updateClock(); setInterval(updateClock,1000);
})();