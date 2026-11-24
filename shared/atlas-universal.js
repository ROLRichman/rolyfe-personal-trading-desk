/* RO'Lyfe Universal Atlas — shared, multilingual, research-only co-pilot. */
(() => {
  "use strict";
  if (window.__ROLYFE_UNIVERSAL_ATLAS__ || document.getElementById("atlasPanel")) return;
  window.__ROLYFE_UNIVERSAL_ATLAS__ = true;
  const $ = id => document.getElementById(id);
  const language = () => window.ROLyfeLanguage || {name:localStorage.getItem("rolyfe-ui-language") || "English",locale:"en-US"};
  const symbol = () => localStorage.getItem("rolyfe-active-symbol") || document.querySelector("#symbol,#symbol-select,#classroomSymbol,#chartSymbol")?.value || "not selected";
  const css = [
    "#rol-atlas-launch{position:fixed;right:18px;bottom:18px;z-index:99990;border:1px solid #438b65;border-radius:999px;background:#123b28;color:#9af0bb;padding:14px 20px;font:700 13px system-ui;box-shadow:0 8px 28px #0008;cursor:pointer}",
    "#rol-atlas-panel{position:fixed;right:16px;bottom:78px;z-index:99991;width:min(430px,calc(100vw - 24px));max-height:min(76vh,720px);display:flex;flex-direction:column;border:1px solid #438b65;border-radius:22px;background:#071a13;color:#e3f2e9;box-shadow:0 18px 55px #000b;overflow:hidden;font:14px/1.5 system-ui}",
    "#rol-atlas-panel[hidden],#rol-atlas-launch[hidden]{display:none}",
    "#rol-atlas-panel .head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #244a36}",
    "#rol-atlas-panel .head strong{color:#8ce5b4;font-size:18px}",
    "#rol-atlas-panel .actions{display:flex;gap:6px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid #244a36}",
    "#rol-atlas-panel button{border:1px solid #37694d;border-radius:9px;background:#123522;color:#a9eac2;padding:8px 10px;font-weight:700;cursor:pointer}",
    "#rol-atlas-panel .feed{padding:12px;overflow:auto;min-height:120px;flex:1}",
    "#rol-atlas-panel .msg{white-space:pre-wrap;overflow-wrap:anywhere;background:#102a1d;border-radius:12px;padding:10px 12px;margin:0 0 9px}",
    "#rol-atlas-panel form{display:flex;gap:8px;padding:10px;border-top:1px solid #244a36}",
    "#rol-atlas-panel input{min-width:0;flex:1;background:#06140e;border:1px solid #315640;border-radius:9px;color:#fff;padding:11px}",
    "#rol-atlas-panel .status{font-size:10px;color:#92b7a0;padding:0 12px 10px}",
    "@media(max-width:600px){#rol-atlas-panel{inset:8px 8px 76px;width:auto;max-height:none;border-radius:16px}#rol-atlas-launch{right:12px;bottom:12px;padding:12px 16px}}"
  ].join("\n");
  const style=document.createElement("style");style.textContent=css;document.head.appendChild(style);
  const legacyPromptFab = document.getElementById("aiFab");
  if (legacyPromptFab) {
    // Keep the legacy classroom prompt builder visible beside Universal Atlas.
    legacyPromptFab.style.right = "136px";
    legacyPromptFab.style.bottom = "18px";
    legacyPromptFab.style.zIndex = "30";
  }
  const launcher=document.createElement("button");
  launcher.id="rol-atlas-launch";launcher.type="button";launcher.textContent="✳ ATLAS";
  launcher.setAttribute("aria-controls","rol-atlas-panel");launcher.setAttribute("aria-expanded","false");
  const panel=document.createElement("section");
  panel.id="rol-atlas-panel";panel.hidden=true;panel.setAttribute("aria-label","Atlas universal trading assistant");
  panel.innerHTML='<div class="head"><div><strong>✳ Atlas Universal</strong><div style="color:#9bb9a5;font-size:11px">RO’Lyfe Trading Co-Pilot</div></div><button type="button" id="rol-atlas-close" aria-label="Close Atlas">×</button></div><div class="actions"><button type="button" id="rol-atlas-execute">▶ Guided Review</button><button type="button" id="rol-atlas-follow" aria-pressed="false">Follow Along: Off</button><button type="button" id="rol-atlas-talk">🎙 Talk</button></div><div class="feed" id="rol-atlas-feed" aria-live="polite"><p class="msg">I’m Atlas Local Guide. I explain the visible controls and supplied desk data without a cloud AI key. I do not fetch prices or place trades.</p></div><form id="rol-atlas-form"><input id="rol-atlas-input" maxlength="2400" placeholder="Ask Atlas about this screen…" aria-label="Ask Atlas" required><button type="submit">Send</button></form><div class="status" id="rol-atlas-status">LOCAL GUIDE READY · NO API KEY REQUIRED</div>';
  document.body.append(launcher,panel);
  let follow=false,busy=false,recognition=null,lastAction="No button action selected.";
  const feed=$("rol-atlas-feed"),input=$("rol-atlas-input"),status=$("rol-atlas-status");
  const add=value=>{const p=document.createElement("p");p.className="msg";p.textContent=value;feed.appendChild(p);feed.scrollTop=feed.scrollHeight;return p;};
  const context=()=>{const visible=(document.querySelector("main")||document.body).innerText||"";return ["PAGE: "+document.title,"ACTIVE INSTRUMENT: "+symbol(),"RECENT USER ACTION: "+lastAction,"VISIBLE PAGE CONTEXT (may be incomplete):\n"+visible.slice(0,5000),"This is a research and paper-trading interface. Do not claim to place orders. Do not invent quotes, timestamps or indicators. Clearly state when information is missing or stale."].join("\n\n");};
  const open=value=>{panel.hidden=!value;launcher.hidden=value;launcher.setAttribute("aria-expanded",String(value));if(value)input.focus();if(!value&&recognition){try{recognition.stop();}catch(_){}}};
  async function ask(question){
    if(busy)return;busy=true;const pending=add("Reviewing the visible desk context…");
    try{
      if(!window.ROLyfeAtlasLocal)throw new Error("Local guide script is not loaded.");
      const selected=language();
      const answer=window.ROLyfeAtlasLocal.respond(question,context(),{symbol:symbol(),language:selected.name||"English",pageTitle:document.title,lastAction});
      pending.textContent=answer;
      if((selected.name||"English")==="English"&&typeof window.ROLyfeSpeak==="function")window.ROLyfeSpeak(answer);
      status.textContent="LOCAL GUIDE READY · NO API KEY REQUIRED";
    }catch(error){
      pending.textContent="The local guide could not read this screen. Refresh the page and try again.";
      status.textContent="LOCAL GUIDE READY";
    }finally{busy=false;feed.scrollTop=feed.scrollHeight;}
  }
  launcher.addEventListener("click",()=>open(true));
  $("rol-atlas-close").addEventListener("click",()=>open(false));
  $("rol-atlas-form").addEventListener("submit",event=>{event.preventDefault();const q=input.value.trim();if(!q)return;add("You: "+q);input.value="";ask(q);});
  $("rol-atlas-execute").addEventListener("click",()=>ask("Review this page and the currently selected instrument. Explain what this screen is for, what the visible values mean, the next safe research step, and any missing or unverified data. Do not change settings or place orders."));
  $("rol-atlas-follow").addEventListener("click",event=>{follow=!follow;event.currentTarget.textContent="Follow Along: "+(follow?"On":"Off");event.currentTarget.setAttribute("aria-pressed",String(follow));status.textContent=follow?"Follow Along is active. Local Guide will explain buttons you press.":"Follow Along is off.";});
  $("rol-atlas-talk").addEventListener("click",()=>{
    const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Speech){status.textContent="Voice input is not supported in this browser. Type your question instead.";return;}
    recognition=new Speech();recognition.lang=language().locale||"en-US";recognition.interimResults=false;recognition.maxAlternatives=1;
    status.textContent="VOICE INPUT ACTIVE";
    recognition.onresult=event=>{input.value=event.results?.[0]?.[0]?.transcript||"";if(input.value)$("rol-atlas-form").requestSubmit();};
    recognition.onerror=event=>{status.textContent="LOCAL GUIDE READY · VOICE INPUT UNAVAILABLE";};
    recognition.onend=()=>{recognition=null;status.textContent="LOCAL GUIDE READY · NO API KEY REQUIRED";};
    try{recognition.start();}catch(error){status.textContent=error.message||"Could not start voice input.";}
  });
  document.addEventListener("click",event=>{
    if(!follow||!event.isTrusted)return;
    const target=event.target?.closest?.("button,[role=button]");
    if(!target||target.closest("#rol-atlas-panel")||target.closest("#rol-global-tools"))return;
    const label=(target.innerText||target.getAttribute("aria-label")||target.title||"Button").trim().slice(0,140);
    lastAction="User pressed: "+label;
    if(!busy)ask("I just pressed '"+label+"'. Explain what this action likely did on this screen, what changed in the visible interface, and the next useful thing to inspect. Do not repeat the action.");
  },true);
  window.addEventListener("rol-language-change",event=>{if(event.detail?.language?.locale&&recognition)recognition.lang=event.detail.language.locale;});
})();