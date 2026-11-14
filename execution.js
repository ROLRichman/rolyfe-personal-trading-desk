import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.0";
import { calculateLongOption, calculateCloseMetrics } from "./options-math.js";

(() => {
  const SUPABASE_URL = "https://ykmdyfbklvuoseqdjnxy.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_FaJPNdtRsZTemxpbp98F2g_U9ngkFaG";
  const MARKET_DATA_URL = SUPABASE_URL + "/functions/v1/market-data";
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const $ = id => document.getElementById(id);
  const money = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n)||0);
  const safe = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let session=null, userId=null, contracts=[], selectedQuote=null, optionTrades=[], pending=null, activeSymbol="";
  let cloudReady=false;
  const table="desk_option_paper_trades";

  function timestampMs(value){
    if(value===null||value===undefined||value==="") return null;
    if(typeof value==="string"&&!/^\d+$/.test(value)){const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;}
    const n=Number(value);if(!Number.isFinite(n)||n<=0)return null;
    if(n>1e17)return n/1e6;
    if(n>1e14)return n/1e3;
    if(n>1e11)return n;
    return n*1000;
  }
  function quoteTime(q){
    const ms=timestampMs(q?.quoteTimestamp);
    return ms===null?{ms:null,label:"Time unavailable",fresh:false}:{
      ms,label:new Date(ms).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit"}),
      fresh:Date.now()-ms>=-60000&&Date.now()-ms<=15*60*1000
    };
  }
  function setStatus(message){$("execQuoteMeta").textContent=message;}
  function currentSymbol(){
    const chart=$("chartSymbol");
    const value=String(chart?.value||"").trim().toUpperCase();
    return value;
  }
  function syncSymbol(){
    const symbol=currentSymbol();
    if(symbol!==activeSymbol){activeSymbol=symbol;clearChain();}
    $("execSymbol").value=symbol||"Select a chart symbol";
  }
  function clearChain(){
    contracts=[];selectedQuote=null;pending=null;
    $("execChainBody").innerHTML='<tr><td colspan="11" class="empty-cell">Load a verified option snapshot for the active chart symbol.</td></tr>';
    $("execExpiry").innerHTML='<option value="">All expirations</option>';
    $("execContract").value="";$("execPremium").value="";
    $("execSave").disabled=true;$("execSnapshot").disabled=true;
    $("execResults").innerHTML='<div class="plan-placeholder">Select a verified option quote and calculate the trade.</div>';
  }
  async function getSession(){
    const {data,error}=await supabase.auth.getSession();
    if(error) throw error;
    session=data.session;userId=session?.user?.id||null;
    return session;
  }
  async function loadTrades(){
    if(!userId){optionTrades=[];cloudReady=false;renderTrades();return;}
    const {data,error}=await supabase.from(table).select("*").eq("user_id",userId).order("trade_date",{ascending:false});
    if(error){cloudReady=false;setStatus("Private options journal unavailable: "+error.message);return;}
    optionTrades=data||[];cloudReady=true;renderTrades();
  }
  async function requestChain(){
    const symbol=currentSymbol();
    if(!symbol){setStatus("Choose a stock or ETF in the chart first. Crypto options are not supported by this options endpoint.");return;}
    if(!/^[A-Z0-9.\-]{1,15}$/.test(symbol)){setStatus("The selected symbol is not valid for the options provider.");return;}
    const type=$("execType").value,expiry=$("execExpiry").value;
    $("execLoad").disabled=true;$("execLoad").textContent="Loading…";
    setStatus("Requesting Massive option-chain snapshot for "+symbol+" · "+type.toUpperCase()+"…");
    try{
      const active=await getSession();
      if(!active?.access_token)throw new Error("Sign in again to request authenticated market data.");
      const url=new URL(MARKET_DATA_URL);
      url.searchParams.set("provider","massive-options-chain");
      url.searchParams.set("symbol",symbol);
      url.searchParams.set("contract_type",type);
      url.searchParams.set("limit","250");
      if(expiry)url.searchParams.set("expiration_date",expiry);
      const response=await fetch(url,{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:"Bearer "+active.access_token,Accept:"application/json"}});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Options provider returned HTTP "+response.status);
      contracts=Array.isArray(payload.contracts)?payload.contracts:[];
      selectedQuote=null;pending=null;
      const expiries=[...new Set(contracts.map(x=>x.expirationDate).filter(Boolean))].sort();
      const prior=expiry;
      $("execExpiry").innerHTML='<option value="">All expirations</option>'+expiries.map(d=>'<option value="'+safe(d)+'">'+safe(d)+'</option>').join("");
      if(prior&&expiries.includes(prior))$("execExpiry").value=prior;
      renderChain();
      const timestamps=contracts.map(x=>quoteTime(x)).filter(x=>x.ms!==null);
      const latest=timestamps.length?new Date(Math.max(...timestamps.map(x=>x.ms))).toLocaleString():"No quote timestamps supplied";
      setStatus(payload.count+" "+type.toUpperCase()+" contracts returned for "+symbol+" · Massive · latest timestamp: "+latest+". "+(payload.note||""));
      $("execChainNote").textContent="Only provider-returned bid/ask/last values are shown. Buy-to-open uses ask; sell-to-close uses bid. Missing or stale quotes cannot be used to save a simulated execution.";
    }catch(error){
      contracts=[];selectedQuote=null;renderChain();
      setStatus("OPTIONS DATA UNAVAILABLE · "+error.message+" No substitute or estimated premiums are displayed.");
    }finally{$("execLoad").disabled=false;$("execLoad").textContent="Load quotes";}
  }
  function renderChain(){
    const rows=[...contracts].sort((a,b)=>{
      const ae=a.expirationDate||"",be=b.expirationDate||"";
      return ae.localeCompare(be)||(Number(a.strike)||0)-(Number(b.strike)||0);
    });
    $("execChainBody").innerHTML=rows.length?rows.map((q,i)=>{
      const time=quoteTime(q),bid=Number(q.bid),ask=Number(q.ask),mid=Number.isFinite(bid)&&Number.isFinite(ask)&&bid>0&&ask>=bid?(bid+ask)/2:null;
      const valid=time.fresh&&Number.isFinite(bid)&&bid>0&&Number.isFinite(ask)&&ask>=bid&&ask>0;
      const multiplier=Number(q.sharesPerContract)>0?Number(q.sharesPerContract):100;
      const stop=stopPct(),target=Number($("execTarget").value)||20,capital=Number($("execCapital").value)||100,riskPct=Number($("execRiskPct").value)||1;
      let math=null;
      if(valid&&Number.isFinite(stop)&&stop>0&&stop<100&&target>0){
        try{math=calculateLongOption({premium:ask,multiplier,quantity:1,stopPct:stop,targetPct:target,capital,riskPct});}catch{}
      }
      const mathLine=math?'<div class="chain-math"><b>1 CONTRACT</b><span>Debit '+money(math.debit)+' · Stop '+money(math.stopPremium)+' · Target '+money(math.targetPremium)+'</span><span>Planned risk '+money(math.plannedStopRisk)+' · Max loss '+money(math.maximumLoss)+'</span><span>Target profit '+money(math.potentialProfit)+' · R/R '+math.riskReward.toFixed(2)+':1</span><span>Capital/risk max: '+math.maxContracts+' contract(s)</span></div>':'<div class="chain-math quote-missing">Complete fresh bid/ask required for quote math</div>';
      return '<tr><td><b>'+safe(q.ticker||"Unknown contract")+'</b></td><td>'+safe(q.expirationDate||"—")+'</td><td>'+money(q.strike)+'</td><td class="'+(Number.isFinite(bid)&&bid>0?"quote-good":"quote-missing")+'">'+(Number.isFinite(bid)&&bid>0?money(bid):"—")+'</td><td class="'+(Number.isFinite(ask)&&ask>0?"quote-good":"quote-missing")+'">'+(Number.isFinite(ask)&&ask>0?money(ask):"—")+'</td><td>'+(mid!==null?money(mid):"—")+'</td><td>'+(Number(q.last)>0?money(q.last):"—")+'</td><td>'+(Number(q.impliedVolatility)>0?(Number(q.impliedVolatility)*100).toFixed(1)+"%":"—")+'</td><td>'+(q.openInterest??"—")+'</td><td class="'+(time.fresh?"quote-good":"quote-missing")+'">'+safe(time.label)+(time.ms===null?"":" · "+(time.fresh?"FRESH":"STALE"))+'</td><td>'+mathLine+'<button type="button" data-contract-index="'+i+'" '+(valid?"":"disabled title=\"Bid/ask quote must be complete and no older than 15 minutes\"")+'>'+ (valid?"Select":"Unavailable")+'</button></td></tr>';
    }).join(""):'<tr><td colspan="11" class="empty-cell">No contracts returned. Check the symbol, expiration, provider plan, and market-data secret.</td></tr>';
    document.querySelectorAll("[data-contract-index]").forEach(button=>button.addEventListener("click",()=>{
      const q=rows[Number(button.dataset.contractIndex)];
      const time=quoteTime(q);
      if(!time.fresh||!(Number(q.bid)>0)||!(Number(q.ask)>0)||Number(q.ask)<Number(q.bid)){setStatus("This contract's quote is missing or stale. Select a current complete bid/ask snapshot.");return;}
      selectedQuote=q;
      $("execContract").value=q.ticker||"";
      const action=$("execAction").value;
      $("execPremium").value=(action==="Buy"?q.ask:q.bid).toFixed(2);
      $("execMultiplier").value=Number(q.sharesPerContract)>0?Number(q.sharesPerContract):100;
      $("execError").textContent="";
      setStatus("Selected "+q.ticker+" · bid "+money(q.bid)+" / ask "+money(q.ask)+" · "+time.label+" · source Massive. "+(action==="Buy"?"Entry estimate uses ask.":"Exit estimate uses bid."));
    }));
  }
  ["execStop","execCustomStop","execTarget","execCapital","execRiskPct"].forEach(id=>$(id).addEventListener("change",()=>{if(contracts.length)renderChain();}));
  function renderTrades(){
    const open=optionTrades.filter(t=>t.status==="Open");
    $("execOpenTrade").innerHTML='<option value="">Select an open option position</option>'+open.map(t=>'<option value="'+safe(t.id)+'">'+safe(t.underlying_symbol)+" · "+safe(t.contract_symbol)+" · "+Number(t.quantity)+" contract(s) · entry "+money(t.entry_premium)+'</option>').join("");
    const closed=optionTrades.filter(t=>t.status==="Closed");
    const pnl=closed.reduce((sum,t)=>sum+(Number(t.pnl)||0),0);
    const capital=Number($("execCapital")?.value)||100;
    window.ROLYFE_OPTION_MARKERS=optionTrades.filter(t=>Number(t.underlying_entry)>0).map(t=>({underlying_entry:Number(t.underlying_entry),trade_date:t.trade_date,contract_type:t.contract_type,contract_symbol:t.contract_symbol,status:t.status}));
    document.dispatchEvent(new CustomEvent("rolyfe:execution-markers"));
    $("execTradeCount").textContent=optionTrades.length;
    $("execRealized").textContent=money(pnl);
    $("execCompounded").textContent=money(Math.max(0,capital+pnl));
    $("execJournalBody").innerHTML=optionTrades.length?optionTrades.map(t=>'<tr><td>'+new Date(t.trade_date).toLocaleDateString()+'</td><td><b>'+safe(t.underlying_symbol)+'</b></td><td>'+safe(t.contract_symbol)+'</td><td>'+safe(t.status==="Closed"?"SELL TO CLOSE":"BUY TO OPEN")+'</td><td>'+money(t.entry_premium)+'</td><td>'+money(t.stop_premium)+' ('+Number(t.stop_pct)+'%)</td><td>'+Number(t.quantity)+'</td><td class="'+(t.status==="Open"?"status-open":"status-closed")+'">'+safe(t.status)+'</td><td>'+ (t.status==="Closed"?money(t.pnl):"—")+'</td><td>'+(t.status==="Open"?'<button type="button" class="table-action" data-exec-close="'+safe(t.id)+'">Close</button>':"")+'</td></tr>').join(""):'<tr><td colspan="10" class="empty-cell">No option paper trades recorded yet.</td></tr>';
    document.querySelectorAll("[data-exec-close]").forEach(b=>b.addEventListener("click",()=>{
      const trade=optionTrades.find(t=>t.id===b.dataset.execClose);if(!trade)return;
      $("execAction").value="Close";$("execOpenTrade").value=trade.id;
      $("execContract").value=trade.contract_symbol;$("execPremium").value="";
      $("execMultiplier").value=trade.multiplier;$("execQty").value=trade.quantity;
      $("execStop").value=String(trade.stop_pct);$("execCapital").value=capital.toFixed(2);
      setStatus("To close "+trade.contract_symbol+", load the same underlying's option chain and select its current bid quote.");
      const chart=$("chartSymbol");if(chart&&chart.value!==trade.underlying_symbol){chart.value=trade.underlying_symbol;chart.dispatchEvent(new Event("change",{bubbles:true}));}
      $("execSymbol").value=trade.underlying_symbol;
    }));
  }
  function stopPct(){
    const selected=$("execStop").value;
    return selected==="custom"?Number($("execCustomStop").value):Number(selected);
  }
  function calculate(e){
    if(e)e.preventDefault();
    $("execError").textContent="";pending=null;$("execSave").disabled=true;$("execSnapshot").disabled=true;
    const action=$("execAction").value,capital=Number($("execCapital").value),riskPct=Number($("execRiskPct").value),qty=Number($("execQty").value),mult=Number($("execMultiplier").value),premium=Number($("execPremium").value),stop=stopPct(),target=Number($("execTarget").value);
    const fail=message=>{$("execError").textContent=message;$("execResults").innerHTML='<div class="plan-placeholder">'+safe(message)+'</div>';};
    if(!userId||!cloudReady){fail("Private cloud session is not ready. Sign in and wait for the options journal to sync.");return;}
    if(!Number.isFinite(capital)||capital<100||!Number.isFinite(mult)||mult<=0||!Number.isInteger(mult)||!Number.isFinite(qty)||qty<1||!Number.isInteger(qty)||!Number.isFinite(premium)||premium<=0){fail("Enter valid capital, whole-contract quantity, multiplier, and premium values.");return;}
    if(action==="Buy"){
      const q=selectedQuote,time=quoteTime(q);
      if(!q||!time.fresh||!(Number(q.ask)>0)||!(Number(q.bid)>0)||$("execContract").value!==q.ticker){fail("Select a current contract quote with a valid bid and ask. No manual or stale quote can be treated as verified.");return;}
      if(Math.abs(premium-Number(q.ask))>0.000001){fail("Buy-to-open premium must match the selected provider ask. Re-select the quote to refresh it.");return;}
      if(!Number.isFinite(stop)||stop<=0||stop>=100||!Number.isFinite(target)||target<=0||!Number.isFinite(riskPct)||riskPct<=0||riskPct>100){fail("Enter a valid stop below 100%, positive target, and risk budget between 0% and 100%.");return;}
      let math;
      try { math=calculateLongOption({premium,multiplier:mult,quantity:qty,stopPct:stop,targetPct:target,capital,riskPct}); }
      catch(error) { fail(error.message); return; }
      const maxQty=math.maxContracts;
      if(maxQty<1){fail("No whole contract fits both your capital and risk budget. Increase capital or risk budget, or choose a lower-premium contract.");return;}
      if(qty>maxQty){$("execQty").value=maxQty;fail("Quantity reduced to "+maxQty+" contract(s), the maximum allowed by both the "+money(capital*riskPct/100)+" risk budget and "+money(capital)+" capital. Review and calculate again.");return;}
      const debit=math.debit,plannedRisk=math.plannedStopRisk,maxLoss=math.maximumLoss,stopPremium=math.stopPremium,targetPremium=math.targetPremium,potential=math.potentialProfit,rr=math.riskReward;
      pending={action,underlying_symbol:activeSymbol,contract_symbol:q.ticker,contract_type:q.contractType,expiration_date:q.expirationDate,strike:Number(q.strike),quantity:qty,multiplier:mult,entry_premium:premium,stop_pct:stop,stop_premium:stopPremium,target_pct:target,target_premium:targetPremium,underlying_entry:Number(q.underlyingPrice)||null,quote_bid:Number(q.bid),quote_ask:Number(q.ask),quote_last:Number(q.last)||null,quote_mid:(Number(q.bid)+Number(q.ask))/2,quote_timestamp:new Date(time.ms).toISOString(),quote_timeframe:"snapshot",quote_source:"Massive",risk_dollars:plannedRisk,max_loss:maxLoss,max_profit:potential,risk_note:"Long option debit; max loss is the premium paid. Planned stop risk assumes execution at the stop premium and is not guaranteed."};
      $("execResults").innerHTML='<div class="result-grid"><div class="result-tile"><small>POSITION COST</small><b>'+money(debit)+'</b></div><div class="result-tile"><small>PLANNED STOP RISK</small><b>'+money(plannedRisk)+'</b></div><div class="result-tile"><small>MAXIMUM LOSS</small><b>'+money(maxLoss)+'</b></div><div class="result-tile"><small>PROFIT AT TARGET</small><b>'+money(potential)+'</b></div><div class="result-tile"><small>STOP PREMIUM</small><b>'+money(stopPremium)+'</b></div><div class="result-tile"><small>TARGET PREMIUM</small><b>'+money(targetPremium)+'</b></div><div class="result-tile"><small>RISK : REWARD</small><b>1 : '+rr.toFixed(2)+'</b></div><div class="result-tile"><small>CAPITAL AFTER DEBIT</small><b>'+money(capital-debit)+'</b></div></div><p class="result-note">'+qty+' contract(s) × '+money(premium)+' × '+mult+' multiplier. Stop risk is an estimate; option prices can gap through stops. Maximum loss on a long option is the full debit. Quote source: Massive; timestamp '+safe(new Date(time.ms).toLocaleString())+'. Fees and slippage excluded.</p>';
    }else{
      const trade=optionTrades.find(t=>t.id===$("execOpenTrade").value&&t.status==="Open");
      const q=selectedQuote,time=quoteTime(q);
      if(!trade){fail("Select an open option position to close.");return;}
      if(!q||q.ticker!==trade.contract_symbol||!time.fresh||!(Number(q.bid)>0)||$("execContract").value!==q.ticker){fail("Select the same contract's current bid quote before recording a close.");return;}
      if(Math.abs(premium-Number(q.bid))>0.000001){fail("Sell-to-close premium must match the selected provider bid. Re-select the quote.");return;}
      const closeMath=calculateCloseMetrics({entryPremium:Number(trade.entry_premium),exitPremium:premium,quantity:Number(trade.quantity),multiplier:Number(trade.multiplier)});
      const realized=closeMath.realizedPnl;
      pending={action:"Close",trade_id:trade.id,exit_premium:premium,pnl:realized,quote_bid:Number(q.bid),quote_ask:Number(q.ask)||null,quote_last:Number(q.last)||null,quote_mid:Number(q.bid)>0&&Number(q.ask)>0?(Number(q.bid)+Number(q.ask))/2:null,quote_timestamp:new Date(time.ms).toISOString(),quote_source:"Massive"};
      $("execResults").innerHTML='<div class="result-grid"><div class="result-tile"><small>ENTRY DEBIT</small><b>'+money(Number(trade.entry_premium)*trade.quantity*trade.multiplier)+'</b></div><div class="result-tile"><small>EXIT CREDIT</small><b>'+money(premium*trade.quantity*trade.multiplier)+'</b></div><div class="result-tile"><small>REALIZED P/L</small><b>'+money(realized)+'</b></div><div class="result-tile"><small>COMPOUNDED CAPITAL</small><b>'+money(Math.max(0,capital+optionTrades.filter(t=>t.status==="Closed").reduce((s,t)=>s+(Number(t.pnl)||0),0)+realized))+'</b></div></div><p class="result-note">Sell-to-close estimate uses the current provider bid. Realized P/L = (exit premium − entry premium) × contracts × multiplier. This is a paper record, not a broker fill.</p>';
    }
    $("execSave").disabled=false;$("execSnapshot").disabled=false;
  }
  async function saveExecution(){
    if(!pending||!userId||!cloudReady)return;
    $("execSave").disabled=true;
    try{
      if(pending.action==="Buy"){
        const row={user_id:userId,underlying_symbol:pending.underlying_symbol,contract_symbol:pending.contract_symbol,contract_type:pending.contract_type,expiration_date:pending.expiration_date,strike:pending.strike,side:"Buy",quantity:pending.quantity,multiplier:pending.multiplier,entry_premium:pending.entry_premium,stop_pct:pending.stop_pct,stop_premium:pending.stop_premium,target_pct:pending.target_pct,target_premium:pending.target_premium,underlying_entry:pending.underlying_entry,quote_bid:pending.quote_bid,quote_ask:pending.quote_ask,quote_last:pending.quote_last,quote_mid:pending.quote_mid,quote_timestamp:pending.quote_timestamp,quote_timeframe:pending.quote_timeframe,quote_source:pending.quote_source,risk_dollars:pending.risk_dollars,max_loss:pending.max_loss,max_profit:pending.max_profit,risk_note:pending.risk_note,status:"Open"};
        const {error}=await supabase.from(table).insert(row);if(error)throw error;
      }else{
        const {error}=await supabase.from(table).update({status:"Closed",exit_premium:pending.exit_premium,pnl:pending.pnl,closed_at:new Date().toISOString(),quote_bid:pending.quote_bid,quote_ask:pending.quote_ask,quote_last:pending.quote_last,quote_mid:pending.quote_mid,quote_timestamp:pending.quote_timestamp,quote_source:pending.quote_source}).eq("id",pending.trade_id).eq("user_id",userId).eq("status","Open");
        if(error)throw error;
      }
      pending=null;$("execSave").disabled=true;$("execSnapshot").disabled=true;
      $("execResults").insertAdjacentHTML("beforeend",'<p class="result-note">Saved to your private Supabase options journal.</p>');
      await loadTrades();
    }catch(error){$("execError").textContent="Could not save the options paper trade: "+error.message;$("execSave").disabled=false;}
  }
  function downloadReport(){
    if(!pending)return;
    const p=pending;
    const rows=Object.entries(p).map(([k,v])=>"<tr><th>"+safe(k.replaceAll("_"," "))+"</th><td>"+safe(v??"—")+"</td></tr>").join("");
    const html='<!doctype html><html><head><meta charset="utf-8"><title>RO’Lyfe Personal Execution Report</title><style>body{font:14px Arial;background:#f4f7f5;color:#18271f;padding:32px}main{max-width:760px;margin:auto;background:white;padding:28px;border-radius:14px}h1{color:#174d2d}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #ddd}th{text-transform:capitalize;color:#496454;width:42%}small{color:#63776a}</style></head><body><main><h1>RO’Lyfe Personal Execution</h1><p>Simulated trade record · Not a brokerage confirmation</p><table>'+rows+'</table><p><small>Quotes and calculated values are provider snapshot estimates. Stops may not execute at the stop price. No order was sent to a broker.</small></p></main></body></html>';
    const url=URL.createObjectURL(new Blob([html],{type:"text/html"}));const a=document.createElement("a");a.href=url;a.download="rolyfe-personal-execution-report.html";a.click();URL.revokeObjectURL(url);
  }
  function exportCsv(){
    if(!optionTrades.length){alert("No options paper trades to export.");return;}
    const cols=["trade_date","underlying_symbol","contract_symbol","contract_type","expiration_date","strike","side","quantity","multiplier","entry_premium","stop_pct","stop_premium","target_pct","target_premium","quote_bid","quote_ask","quote_mid","quote_timestamp","quote_source","risk_dollars","max_loss","max_profit","status","exit_premium","pnl","closed_at"];
    const csv=[cols.join(","),...optionTrades.map(t=>cols.map(k=>JSON.stringify(t[k]??"")).join(","))].join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="rolyfe-options-paper-journal.csv";a.click();URL.revokeObjectURL(url);
  }
  $("execLoad").addEventListener("click",requestChain);
  $("execType").addEventListener("change",()=>{if(currentSymbol())requestChain();});
  $("execExpiry").addEventListener("change",requestChain);
  $("execAction").addEventListener("change",()=>{
    const close=$("execAction").value==="Close";
    $("execOpenTrade").parentElement.hidden=!close;
    if(selectedQuote)$("execPremium").value=(close?selectedQuote.bid:selectedQuote.ask)||"";
  });
  $("execStop").addEventListener("change",()=>$("execCustomStopWrap").hidden=$("execStop").value!=="custom");
  $("execForm").addEventListener("submit",calculate);
  $("execCalculate").addEventListener("click",calculate);
  $("execSave").addEventListener("click",saveExecution);
  $("execSnapshot").addEventListener("click",downloadReport);
  $("execExport").addEventListener("click",exportCsv);
  $("execCapital").addEventListener("change",renderTrades);
  $("execOpenTrade").parentElement.hidden=true;
  document.addEventListener("click",e=>{
    const nav=e.target.closest("[data-view='execution'],[data-go='execution']");
    if(nav){syncSymbol();if(!contracts.length&&currentSymbol())requestChain();}
  });
  $("chartSymbol")?.addEventListener("change",()=>{
    const next=currentSymbol();
    if(next!==activeSymbol){activeSymbol=next;clearChain();$("execSymbol").value=next||"Select a chart symbol";}
  });
  supabase.auth.onAuthStateChange((_event,next)=>{session=next;userId=next?.user?.id||null;loadTrades();});
  getSession().then(()=>{activeSymbol=currentSymbol();$("execSymbol").value=activeSymbol||"Select a chart symbol";loadTrades();}).catch(error=>setStatus("Sign-in required: "+error.message));
})();
