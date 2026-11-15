/* RO'Lyfe shared cross-engine tools: date/time, shared instrument, language, translation and voice. */
(() => {
  "use strict";
  if (window.__ROLYFE_GLOBAL_TOOLS__) return;
  window.__ROLYFE_GLOBAL_TOOLS__ = true;

  const LANG_KEY = "rolyfe-ui-language";
  const SYMBOL_KEY = "rolyfe-active-symbol";
  const VOICE_KEY = "rolyfe-voice-replies";
  const SUPABASE_URL = "https://ykmdyfbklvuoseqdjnxy.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrbWR5ZmJrbHZ1b3NlcWRqbnh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3ODk5OTQsImV4cCI6MjEwODM2NTk5NH0._YEZj2GSnPcLGXmwgj98V_JzXdJIhTmOFoAH9BSia2I";
  const LANGUAGES = [
    {name:"English",label:"English",code:"en",locale:"en-US"},
    {name:"Spanish",label:"Español",code:"es",locale:"es-ES"},
    {name:"French",label:"Français",code:"fr",locale:"fr-FR"},
    {name:"Haitian Creole",label:"Kreyòl Ayisyen",code:"ht",locale:"ht-HT"},
    {name:"Portuguese",label:"Português",code:"pt",locale:"pt-BR"},
    {name:"German",label:"Deutsch",code:"de",locale:"de-DE"},
    {name:"Italian",label:"Italiano",code:"it",locale:"it-IT"},
    {name:"Arabic",label:"العربية",code:"ar",locale:"ar-SA"},
    {name:"Chinese (Simplified)",label:"简体中文",code:"zh-CN",locale:"zh-CN"},
    {name:"Japanese",label:"日本語",code:"ja",locale:"ja-JP"},
    {name:"Korean",label:"한국어",code:"ko",locale:"ko-KR"},
    {name:"Hindi",label:"हिन्दी",code:"hi",locale:"hi-IN"}
  ];
  const MARKET_SYMBOLS = ["AAPL","NVDA","TSLA","AMD","SPY","MSFT","AMZN","GOOGL","GOOG","META","NFLX","AVGO","ORCL","CRM","ADBE","QCOM","INTC","MU","ARM","SMCI","PLTR","COIN","HOOD","MSTR","JPM","BAC","WFC","GS","MS","V","MA","AXP","COST","WMT","TGT","HD","LOW","NKE","DIS","UBER","ABNB","SHOP","SNOW","PANW","CRWD","NET","DDOG","IBM","CSCO","NOW","PYPL","SQ","SOFI","XOM","CVX","LLY","JNJ","PFE","MRNA","UNH","ABBV","TMO","CAT","DE","BA","GE","F","GM","RIVN","LCID","IWM","QQQ","DIA","VTI","GLD","TLT","BTC-USD","ETH-USD","SOL-USD","XRP-USD","LINK-USD","HYPE-USD","BNB-USD","ADA-USD","DOGE-USD","AVAX-USD","DOT-USD","LTC-USD","BCH-USD","SUI-USD","TON-USD","TRX-USD","XLM-USD","HBAR-USD","SHIB-USD","PEPE-USD","UNI-USD","AAVE-USD","NEAR-USD","APT-USD","ARB-USD","OP-USD","ICP-USD","FIL-USD","ATOM-USD","ETC-USD","XMR-USD","INJ-USD","RENDER-USD","FET-USD","TAO-USD","SEI-USD","TIA-USD","IMX-USD","GRT-USD","MKR-USD","PENDLE-USD","ONDO-USD","JUP-USD","WIF-USD","BONK-USD","FLOKI-USD","ALGO-USD","VET-USD","RUNE-USD","CRV-USD"];
  const LANG_BY_NAME = new Map(LANGUAGES.map(item => [item.name,item]));
  const safeGet = (key,fallback="") => { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } };
  const safeSet = (key,value) => { try { localStorage.setItem(key,String(value)); } catch (_) {} };
  const normalizeSymbol = value => String(value||"").trim().toUpperCase().replace(/\\s+/g,"");
  let selectedLanguage = LANG_BY_NAME.get(safeGet(LANG_KEY,"English")) || LANGUAGES[0];
  let voiceEnabled = safeGet(VOICE_KEY,"false")==="true";
  let isApplying = false;
  let pageTranslationInProgress = false;
  let dynamicTimer = null;
  const originalText = new Map();
  const originalAttributes = new Map();
  const translationCache = new Map();

  function currentLanguage(){ return selectedLanguage; }
  function updateDocumentLanguage(){
    document.documentElement.lang = selectedLanguage.locale;
    document.documentElement.dir = selectedLanguage.code === "ar" ? "rtl" : "ltr";
    window.ROLyfeLanguage = selectedLanguage;
  }
  function setActiveSymbol(value, fromApp=false){
    const symbol = normalizeSymbol(value);
    if(!/^[A-Z0-9.^/_!:=!-]{1,24}$/.test(symbol)) return false;
    safeSet(SYMBOL_KEY,symbol);
    const input=document.getElementById("rol-global-symbol");
    const chip=document.getElementById("rol-global-symbol-current");
    if(input) input.value=symbol;
    if(chip) chip.textContent=symbol;
    if(!fromApp){
      window.dispatchEvent(new CustomEvent("rol-global-symbol-change",{detail:{symbol}}));
      try{ window.parent && window.parent!==window && window.parent.postMessage({type:"rol-global-symbol-change",symbol},location.origin); }catch(_){}
    }
    return true;
  }
  function getInitialSymbol(){
    const saved=normalizeSymbol(safeGet(SYMBOL_KEY,""));
    if(saved) return saved;
    const selectors=["#classroomSymbol","#symbol-select","#symbol","#chartSymbol","#independent-chart-symbol"];
    for(const selector of selectors){
      const el=document.querySelector(selector);
      if(el?.value) return normalizeSymbol(el.value.split(":").pop());
    }
    return "NVDA";
  }

  function injectStyles(){
    if(document.getElementById("rol-global-tools-style"))return;
    const style=document.createElement("style");
    style.id="rol-global-tools-style";
    style.textContent=`
      #rol-global-tools{position:relative;z-index:50;display:grid;grid-template-columns:minmax(155px,.85fr) minmax(220px,1.05fr) minmax(245px,1.4fr);gap:10px;align-items:center;width:100%;box-sizing:border-box;padding:10px 16px;margin:0;background:linear-gradient(100deg,#0a1a14,#10251c);border-bottom:1px solid #294838;color:#e7f1eb;font:12px/1.4 Arial,sans-serif}
      #rol-global-tools *{box-sizing:border-box}
      #rol-global-tools .rol-global-group{display:flex;align-items:center;gap:8px;min-width:0}
      #rol-global-tools .rol-global-time{display:grid;gap:2px}
      #rol-global-tools small{font-size:9px;letter-spacing:.08em;color:#91ad9d}
      #rol-global-tools strong{font:700 13px ui-monospace,monospace;color:#8ce5b4}
      #rol-global-tools input,#rol-global-tools select{min-width:0;max-width:100%;height:36px;padding:7px 9px;border:1px solid #345743;border-radius:8px;background:#07130e;color:#e7f1eb;font:12px Arial,sans-serif}
      #rol-global-tools input{width:min(125px,45vw);text-transform:uppercase}
      #rol-global-tools button{min-height:36px;border:1px solid #3c7953;border-radius:8px;padding:7px 10px;background:#163a27;color:#9be8ba;font-weight:700;font-size:10px;cursor:pointer}
      #rol-global-tools .rol-global-current{font:700 12px ui-monospace,monospace;color:#8ce5b4;white-space:nowrap}
      #rol-global-tools .rol-global-language{display:flex;align-items:center;gap:7px;justify-content:flex-end;min-width:0;flex-wrap:wrap}
      #rol-global-tools .rol-global-status{grid-column:1/-1;min-height:13px;font-size:9px;color:#91ad9d;overflow-wrap:anywhere}
      #rol-global-tools[dir="rtl"]{direction:rtl}
      @media(max-width:760px){#rol-global-tools{grid-template-columns:1fr 1fr;padding:9px 11px;gap:8px}#rol-global-tools .rol-global-language{grid-column:1/-1;justify-content:flex-start}#rol-global-tools .rol-global-status{grid-column:1/-1}}
      @media(max-width:390px){#rol-global-tools{grid-template-columns:1fr}#rol-global-tools .rol-global-language{justify-content:flex-start}#rol-global-tools input{width:112px}#rol-global-tools .rol-global-time strong{font-size:12px}}
    `;
    document.head.appendChild(style);
  }

  function injectToolbar(){
    if(document.getElementById("rol-global-tools"))return;
    injectStyles();
    const bar=document.createElement("section");
    bar.id="rol-global-tools";
    bar.setAttribute("aria-label","RO'Lyfe shared market, time and language controls");
    bar.innerHTML=`
      <div class="rol-global-group rol-global-time" data-no-translate>
        <small>NEW YORK MARKET TIME · ET</small>
        <strong id="rol-global-clock">--:--:--</strong>
        <span id="rol-global-date">Loading date…</span>
      </div>
      <div class="rol-global-group" data-no-translate>
        <div style="display:grid;gap:3px;min-width:0"><small>ACTIVE INSTRUMENT</small><span class="rol-global-current" id="rol-global-symbol-current">NVDA</span></div>
        <input id="rol-global-symbol" type="text" list="rol-global-symbol-list" maxlength="24" aria-label="Choose global stock ETF crypto or market symbol" placeholder="Ticker">
        <datalist id="rol-global-symbol-list">${MARKET_SYMBOLS.map(symbol=>'<option value="'+symbol+'"></option>').join("")}</datalist>
        <button type="button" id="rol-global-symbol-apply">Set</button>
      </div>
      <div class="rol-global-group rol-global-language" data-no-translate>
        <label for="rol-global-language"><small>LANGUAGE</small></label>
        <select id="rol-global-language" aria-label="Select page language">${LANGUAGES.map(l=>'<option value="'+l.name+'">'+l.label+'</option>').join("")}</select>
        <button type="button" id="rol-global-voice" aria-pressed="${voiceEnabled}">${voiceEnabled?"Voice replies: On":"Voice replies: Off"}</button>
        <button type="button" id="rol-global-translate">Translate page</button>
      </div>
      <div class="rol-global-status" id="rol-global-status" aria-live="polite">Symbols synchronize across RO’Lyfe pages on this browser. Language changes translate the page and set the AI response language.</div>
    `;
    const anchor=document.querySelector(".topbar")||document.querySelector("header")||document.querySelector(".status-bar")||document.querySelector("main")||document.body.firstElementChild;
    if(anchor?.parentNode) anchor.parentNode.insertBefore(bar,anchor.nextSibling);
    else document.body.prepend(bar);
    const symbol=getInitialSymbol();
    const input=document.getElementById("rol-global-symbol");
    if(input)input.value=symbol;
    const chip=document.getElementById("rol-global-symbol-current");
    if(chip)chip.textContent=symbol;
    const language=document.getElementById("rol-global-language");
    if(language)language.value=selectedLanguage.name;
    const apply=document.getElementById("rol-global-symbol-apply");
    apply?.addEventListener("click",()=>{const value=input?.value||"";if(!setActiveSymbol(value)){setStatus("Enter a valid ticker or market symbol.");return;}setStatus("Active instrument changed to "+normalizeSymbol(value)+". The current engine will load it where supported.");});
    input?.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();apply?.click();}});
    language?.addEventListener("change",()=>selectLanguage(language.value,true));
    document.getElementById("rol-global-translate")?.addEventListener("click",()=>translatePage());
    document.getElementById("rol-global-voice")?.addEventListener("click",toggleVoice);
    updateClock();setInterval(updateClock,1000);
  }
  function updateClock(){
    const now=new Date();
    const clock=document.getElementById("rol-global-clock");
    const date=document.getElementById("rol-global-date");
    if(clock)clock.textContent=new Intl.DateTimeFormat(selectedLanguage.locale,{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true}).format(now);
    if(date)date.textContent=new Intl.DateTimeFormat(selectedLanguage.locale,{timeZone:"America/New_York",weekday:"long",year:"numeric",month:"short",day:"numeric"}).format(now);
  }
  function setStatus(message){const node=document.getElementById("rol-global-status");if(node)node.textContent=message;}
  function toggleVoice(){
    voiceEnabled=!voiceEnabled;safeSet(VOICE_KEY,String(voiceEnabled));
    const button=document.getElementById("rol-global-voice");
    if(button){button.setAttribute("aria-pressed",String(voiceEnabled));button.textContent=voiceEnabled?"Voice replies: On":"Voice replies: Off";}
    if(!voiceEnabled&&"speechSynthesis" in window)window.speechSynthesis.cancel();
    setStatus(voiceEnabled?"AI voice replies enabled where the agent is connected.":"AI voice replies disabled.");
  }
  function speak(text){
    if(!voiceEnabled||!("speechSynthesis" in window)||!String(text||"").trim())return;
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(String(text).slice(0,4500));
    utterance.lang=selectedLanguage.locale;
    const voices=window.speechSynthesis.getVoices?.()||[];
    const voice=voices.find(v=>v.lang?.toLowerCase()===selectedLanguage.locale.toLowerCase())||voices.find(v=>v.lang?.toLowerCase().startsWith(selectedLanguage.code.toLowerCase().split("-")[0]));
    if(voice)utterance.voice=voice;
    utterance.rate=1;window.speechSynthesis.speak(utterance);
  }
  window.ROLyfeSpeak=speak;
  window.ROLyfeLanguage=selectedLanguage;
  function selectLanguage(name,translateNow=false){
    selectedLanguage=LANG_BY_NAME.get(name)||LANGUAGES[0];
    safeSet(LANG_KEY,selectedLanguage.name);updateDocumentLanguage();updateClock();
    window.dispatchEvent(new CustomEvent("rol-language-change",{detail:{language:selectedLanguage}}));
    const voiceButton=document.getElementById("rol-global-voice");
    if(voiceButton)voiceButton.textContent=voiceEnabled?"Voice replies: On":"Voice replies: Off";
    if(translateNow){
      if(selectedLanguage.name==="English"){restorePage();setStatus("Page restored to English.");}
      else translatePage();
    }
  }

  function shouldSkipText(node){
    const parent=node.parentElement;
    if(!parent)return true;
    if(parent.closest('script,style,noscript,textarea,input,select,option,code,pre,svg,canvas,iframe,video,audio,[data-no-translate],.price,.quote,.symbol,.ticker,.market-price,.quote-value,.quote-cell,.chart,.tradingview-widget-container,#rol-global-tools'))return true;
    const value=(originalText.get(node)??node.nodeValue??"").trim();
    return value.length<2||!/[A-Za-z\\u00C0-\\u024F\\u0400-\\u04FF\\u0600-\\u06FF\\u4E00-\\u9FFF]/.test(value)||/^(?:[A-Z0-9$%.,:+/\\-]+)$/.test(value);
  }
  function collectTextNodes(root=document.body){
    const nodes=[];
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      if(!originalText.has(node))originalText.set(node,node.nodeValue);
      if(!shouldSkipText(node))nodes.push(node);
    }
    return nodes;
  }
  function collectAttributes(){
    const entries=[];
    const allowed=["aria-label","placeholder","title","alt"];
    document.querySelectorAll("body *").forEach(el=>{
      if(el.closest('[data-no-translate],script,style,code,pre,svg,canvas,iframe,#rol-global-tools,.chart,.tradingview-widget-container'))return;
      allowed.forEach(attr=>{
        if(!el.hasAttribute(attr))return;
        let saved=originalAttributes.get(el);
        if(!saved){saved={};originalAttributes.set(el,saved);}
        if(!(attr in saved))saved[attr]=el.getAttribute(attr);
        const value=saved[attr]||"";
        if(value.length>1&&/[A-Za-z\\u00C0-\\u024F]/.test(value)&&!/^([A-Z0-9$%.,:+/\\-]+)$/.test(value))entries.push({el,attr,source:value});
      });
    });
    return entries;
  }
  function restorePage(){
    isApplying=true;
    originalText.forEach((value,node)=>{if(node.isConnected)node.nodeValue=value;});
    originalAttributes.forEach((attrs,el)=>{if(el.isConnected)Object.entries(attrs).forEach(([attr,value])=>el.setAttribute(attr,value));});
    document.documentElement.dir="ltr";document.documentElement.lang="en";
    isApplying=false;
  }
  function hash(value){
    let h=2166136261;
    for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}
    return (h>>>0).toString(36);
  }
  async function requestTranslations(language,segments){
    const cacheKeys=segments.map(text=>language+"|"+hash(text));
    const out=new Array(segments.length);
    const uncached=[],uncachedIndex=[];
    segments.forEach((text,i)=>{
      const cached=translationCache.get(cacheKeys[i])||safeGet("rol-trx-"+cacheKeys[i],"");
      if(cached){out[i]=cached;translationCache.set(cacheKeys[i],cached);}
      else{uncached.push(text);uncachedIndex.push(i);}
    });
    if(uncached.length){
      const response=await fetch(SUPABASE_URL+"/functions/v1/rol-page-translate",{
        method:"POST",
        headers:{apikey:SUPABASE_ANON,Authorization:"Bearer "+SUPABASE_ANON,"Content-Type":"application/json",Accept:"application/json"},
        body:JSON.stringify({language,segments:uncached}),
        cache:"no-store"
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!Array.isArray(payload.translations))throw new Error(payload.error||"The page translation service is unavailable.");
      payload.translations.forEach((value,j)=>{
        const i=uncachedIndex[j];out[i]=value;translationCache.set(cacheKeys[i],value);
        try{safeSet("rol-trx-"+cacheKeys[i],value);}catch(_){}
      });
    }
    return out;
  }
  async function translateEntries(entries,language){
    const pending=entries.filter(x=>x.source.trim());
    let index=0,translated=0;
    while(index<pending.length){
      const batch=[];let chars=0;
      while(index<pending.length&&batch.length<35){
        const length=pending[index].source.length;
        if(batch.length&&chars+length>4200)break;
        batch.push(pending[index]);chars+=length;index++;
      }
      const translatedValues=await requestTranslations(language,batch.map(x=>x.source));
      isApplying=true;
      batch.forEach((entry,i)=>{
        if(entry.node?.isConnected)entry.node.nodeValue=translatedValues[i];
        else if(entry.el?.isConnected)entry.el.setAttribute(entry.attr,translatedValues[i]);
      });
      isApplying=false;translated+=batch.length;
      setStatus("Translating page into "+language+" · "+translated+" of "+pending.length+" text items…");
    }
  }
  async function translatePage(){
    if(selectedLanguage.name==="English"){restorePage();setStatus("Page is already in English.");return;}
    if(pageTranslationInProgress)return;
    pageTranslationInProgress=true;
    const button=document.getElementById("rol-global-translate");
    if(button)button.disabled=true;
    try{
      restorePage();
      const textEntries=collectTextNodes().map(node=>({node,source:originalText.get(node)}));
      const attrEntries=collectAttributes();
      const entries=[...textEntries,...attrEntries];
      await translateEntries(entries,selectedLanguage.name);
      document.documentElement.lang=selectedLanguage.locale;
      document.documentElement.dir=selectedLanguage.code==="ar"?"rtl":"ltr";
      setStatus("Page translated into "+selectedLanguage.name+". Symbols, prices, formulas and market values remain unchanged.");
      window.dispatchEvent(new CustomEvent("rol-page-translated",{detail:{language:selectedLanguage}}));
    }catch(error){
      setStatus(error.message||"Page translation failed. Check the secure AI translation service and its server-side key.");
    }finally{
      pageTranslationInProgress=false;
      if(button)button.disabled=false;
    }
  }

  document.addEventListener("change",event=>{
    const target=event.target;
    if(!target||target.closest?.("#rol-global-tools"))return;
    if(["classroomSymbol","symbol-select","symbol","chartSymbol","independent-chart-symbol"].includes(target.id)&&target.value){
      setActiveSymbol(target.value,true);
    }
  });
  window.addEventListener("rol-active-symbol-selected",event=>{const value=normalizeSymbol(event.detail?.symbol);if(value)setActiveSymbol(value,true);});
  window.addEventListener("rol-global-symbol-change",event=>{
    const symbol=normalizeSymbol(event.detail?.symbol);
    if(symbol){const input=document.getElementById("rol-global-symbol");if(input)input.value=symbol;const chip=document.getElementById("rol-global-symbol-current");if(chip)chip.textContent=symbol;}
  });
  window.addEventListener("storage",event=>{
    if(event.key===SYMBOL_KEY&&event.newValue){setActiveSymbol(event.newValue,false);}
    if(event.key===LANG_KEY&&event.newValue){selectLanguage(event.newValue,true);}
  });
  window.addEventListener("load",()=>{
    injectToolbar();
    updateDocumentLanguage();
    const symbol=safeGet(SYMBOL_KEY,"");
    if(symbol)setActiveSymbol(symbol,false);
    else setActiveSymbol(getInitialSymbol(),false);
    if(selectedLanguage.name!=="English")setTimeout(()=>translatePage(),900);
  });
  if(document.readyState==="complete")window.addEventListener("load",()=>{}, {once:true});
  else if(document.readyState==="interactive"){} 
})();