function ema(values, period) {
  const out = Array(values.length).fill(null), alpha = 2 / (period + 1);
  let seed = [], current = null;
  values.forEach((raw, i) => {
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
  add("Relative volume",5,relativeVolume===null?null:(relativeVolume>=1?5:2),relativeVolume===null?"Volume unavailable":relativeVolume.toFixed(2)+"× average");
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
