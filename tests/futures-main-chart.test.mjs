import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("Futures Bias can load its selected contract into the primary chart",()=>{
 const app=read("app.js"),widget=read("shared/futures-bias-widget.js"),html=read("index.html");
 assert.match(app,/rolyfe:load-futures-chart/);assert.match(app,/FUTURES_MARKET_DATA_URL/);assert.match(app,/normalizeFuturesBars/);
 assert.match(widget,/Load in main chart/);assert.match(widget,/rolyfe:load-futures-chart/);assert.match(app,/rolyfe:futures-frames-loaded/);assert.match(widget,/rolyfe:futures-frames-loaded/);assert.match(html,/id="futuresRiskPanel"/);
});
test("Futures execution math is separate from the stock option chain",()=>{
 const execution=read("execution.js");assert.match(execution,/activeType==="Futures"/);assert.match(execution,/futuresRiskPanel/);assert.match(execution,/calculateFuturesRisk/);
});
