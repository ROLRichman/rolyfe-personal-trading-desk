import assert from "node:assert/strict";
import { calculateMarketHealth, normalizeCashFlowReports } from "../market-metrics.js";

const rising=Array.from({length:240},(_,i)=>{const c=50+i*.5;return {t:Date.UTC(2025,0,1+i),o:c-.2,h:c+.4,l:c-.4,c,v:1000+i*5};});
const strong=calculateMarketHealth(rising,"1d");
assert.ok(strong.score>=75 && strong.score<=100,"rising series should score strong");
assert.equal(strong.label,"STRONG");
assert.ok(strong.confidence>=80 && strong.confidence<=100,"score must report meaningful input coverage");
const falling=rising.map((b,i)=>{const c=180-i*.45;return {...b,o:c+.2,h:c+.4,l:c-.4,c};});
const weak=calculateMarketHealth(falling,"1d");
assert.ok(weak.score<50,"falling series should not score as constructive");
assert.equal(calculateMarketHealth([]).score,null);
const cash=normalizeCashFlowReports([
 {fiscalDateEnding:"2025-12-31",operatingCashflow:"1000",capitalExpenditures:"-250"},
 {fiscalDateEnding:"2025-09-30",operatingCashflow:"700",capitalExpenditures:"100"},
 {fiscalDateEnding:"2025-06-30",operatingCashflow:"--",capitalExpenditures:"50"}
]);
assert.deepEqual(cash.map(x=>x.period),["2025-06-30","2025-09-30","2025-12-31"]);
assert.equal(cash[1].freeCashFlow,600);
assert.equal(cash[2].freeCashFlow,750);
assert.equal(cash[0].freeCashFlow,null);
console.log("PASS: market health scoring and CAPEX / cash-flow normalization.");
