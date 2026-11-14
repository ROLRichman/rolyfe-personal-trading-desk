import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.0";

(() => {
  const SUPABASE_URL = "https://ykmdyfbklvuoseqdjnxy.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_FaJPNdtRsZTemxpbp98F2g_U9ngkFaG";
  const MARKET_DATA_URL = SUPABASE_URL + "/functions/v1/market-data";
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const $ = (id) => document.getElementById(id);
  let userId = null, session = null, watchlist = [], journal = [], currentPlan = null;
  const quoteCache = new Map();
  const store = {
    get(key, fallback) { try { const value = JSON.parse(localStorage.getItem("rolyfe-desk-" + userId + "-" + key)); return value ?? fallback; } catch { return fallback; } },
    set(key, value) { localStorage.setItem("rolyfe-desk-" + userId + "-" + key, JSON.stringify(value)); }
  };
  const money = (n) => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(Number(n)||0);
  const price = (n) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:6}).format(Number(n)||0);
  const safe = (s) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const setAuthMessage = (message, kind="") => { $("authStatus").textContent=message; $("authStatus").className="auth-status "+kind; };

  async function sendSignInLink(e) {
    e.preventDefault();
    const email = $("authEmail").value.trim();
    if (!email) return;
    $("authSubmit").disabled = true; $("authSubmit").textContent = "Sending link…";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    $("authSubmit").disabled = false; $("authSubmit").textContent = "Send secure sign-in link";
    if (error) setAuthMessage(error.message, "error");
    else setAuthMessage("Check your inbox for the secure sign-in link. Open it on this device to return to your trading desk.", "success");
  }
  $("authForm").addEventListener("submit", sendSignInLink);

  function loadUserData() {
    watchlist = store.get("watchlist", []);
    journal = store.get("journal", []);
    quoteCache.clear();
    $("authGate").hidden = true; $("appShell").hidden = false; $("atlasToggle").hidden = false;
    render(); updateClock(); refreshQuotes();
  }
  function enterSession(nextSession) {
    session = nextSession; userId = nextSession?.user?.id || null;
    if (userId) loadUserData();
    else { $("authGate").hidden=false; $("appShell").hidden=true; $("atlasToggle").hidden=true; }
  }
  supabase.auth.onAuthStateChange((_event, nextSession) => { setTimeout(() => enterSession(nextSession), 0); });
  supabase.auth.getSession().then(({data}) => enterSession(data.session));

  function save() { store.set("watchlist",watchlist); store.set("journal",journal); render(); }
  function go(view) {
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "view-" + view));
    document.querySelectorAll(".nav-link").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    $("pageCrumb").textContent = ({overview:"OVERVIEW",markets:"WATCHLISTS",planner:"TRADE PLANNER",journal:"PAPER JOURNAL"})[view] || "OVERVIEW";
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
    const pct=Number(q.changePercent);
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
    document.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => { const removed=watchlist.splice(Number(b.dataset.remove),1)[0]; if (removed) quoteCache.delete(removed.symbol); save(); }));
  }
  $("addSymbolForm").addEventListener("submit", e => {
    e.preventDefault();
    const symbol=$("symbolInput").value.trim().toUpperCase().replace(/\s+/g,"");
    if (!/^[A-Z0-9.^/_-]{1,20}$/.test(symbol)) { alert("Use a valid ticker or pair symbol."); return; }
    if (watchlist.some(x=>x.symbol===symbol)) { alert(symbol+" is already on your watchlist."); return; }
    if (watchlist.length>=20) { alert("Keep this watchlist to 20 symbols to respect provider rate limits."); return; }
    watchlist.push({symbol,type:$("assetType").value,added:new Date().toISOString()});
    $("symbolInput").value=""; save(); refreshQuotes();
  });

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
  function render(){renderWatchlist();renderJournal();}
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
    currentPlan={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),date:new Date().toISOString(),symbol,side,entry,stop,target:target>0?target:null,qty,riskDollars:qty*riskPerShare,reward:reward===null?null:qty*reward,rr,status:"Open",pnl:0};
    $("planResults").innerHTML='<div class="result-grid"><div class="result-tile"><small>POSITION SIZE</small><b>'+qty.toLocaleString()+' units</b></div><div class="result-tile"><small>PLANNED RISK</small><b>'+money(qty*riskPerShare)+'</b></div><div class="result-tile"><small>RISK / UNIT</small><b>'+money(riskPerShare)+'</b></div><div class="result-tile"><small>RISK : REWARD</small><b>'+(rr===null?"—":"1 : "+rr.toFixed(2))+'</b></div></div><p class="result-note">Estimated position value: '+money(qty*entry)+'. '+(reward===null?"Add a target to calculate potential reward.":"Potential reward at target: "+money(qty*reward)+". ")+'Sizing excludes fees, slippage, liquidity limits, and fractional-share rules. This is a planning estimate, not investment advice.</p>';
    $("savePlan").disabled=false;
  }
  $("planForm").addEventListener("submit",calculatePlan);
  $("savePlan").addEventListener("click",()=>{if(!currentPlan)return;journal.push(currentPlan);save();$("savePlan").disabled=true;$("planResults").insertAdjacentHTML("beforeend",'<p class="result-note">Saved to your local paper journal.</p>');currentPlan=null;});
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