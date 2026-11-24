/* RO'Lyfe shared Futures Bias widget — no mock fallback. */
(function (root, factory) {
  const scriptSrc = typeof document !== "undefined" ? (document.currentScript && document.currentScript.src || "shared/futures-bias-widget.js") : "";
  const api = factory(scriptSrc);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ROLyfeFuturesBiasWidget = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", api.mountAll, { once: true });
    else api.mountAll();
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function (scriptSrc) {
  "use strict";
  const API = "https://ykmdyfbklvuoseqdjnxy.supabase.co/functions/v1/futures-market-data";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrbWR5ZmJrbHZ1b3NlcWRqbnh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3ODk5OTQsImV4cCI6MjEwODM2NTk5NH0._YEZj2GSnPcLGXmwgj98V_JzXdJIhTmOFoAH9BSia2I";
  const PRODUCTS = [
    { value: "ES", label: "ES · E-mini S&P 500" },
    { value: "NQ", label: "NQ · E-mini Nasdaq-100" },
    { value: "YM", label: "YM · E-mini Dow" },
    { value: "RTY", label: "RTY · E-mini Russell 2000" },
    { value: "CL", label: "CL · Crude Oil" }
  ];
  const FRAME_ORDER = ["1d", "4h", "1h", "15m", "5m"];
  function formatContract(contract) {
    const expiry = contract.lastTradeDate || contract.settlementDate || "expiry n/a";
    const days = Number.isFinite(Number(contract.daysToMaturity)) ? " · " + contract.daysToMaturity + "d" : "";
    const tick = Number.isFinite(Number(contract.tradeTickSize)) ? " · tick " + contract.tradeTickSize : "";
    return String(contract.ticker || "") + " · " + expiry + days + tick;
  }
  function formatTime(value) {
    if (!value) return "timestamp not supplied";
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "timestamp not supplied";
  }
  function statusCopy(result) {
    if (!result || result.status === "INCOMPLETE") return "INCOMPLETE · required timeframes are missing, lack 200 valid bars, or are not verified provider data.";
    if (result.status === "STALE") return "STALE · historical/delayed bars detected. This is context only, not a current trading signal.";
    if (result.status === "FRESH" && result.bias === "MIXED") return "FRESH DATA · higher/lower timeframe disagreement. Direction is mixed; wait for clearer structure.";
    if (result.status === "FRESH" && result.bias === "NEUTRAL") return "FRESH DATA · no directional edge in the current rule set. Neutral means wait, not a prediction.";
    if (result.status === "FRESH" && result.tradable) return "FRESH DATA · multi-timeframe confluence is aligned. This is a research condition, not an order instruction.";
    return "FRESH DATA · directional confluence is incomplete. Review timeframe details and invalidation.";
  }
  function ensureStyles() {
    if (typeof document === "undefined" || document.getElementById("rolFuturesBiasStyles")) return;
    const link = document.createElement("link");
    link.id = "rolFuturesBiasStyles";
    link.rel = "stylesheet";
    link.href = scriptSrc ? scriptSrc.replace(/futures-bias-widget\.js(?:\?.*)?$/, "futures-bias-widget.css") : "shared/futures-bias-widget.css";
    document.head.appendChild(link);
  }
  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text != null) item.textContent = String(text);
    return item;
  }
  async function request(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { apikey: ANON, Authorization: "Bearer " + ANON, Accept: "application/json" },
        cache: "no-store", signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || ("Futures data request failed (HTTP " + response.status + ")."));
        error.code = data.code || "FUTURES_DATA_ERROR";
        error.status = response.status;
        throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }
  function mount(host) {
    if (!host || host.dataset.rolFuturesBiasMounted === "true") return;
    host.dataset.rolFuturesBiasMounted = "true";
    ensureStyles();
    const root = node("section", "rol-futures-bias");
    root.setAttribute("aria-label", "RO'Lyfe Futures Bias");
    const header = node("div", "rol-fb-head");
    const heading = node("div");
    heading.append(node("div", "rol-fb-eyebrow", "RO'LYFE · FUTURES INTELLIGENCE"));
    heading.append(node("h2", "", "Multi-Timeframe Futures Bias"));
    heading.append(node("p", "", "Contract-specific direction from verified provider bars. No broker routing."));
    header.append(heading); root.append(header);
    const controls = node("div", "rol-fb-controls");
    const productLabel = node("label", "", "FUTURES PRODUCT");
    const productSelect = node("select");
    productSelect.setAttribute("aria-label", "Futures product");
    PRODUCTS.forEach(product => { const option=node("option","",product.label); option.value=product.value; productSelect.append(option); });
    productLabel.append(productSelect);
    const contractLabel = node("label", "", "ACTIVE CONTRACT · PROVIDER LIST");
    const contractSelect = node("select");
    contractSelect.setAttribute("aria-label", "Active futures contract");
    const placeholder = node("option", "", "Load active contracts first"); placeholder.value=""; placeholder.selected=true; contractSelect.append(placeholder);
    contractLabel.append(contractSelect);
    const contractsButton=node("button","","Load contracts"); contractsButton.type="button";
    const refreshButton=node("button","","Refresh bias"); refreshButton.type="button"; refreshButton.disabled=true;
    const loadChartButton=node("button","","Load in main chart");loadChartButton.type="button";loadChartButton.disabled=true;
    controls.append(productLabel,contractLabel,contractsButton,refreshButton,loadChartButton); root.append(controls);
    const status=node("div","rol-fb-status","Not loaded · choose a product and load its provider-listed active contracts.");
    status.setAttribute("role","status"); status.setAttribute("aria-live","polite"); root.append(status);
    const summary=node("div","rol-fb-summary");
    const biasCard=node("div","rol-fb-bias-card"); biasCard.append(node("small","","DIRECTIONAL BIAS"));
    const direction=node("strong","rol-fb-direction","UNAVAILABLE"); direction.dataset.bias="UNAVAILABLE"; biasCard.append(direction);
    const meta=node("span","rol-fb-meta","No futures contract selected."); biasCard.append(meta);
    const scoreCard=node("div","rol-fb-score-card"); scoreCard.append(node("small","","CONFLUENCE SCORE · NOT PROBABILITY"));
    const score=node("strong","rol-fb-score","—"); scoreCard.append(score);
    scoreCard.append(node("span","rol-fb-meta","Rule-based score from available timeframe checks."));
    summary.append(biasCard,scoreCard); root.append(summary);
    const frameGrid=node("div","rol-fb-frames");
    FRAME_ORDER.forEach(tf=>{
      const card=node("div","rol-fb-frame");card.dataset.timeframe=tf;
      card.append(node("b","",tf.toUpperCase()));
      card.append(node("strong","rol-fb-frame-direction","WAITING"));
      card.append(node("span","rol-fb-frame-detail","No timeframe data loaded."));
      frameGrid.append(card);
    });
    root.append(frameGrid);
    const details=document.createElement("details");details.className="rol-fb-details";
    const detailsSummary=node("summary","","Show indicator checks, provenance and invalidation levels");
    const list=document.createElement("ul");details.append(detailsSummary,list);root.append(details);
    root.append(node("div","rol-fb-disclaimer","DATA / RISK NOTICE · Stale or incomplete bars never produce a current trading signal. A directional score is not a win probability, price forecast or order. Confirm provider entitlement, quote timing, contract expiry, tick size, liquidity and your own stop/invalidation. Paper research only."));
    host.replaceChildren(root);
    let busy=false, contracts=[];
    function setStatus(message,state){status.textContent=message;status.dataset.state=state||"neutral";}
    function setBusy(value){
      busy=value;root.classList.toggle("rol-fb-loading",busy);
      contractsButton.disabled=busy;refreshButton.disabled=busy||!contractSelect.value;loadChartButton.disabled=busy||!contractSelect.value;
      productSelect.disabled=busy;contractSelect.disabled=busy||!contracts.length;
    }
    function showUnavailable(message){
      direction.textContent="UNAVAILABLE";direction.dataset.bias="UNAVAILABLE";score.textContent="—";meta.textContent=message;
      frameGrid.querySelectorAll(".rol-fb-frame").forEach(card=>{
        card.querySelector(".rol-fb-frame-direction").textContent="WAIT";
        card.querySelector(".rol-fb-frame-detail").textContent="No verified frame.";
      });
      list.replaceChildren(node("li","",message));
    }
    function renderAnalysis(result,contract){
      direction.textContent=result.bias||"UNAVAILABLE";direction.dataset.bias=result.bias||"UNAVAILABLE";
      score.textContent=result.score==null?"—":((result.score>0?"+":"")+result.score+" / 100");
      const selected=contracts.find(item=>item.ticker===contract)||{};
      meta.textContent=[
        contract,
        selected.lastTradeDate||selected.settlementDate?"Expiry "+(selected.lastTradeDate||selected.settlementDate):"",
        "Provider "+(result.providers||["Massive Futures"]).join(", "),
        result.asOf?"As of "+formatTime(result.asOf):"As-of time unavailable"
      ].filter(Boolean).join(" · ");
      const items=[];
      (result.frames||[]).forEach(frame=>{
        const card=frameGrid.querySelector('[data-timeframe="'+frame.timeframe+'"]');if(!card)return;
        const signal=card.querySelector(".rol-fb-frame-direction"),text=card.querySelector(".rol-fb-frame-detail");
        if(!frame.valid){signal.textContent="WAIT";text.textContent=frame.reason||"Frame unavailable.";items.push(frame.timeframe.toUpperCase()+": "+(frame.reason||"Frame unavailable."));return;}
        signal.textContent=frame.stale?frame.direction+" · STALE":frame.direction;
        text.textContent="Score "+frame.confluenceScore+" · Close "+Number(frame.close).toFixed(2)+" · "+formatTime(frame.asOf);
        (frame.signals||[]).forEach(check=>items.push(frame.timeframe.toUpperCase()+" · "+check.name+": "+check.detail));
      });
      if(result.invalidation)items.push("1H reference invalidation: bullish below "+Number(result.invalidation.bullishBelow).toFixed(2)+"; bearish above "+Number(result.invalidation.bearishAbove).toFixed(2)+". "+result.invalidation.note);
      list.replaceChildren(...items.map(item=>node("li","",item)));
      setStatus(statusCopy(result),result.status==="STALE"||result.status==="INCOMPLETE"?"warning":"neutral");
    }
    contractsButton.addEventListener("click",async()=>{
      if(busy)return;setBusy(true);contractSelect.replaceChildren(node("option","","Loading provider contracts…"));contractSelect.value="";
      refreshButton.disabled=true;showUnavailable("Provider contracts have not been loaded.");
      const product=productSelect.value;setStatus("Requesting active "+product+" contracts from Massive Futures…");
      try{
        const data=await request(API+"?action=contracts&product="+encodeURIComponent(product));
        contracts=Array.isArray(data.contracts)?data.contracts:[];
        contractSelect.replaceChildren();
        if(!contracts.length){
          contractSelect.append(node("option","","No active contracts returned"));contractSelect.value="";
          setStatus("No provider-listed active contracts were returned for "+product+". Check product coverage, account entitlement and requested session date.","warning");
          showUnavailable("No active contracts returned by provider.");return;
        }
        const prompt=node("option","","Choose active contract…");prompt.value="";contractSelect.append(prompt);
        contracts.forEach(contract=>{const option=node("option","",formatContract(contract));option.value=contract.ticker;contractSelect.append(option);});
        setStatus(contracts.length+" provider-listed "+product+" contracts returned. Select the desired expiry; the nearest expiry is not automatically assumed.");
        contractSelect.disabled=false;
      }catch(error){
        contracts=[];contractSelect.replaceChildren(node("option","","Contract lookup unavailable"));
        const message=error.code==="MASSIVE_KEY_MISSING"?"Massive Futures key is missing from Supabase Edge Function Secrets.":(error.message||"Contract lookup failed.");
        setStatus(message+" No sample contract has been substituted.","error");showUnavailable(message);
      }finally{setBusy(false);}
    });
    productSelect.addEventListener("change",()=>{
      contracts=[];contractSelect.replaceChildren(node("option","","Load active contracts first"));contractSelect.value="";
      refreshButton.disabled=true;loadChartButton.disabled=true;showUnavailable("Load provider-listed contracts for the selected futures product.");
      setStatus("Product changed · load active contracts before refreshing bias.");
    });
    contractSelect.addEventListener("change",()=>{
      refreshButton.disabled=busy||!contractSelect.value;loadChartButton.disabled=busy||!contractSelect.value;
      if(contractSelect.value){showUnavailable("Selected "+contractSelect.value+" · refresh to calculate its Futures Bias or load it into the main chart.");setStatus("Selected contract "+contractSelect.value+". Refresh requests five timeframe datasets.");}
    });
    loadChartButton.addEventListener("click",()=>{
      const contract=contracts.find(item=>item.ticker===contractSelect.value);
      if(!contract)return;
      setStatus("Switching primary chart to "+contract.ticker+" · 1D first. Indicators and RL Pullback will recalculate from its provider bars.");
      window.dispatchEvent(new CustomEvent("rolyfe:load-futures-chart",{detail:{contract:contract.ticker,symbol:contract.ticker,product:productSelect.value,name:contract.name,contractSpec:contract}}));
    });
    refreshButton.addEventListener("click",async()=>{
      if(busy||!contractSelect.value)return;const contract=contractSelect.value;setBusy(true);
      setStatus("Requesting 1D, 4H, 1H, 15M and 5M historical bars for "+contract+"…");
      showUnavailable("Fetching provider bars. No directional bias is available until all five frames validate.");
      try{
        const data=await request(API+"?action=frames&contract="+encodeURIComponent(contract));
        if(!data.frames||typeof data.frames!=="object")throw new Error("Provider response did not include timeframe data.");
        const engine=window.ROLyfeFuturesBias;if(!engine||typeof engine.analyze!=="function")throw new Error("Shared Futures Bias calculation engine did not load.");
        renderAnalysis(engine.analyze({frames:data.frames},{now:Date.now()}),contract);
      }catch(error){
        const message=error.message||"Futures data refresh failed.";
        const prefix=/429|rate limit/i.test(message)?"Provider rate limit reached. Wait for the account rate window, then retry. ":
          (/403|entitlement|permission/i.test(message)?"Futures endpoint entitlement may not be included in this Massive plan. ":"");
        setStatus(prefix+message+" Existing market-data and chart feeds were not changed.","error");showUnavailable(message);
      }finally{setBusy(false);}
    });
    host.rolFuturesBias=Object.freeze({reloadContracts:function(){contractsButton.click();},refresh:function(){refreshButton.click();}});
  }
  function mountAll(){if(typeof document==="undefined")return;document.querySelectorAll("[data-rol-futures-bias]").forEach(mount);}
  return Object.freeze({
    mount,mountAll,formatContract,formatTime,statusCopy,
    products:PRODUCTS.map(item=>item.value),timeframes:FRAME_ORDER
  });
});
