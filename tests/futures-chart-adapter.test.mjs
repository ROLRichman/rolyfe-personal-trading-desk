import assert from "node:assert/strict";
import {test} from "node:test";
import {normalizeFuturesBars} from "../shared/futures-chart-adapter.js";
test("normalizes Massive nanosecond futures bars to chart OHLCV",()=>{
 const bars=normalizeFuturesBars([{window_start:1795514400000000000,open:100,high:102,low:99,close:101,volume:120},{window_start:1795514700000000000,open:101,high:103,low:100,close:102,volume:140}]);
 assert.equal(bars.length,2);assert.equal(bars[0].o,100);assert.equal(bars[1].c,102);assert.equal(bars[0].v,120);assert.match(bars[0].t,/^2026-/);
});
test("rejects invalid candles and sorts/uniques timestamps",()=>{
 const bars=normalizeFuturesBars([{window_start:1795514700000,open:101,high:103,low:100,close:102},{window_start:1795514400000,open:100,high:102,low:99,close:101},{window_start:1795514400000,open:100,high:102,low:99,close:101},{window_start:0,open:1,high:2,low:0,close:1},{window_start:1795515000000,open:"bad",high:2,low:0,close:1}]);
 assert.equal(bars.length,2);assert.ok(Date.parse(bars[0].t)<Date.parse(bars[1].t));
});
