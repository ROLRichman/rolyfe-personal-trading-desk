function ema(values, period) {
  const out = Array(values.length).fill(null), alpha = 2 / (period + 1);
  let seed = [], current = null;
  values.forEach((raw, i) => {
    if(raw===null||raw===undefined||raw==="") return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    if (current === null) {
      seed.push(value);
      if (seed.length === period) { current = seed.reduce((a,b)=>a+b,0)/period; out[i]=current; }
    } else { current = value * alpha + current * (1 - alpha); out[i] = current; }
  });
  return out;
}
function rsi(values, period=14) {
  const out=Array(values.length).fill(null);
  if(values.length<=period)return out;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=Number(values[i])-Number(values[i-1]);gain+=Math.max(d,0);loss+=Math.max(-d,0);}
  let avgGain=gain/period,avgLoss=loss/period;
  out[period]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  for(let i=period+1;i<values.length;i++){
    const d=Number(values[i])-Number(values[i-1]);
    avgGain=(avgGain*(period-1)+Math.max(d,0))/period;
    avgLoss=(avgLoss*(period-1)+Math.max(-d,0))/period;
    out[i]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  }
  return out;
}
function macdHistogram(values) {
  const fast=ema(values,12),slow=ema(values,26);
  const line=values.map((_,i)=>fast[i]===null||slow[i]===null?null:fast[i]-slow[i]);
  const signal=ema(line,9);
  return line.map((v,i)=>v===null||signal[i]===null?null:v-signal[i]);
}
function vwap(bars, intraday) {
  let pv=0,vol=0,lastDay="";
  for(const bar of bars){
    const date=new Date(Number(bar.t)>1e12?Number(bar.t):Number(bar.t)*1000);
    const day=Number.isFinite(date.getTime())?date.toISOString().slice(0,10):String(bar.t).slice(0,10);
    if(intraday&&day!==lastDay){pv=0;vol=0;}
    lastDay=day;
    const volume=Number(bar.v), typical=(Number(bar.h)+Number(bar.l)+Number(bar.c))/3;
    if(Number.isFinite(volume)&&volume>0&&Number.isFinite(typical)){pv+=typical*volume;vol+=volume;}
  }
  return vol>0?pv/vol:null;
}
export function calculateMarketHealth(bars, interval="1d") {
  if(!Array.isArray(bars)||bars.length<15)return {score:null,confidence:0,label:"INSUFFICIENT DATA",signals:[]};
  const closes=bars.map(b=>Number(b.c));
  const last=closes.at(-1), e20=ema(closes,20).at(-1), e50=ema(closes,50).at(-1), e200=ema(closes,200).at(-1);
  const rsiNow=rsi(closes,14).at(-1), hist=macdHistogram(closes).at(-1);
  const currentVwap=vwap(bars,!["1d","1w","1mo"].includes(interval));
  const volumes=bars.slice(-21,-1).map(b=>Number(b.v)).filter(v=>Number.isFinite(v)&&v>0);
  const currentVolume=Number(bars.at(-1).v);
  const avgVolume=volumes.length?volumes.reduce((a,b)=>a+b,0)/volumes.length:null;
  const relativeVolume=avgVolume&&Number.isFinite(currentVolume)&&currentVolume>0?currentVolume/avgVolume:null;
  const signals=[];
  const add=(name,weight,points,detail)=>{if(points!==null&&Number.isFinite(points))signals.push({name,weight,points,detail});};
  add("Price vs EMA 20",20,e20===null?null:(last>=e20?20:0),e20===null?"Not enough bars":last>=e20?"Above":"Below");
  add("EMA 20 vs EMA 50",20,e20===null||e50===null?null:(e20>=e50?20:0),e20===null||e50===null?"Not enough bars":e20>=e50?"Bullish alignment":"Bearish alignment");
  add("Price vs EMA 200",15,e200===null?null:(last>=e200?15:0),e200===null?"Not enough bars":last>=e200?"Above":"Below");
  let rsiPoints=null;
  if(rsiNow!==null&&Number.isFinite(rsiNow))rsiPoints=rsiNow>=50&&rsiNow<=70?15:rsiNow>70?10:rsiNow>=40?8:rsiNow>=30?5:3;
  add("RSI 14",15,rsiPoints,rsiNow===null?"Unavailable":"RSI "+rsiNow.toFixed(1));
  add("MACD histogram",15,hist===null?null:(hist>=0?15:0),hist===null?"Unavailable":hist>=0?"Positive":"Negative");
  add("VWAP position",10,currentVwap===null?null:(last>=currentVwap?10:0),currentVwap===null?"Volume unavailable":last>=currentVwap?"Above VWAP":"Below VWAP");
  add("Last bar volume vs 20-bar avg",5,relativeVolume===null?null:(relativeVolume>=1?5:2),relativeVolume===null?"Volume unavailable":relativeVolume.toFixed(2)+"× 20-bar avg");
  const availableWeight=signals.reduce((s,x)=>s+x.weight,0);
  if(!availableWeight)return {score:null,confidence:0,label:"INSUFFICIENT DATA",signals};
  const points=signals.reduce((s,x)=>s+x.points,0);
  const score=Math.round(points/availableWeight*100);
  const label=score>=80?"STRONG":score>=65?"CONSTRUCTIVE":score>=45?"MIXED":score>=30?"WEAK":"FRAGILE";
  return {score,confidence:Math.round(availableWeight),label,signals,lastPrice:last,ema20:e20,ema50:e50,ema200:e200,rsi:rsiNow,macdHistogram:hist,vwap:currentVwap,relativeVolume};
}
function numeric(value) {
  if(value===null||value===undefined||value===""||value==="None"||value==="--")return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
}
export function normalizeCashFlowReports(reports=[]) {
  return reports.filter(row=>row&&typeof row.fiscalDateEnding==="string").map(row=>{
    const operating=numeric(row.operatingCashflow??row.operatingCashFlow);
    const rawCapex=numeric(row.capitalExpenditures??row.capitalExpenditure);
    const capex=rawCapex===null?null:Math.abs(rawCapex);
    return {period:row.fiscalDateEnding,operatingCashFlow:operating,capitalExpenditures:capex,freeCashFlow:operating===null||capex===null?null:operating-capex};
  }).sort((a,b)=>a.period.localeCompare(b.period));
}

