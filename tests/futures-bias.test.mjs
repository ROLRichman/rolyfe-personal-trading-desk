import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const engine = require("../shared/futures-bias.js");

function bars({slope=0.25,base=100,periodMs=5*60*1000,count=240,now=Date.now(),session="2026-11-24"}={}) {
  return Array.from({length:count},(_,i)=>{
    const close=base+slope*i;
    return {
      t: now-(count-i)*periodMs,
      o: close-0.05, h: close+0.25, l: close-0.25, c: close,
      v: 1000+i*2, session_end_date: session
    };
  });
}
function fixture({slope=0.25,now=Date.now(),provider="Massive",dataStatus="provider_response"}={}) {
  const frames={};
  for(const key of engine.timeframes) {
    const period=key==="1d"?86400000:key==="4h"?14400000:key==="1h"?3600000:key==="15m"?900000:300000;
    frames[key]={provider,dataStatus,asOf:new Date(now).toISOString(),bars:bars({slope,periodMs:period,now})};
  }
  return {frames};
}

const bullish=engine.analyze(fixture());
assert.equal(bullish.status,"FRESH");
assert.equal(bullish.bias,"BULLISH");
assert.equal(bullish.tradable,true);
assert.equal(bullish.isProbability,false);
assert.ok(bullish.score>0);
assert.ok(bullish.invalidation.bullishBelow>0);

const bearish=engine.analyze(fixture({slope:-0.25}));
assert.equal(bearish.status,"FRESH");
assert.equal(bearish.bias,"BEARISH");
assert.equal(bearish.tradable,true);
assert.ok(bearish.score<0);

const mixedInput=fixture();
mixedInput.frames["1d"]=fixture({slope:0.25}).frames["1d"];
mixedInput.frames["4h"]=fixture({slope:-0.25}).frames["4h"];
const mixed=engine.analyze(mixedInput);
assert.equal(mixed.bias,"MIXED");
assert.equal(mixed.tradable,false);

const staleInput=fixture();
staleInput.frames["5m"].asOf=new Date(Date.now()-2*60*60*1000).toISOString();
const stale=engine.analyze(staleInput);
assert.equal(stale.status,"STALE");
assert.equal(stale.tradable,false);
assert.match(stale.message,/Historical or delayed/);

const incompleteInput=fixture();
delete incompleteInput.frames["15m"];
const incomplete=engine.analyze(incompleteInput);
assert.equal(incomplete.status,"INCOMPLETE");
assert.equal(incomplete.bias,"UNAVAILABLE");
assert.equal(incomplete.tradable,false);

const sampleInput=fixture({provider:"sample feed",dataStatus:"sample"});
const sample=engine.analyze(sampleInput);
assert.equal(sample.status,"INCOMPLETE");
assert.equal(sample.bias,"UNAVAILABLE");

assert.ok(engine.timestampMs(1795507200000000000)>1e12,"nanosecond timestamps should normalize to milliseconds");
assert.equal(engine.normalizeBars([{t:"invalid",o:1,h:2,l:1,c:2}]).length,0);
console.log("PASS: Futures Bias provenance, trend alignment, stale-feed lockout and incomplete-data guard.");
