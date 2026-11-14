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
  const quoteCache = new Map();
  let selectedChartSymbol = "", selectedInterval = "1d", currentBars = [];
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
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname }
    });
    $("authSubmit").disabled = false; $("authSubmit").textContent = "Send secure sign-in link";
    if (error) setAuthMessage(error.message, "error");
    else setAuthMessage("Check your inbox for the secure sign-in link. Open it on this device to return to your trading desk.", "success");
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
      for(let i=0;i<values.length;i++){const v=Number(values[i]);if(!Number.isFinite(v))continue;if(count<period){sum+=v;count++;if(count===period){ema=sum/period;out[i]=ema;}}else{ema=v*alpha+ema*(1-alpha);out[i]=ema;}}
    } else {
      let sum=0;
      for(let i=0;i<values.length;i++){sum+=Number(values[i]);if(i>=period)sum-=Number(values[i-period]);if(i>=period-1)out[i]=sum/period;}
    }
    return out;
  }
  function drawChart(bars) {
    const canvas=$("priceChart"); if(!canvas)return;
    const rect=canvas.getBoundingClientRect(), width=Math.max(320,rect.width), height=Math.max(220,rect.height), dpr=window.devicePixelRatio||1;
    canvas.width=Math.floor(width*dpr);canvas.height=Math.floor(height*dpr);
    const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    ctx.fillStyle="#08140f";ctx.fillRect(0,0,width,height);
    if(!bars.length){ctx.fillStyle="#81988c";ctx.font="12px DM Sans";ctx.fillText("No verified candles available for this request.",18,32);return;}
    const visible=bars.slice(-120), offset=bars.length-visible.length;
    const highs=visible.map(x=>Number(x.h)), lows=visible.map(x=>Number(x.l));
    let max=Math.max(...highs), min=Math.min(...lows);const pad=(max-min)*.08||1;max+=pad;min-=pad;
    const left=12,right=64,top=16,bottom=28,plotW=width-left-right,plotH=height-top-bottom;
    const y=v=>top+(max-v)/(max-min)*plotH;
    ctx.strokeStyle="#1b3027";ctx.lineWidth=1;ctx.fillStyle="#789084";ctx.font="9px DM Mono";
    for(let i=0;i<=4;i++){const yy=top+plotH*i/4;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(width-right,yy);ctx.stroke();const value=max-(max-min)*i/4;ctx.fillText(value.toFixed(value<10?3:2),width-right+7,yy+3);}
    const step=plotW/visible.length,candleW=Math.max(2,Math.min(9,step*.62));
    visible.forEach((b,i)=>{const x=left+step*(i+.5),o=y(Number(b.o)),c=y(Number(b.c)),h=y(Number(b.h)),l=y(Number(b.l)),up=Number(b.c)>=Number(b.o);ctx.strokeStyle=up?"#72e6a5":"#ef7777";ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(x,h);ctx.lineTo(x,l);ctx.stroke();ctx.fillRect(x-candleW/2,Math.min(o,c),candleW,Math.max(1,Math.abs(c-o)));});
    const closes=bars.map(b=>Number(b.c));
    const indicators=[["ema20",20,true,"#e9bd68"],["ema50",50,true,"#63b8c8"],["sma200",200,false,"#b69cff"]];
    for(const [key,period,exp,color] of indicators){
      if(!$("indicator-"+key)?.checked)continue;
      const series=movingAverage(closes,period,exp);ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();let started=false;
      for(let i=offset;i<bars.length;i++){const v=series[i];if(v===null||!Number.isFinite(v))continue;const x=left+step*(i-offset+.5),yy=y(v);if(!started){ctx.moveTo(x,yy);started=true;}else ctx.lineTo(x,yy);}
      if(started)ctx.stroke();
    }
    ctx.fillStyle="#789084";ctx.font="9px DM Mono";ctx.fillText(dateValue(visible[0].t).toLocaleDateString(),left,height-8);
    ctx.textAlign="right";ctx.fillText(dateValue(visible[visible.length-1].t).toLocaleDateString(),width-right,height-8);ctx.textAlign="left";
  }
  async function loadChart() {
    if(!userId)return;
    const item=watchlist.find(x=>x.symbol===selectedChartSymbol);
    if(!item){currentBars=[];$("chartStatus").textContent="Add a symbol to your watchlist to load a chart.";drawChart([]);return;}
    $("chartStatus").textContent="Loading "+item.symbol+" · "+selectedInterval+" candles…";
    const symbol=tickerbotSymbol(item),url=MARKET_DATA_URL+"?provider=tickerbot&symbol="+encodeURIComponent(symbol)+"&interval="+selectedInterval+"&limit=250&session=all";
    try{
      const {data:{session:active}}=await supabase.auth.getSession();
      const response=await fetch(url,{headers:{"apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":"Bearer "+active.access_token,"Accept":"application/json"}});
      const payload=await response.json();
      if(!response.ok||!Array.isArray(payload.bars)){currentBars=[];drawChart([]);$("chartStatus").textContent=payload.error||"Historical data is not available for this symbol/timeframe.";return;}
      currentBars=[...payload.bars].filter(b=>[b.o,b.h,b.l,b.c].every(v=>Number.isFinite(Number(v)))).sort((a,b)=>dateValue(a.t).getTime()-dateValue(b.t).getTime());
      drawChart(currentBars);
      $("chartStatus").textContent=item.symbol+" · "+selectedInterval+" · "+currentBars.length+" provider candles · "+(payload.provider||"unknown provider");
      $("chartFootnote").textContent="Source: "+(payload.provider||"provider")+" · As of "+(payload.asOf||"provider timestamp not supplied")+" · Coverage: "+(payload.coverage||"provider response")+". Indicator overlays are calculated from returned closes.";
    }catch{currentBars=[];drawChart([]);$("chartStatus").textContent="Could not reach the secure historical-data service.";}
  }
  $("chartSymbol").addEventListener("change",()=>{selectedChartSymbol=$("chartSymbol").value;loadChart();});
  document.querySelectorAll("[data-interval]").forEach(b=>b.addEventListener("click",()=>{selectedInterval=b.dataset.interval;document.querySelectorAll("[data-interval]").forEach(x=>x.classList.toggle("active",x===b));loadChart();}));
  document.querySelectorAll("[data-indicator]").forEach(b=>b.addEventListener("change",()=>drawChart(currentBars)));
  window.addEventListener("resize",()=>{if(currentBars.length)drawChart(currentBars);});

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
    calendarEvents.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),title,date,time:$("eventTime").value,type:$("eventType").value,symbol:$("eventSymbol").value.trim().toUpperCase(),created:new Date().toISOString()});
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