/**
 * RO'Lyfe RL Pullback: deterministic trend / pullback checklist.
 * The score is a rule-confluence score, never a historical win-rate or probability.
 */
export function calculateRLPullback(bars, interval = "1d") {
  const empty = {
    direction: null, ready: false, confluence: null, bullishConfluence: null,
    bearishConfluence: null, status: "NEED MORE DATA", checks: [],
    close: null, ema20: null, ema50: null, ema200: null, vwap: null, rsi: null,
    macdHistogram: null, stochasticK: null, stochasticD: null, hma32: null,
    hma32Previous: null, timestamp: null, vwapAvailable: false
  };
  if (!Array.isArray(bars) || bars.length < 200) {
    return { ...empty, status: "NEED 200+ BARS FOR EMA 200" };
  }

  const closes = bars.map(row => Number(row.c));
  const last = bars.at(-1);
  const close = Number(last?.c), open = Number(last?.o);
  const high = Number(last?.h), low = Number(last?.l);
  const ema20 = ema(closes, 20).at(-1);
  const ema50 = ema(closes, 50).at(-1);
  const ema200 = ema(closes, 200).at(-1);
  const vwapValue = vwap(bars, !["1d", "1w", "1mo"].includes(interval));
  const rsiValue = rsi(closes, 14).at(-1);
  const macdValue = macdHistogram(closes).at(-1);

  const wma = (values, period) => {
    const out = Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let total = 0, weightTotal = 0, valid = true;
      for (let j = 0; j < period; j++) {
        const raw = values[i - j], value = Number(raw);
        if (raw === null || raw === undefined || raw === "" || !Number.isFinite(value)) { valid = false; break; }
        const weight = period - j;
        total += value * weight; weightTotal += weight;
      }
      if (valid && weightTotal) out[i] = total / weightTotal;
    }
    return out;
  };
  const half = Math.max(1, Math.floor(32 / 2));
  const root = Math.max(1, Math.round(Math.sqrt(32)));
  const fastWma = wma(closes, half), slowWma = wma(closes, 32);
  const hmaDiff = closes.map((_, i) => fastWma[i] === null || slowWma[i] === null ? null : 2 * fastWma[i] - slowWma[i]);
  const hmaSeries = wma(hmaDiff, root);
  const hma32 = hmaSeries.at(-1), hma32Previous = hmaSeries.at(-2);

  const rawK = [];
  for (let i = 13; i < bars.length; i++) {
    const window = bars.slice(i - 13, i + 1);
    const highest = Math.max(...window.map(row => Number(row.h)));
    const lowest = Math.min(...window.map(row => Number(row.l)));
    rawK.push(highest === lowest ? 50 : 100 * (Number(bars[i].c) - lowest) / (highest - lowest));
  }
  const stochasticK = rawK.at(-1) ?? null;
  const stochasticD = rawK.length ? rawK.slice(-3).reduce((sum, value) => sum + value, 0) / Math.min(3, rawK.length) : null;

  if (![close, open, high, low, ema20, ema50, ema200].every(Number.isFinite)) {
    return { ...empty, status: "INDICATOR VALUES INCOMPLETE", close, ema20, ema50, ema200, vwap: vwapValue, rsi: rsiValue, timestamp: last?.t ?? null };
  }

  const longChecks = [
    { name: "Price above EMA 200", weight: 22, pass: close > ema200, detail: close > ema200 ? "Above" : "Below" },
    { name: "EMA 20 above EMA 50", weight: 16, pass: ema20 > ema50, detail: ema20 > ema50 ? "Bullish alignment" : "Not bullish aligned" },
    { name: "Price above VWAP", weight: 14, pass: Number.isFinite(vwapValue) ? close > vwapValue : null, detail: Number.isFinite(vwapValue) ? (close > vwapValue ? "Above VWAP" : "Below VWAP") : "VWAP unavailable" },
    { name: "EMA 20 pullback and reclaim", weight: 20, pass: low <= ema20 * 1.005 && close > ema20 && close >= open, detail: low <= ema20 * 1.005 && close > ema20 && close >= open ? "Touch/reclaim confirmed" : "Waiting for touch and bullish close" },
    { name: "RSI 14 momentum", weight: 8, pass: Number.isFinite(rsiValue) ? rsiValue >= 45 && rsiValue <= 70 : null, detail: Number.isFinite(rsiValue) ? "RSI " + rsiValue.toFixed(1) : "RSI unavailable" },
    { name: "MACD histogram", weight: 8, pass: Number.isFinite(macdValue) ? macdValue > 0 : null, detail: Number.isFinite(macdValue) ? (macdValue > 0 ? "Positive" : "Negative / flat") : "MACD unavailable" },
    { name: "Stochastic K vs D", weight: 6, pass: Number.isFinite(stochasticK) && Number.isFinite(stochasticD) ? stochasticK > stochasticD : null, detail: Number.isFinite(stochasticK) && Number.isFinite(stochasticD) ? (stochasticK > stochasticD ? "K above D" : "K below / equal D") : "Stochastic unavailable" },
    { name: "HMA 32 trend", weight: 6, pass: Number.isFinite(hma32) && Number.isFinite(hma32Previous) ? close > hma32 && hma32 > hma32Previous : null, detail: Number.isFinite(hma32) && Number.isFinite(hma32Previous) ? (close > hma32 && hma32 > hma32Previous ? "Price above rising HMA" : "HMA not rising under price") : "HMA unavailable" }
  ];
  const shortChecks = [
    { name: "Price below EMA 200", weight: 22, pass: close < ema200, detail: close < ema200 ? "Below" : "Above" },
    { name: "EMA 20 below EMA 50", weight: 16, pass: ema20 < ema50, detail: ema20 < ema50 ? "Bearish alignment" : "Not bearish aligned" },
    { name: "Price below VWAP", weight: 14, pass: Number.isFinite(vwapValue) ? close < vwapValue : null, detail: Number.isFinite(vwapValue) ? (close < vwapValue ? "Below VWAP" : "Above VWAP") : "VWAP unavailable" },
    { name: "EMA 20 pullback and rejection", weight: 20, pass: high >= ema20 * 0.995 && close < ema20 && close <= open, detail: high >= ema20 * 0.995 && close < ema20 && close <= open ? "Touch/rejection confirmed" : "Waiting for touch and bearish close" },
    { name: "RSI 14 momentum", weight: 8, pass: Number.isFinite(rsiValue) ? rsiValue >= 30 && rsiValue <= 55 : null, detail: Number.isFinite(rsiValue) ? "RSI " + rsiValue.toFixed(1) : "RSI unavailable" },
    { name: "MACD histogram", weight: 8, pass: Number.isFinite(macdValue) ? macdValue < 0 : null, detail: Number.isFinite(macdValue) ? (macdValue < 0 ? "Negative" : "Positive / flat") : "MACD unavailable" },
    { name: "Stochastic K vs D", weight: 6, pass: Number.isFinite(stochasticK) && Number.isFinite(stochasticD) ? stochasticK < stochasticD : null, detail: Number.isFinite(stochasticK) && Number.isFinite(stochasticD) ? (stochasticK < stochasticD ? "K below D" : "K above / equal D") : "Stochastic unavailable" },
    { name: "HMA 32 trend", weight: 6, pass: Number.isFinite(hma32) && Number.isFinite(hma32Previous) ? close < hma32 && hma32 < hma32Previous : null, detail: Number.isFinite(hma32) && Number.isFinite(hma32Previous) ? (close < hma32 && hma32 < hma32Previous ? "Price below falling HMA" : "HMA not falling above price") : "HMA unavailable" }
  ];
  const score = checks => {
    const available = checks.filter(check => check.pass !== null);
    const weight = available.reduce((sum, check) => sum + check.weight, 0);
    return weight ? Math.round(available.reduce((sum, check) => sum + (check.pass ? check.weight : 0), 0) / weight * 100) : null;
  };
  const bullishConfluence = score(longChecks);
  const bearishConfluence = score(shortChecks);
  let direction = null, confluence = null, checks = [];
  if (bullishConfluence !== null && bullishConfluence >= 60 && bullishConfluence > (bearishConfluence ?? -1)) {
    direction = "Long"; confluence = bullishConfluence; checks = longChecks;
  } else if (bearishConfluence !== null && bearishConfluence >= 60 && bearishConfluence > (bullishConfluence ?? -1)) {
    direction = "Short"; confluence = bearishConfluence; checks = shortChecks;
  }
  const coreReady = checks.length >= 4 && checks.slice(0, 4).every(check => check.pass === true);
  const rsiConfirmed = checks[4]?.pass === true;
  const ready = direction !== null && coreReady && rsiConfirmed && (confluence ?? 0) >= 70;
  const status = ready
    ? (direction === "Long" ? "BULLISH PULLBACK READY" : "BEARISH PULLBACK READY")
    : direction === "Long"
      ? "BULLISH BIAS · WAIT FOR CONFIRMATION"
      : direction === "Short"
        ? "BEARISH BIAS · WAIT FOR CONFIRMATION"
        : "MIXED · NO CLEAR DIRECTION";
  return {
    direction, ready, confluence, bullishConfluence, bearishConfluence, status, checks,
    close, ema20, ema50, ema200, vwap: vwapValue, rsi: rsiValue,
    macdHistogram: macdValue, stochasticK, stochasticD, hma32, hma32Previous,
    timestamp: last?.t ?? null, vwapAvailable: Number.isFinite(vwapValue)
  };
}
