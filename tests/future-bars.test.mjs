import assert from "node:assert/strict";
import { buildFuturePlanBars, validateFutureBarPlan } from "../future-bars.js";

const long = { side: "Long", entry: 100, stop: 98, targets: [102, 104, 106], futureBars: 5, barStyle: "hollow" };
assert.equal(validateFutureBarPlan(long), "");
const longBars = buildFuturePlanBars(long);
assert.equal(longBars.length, 5);
assert.ok(longBars.every(bar => bar.h >= Math.max(bar.o, bar.c) && bar.l <= Math.min(bar.o, bar.c)));
assert.ok(longBars[4].c > longBars[0].c, "Long schematic bars should progress toward the first target");

const short = { side: "Short", entry: 100, stop: 102, targets: [98, 96, 94], futureBars: 8, barStyle: "solid" };
assert.equal(validateFutureBarPlan(short), "");
const shortBars = buildFuturePlanBars(short);
assert.equal(shortBars.length, 8);
assert.ok(shortBars[7].c < shortBars[0].c, "Short schematic bars should progress toward the first target");

assert.match(validateFutureBarPlan({ ...long, stop: 101 }), /stop must be below entry/);
assert.match(validateFutureBarPlan({ ...short, targets: [99, 100, 94] }), /below entry/);
assert.match(validateFutureBarPlan({ ...long, targets: [102, 101, 106] }), /step upward/);
assert.match(validateFutureBarPlan({ ...long, futureBars: 7 }), /Choose 3, 5, 8 or 12/);
assert.equal(validateFutureBarPlan({ side: "Long", entry: 100, stop: null, targets: [], futureBars: 3, barStyle: "solid" }), "");

console.log("PASS: RO’Lyfe Future Bars validation and schematic plan-candle generation.");
