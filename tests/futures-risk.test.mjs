import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateFuturesRisk } from "../shared/futures-risk.js";

test("micro contracts make smaller risk budgets possible", () => {
  const result = calculateFuturesRisk({product:"ES",size:"micro",capital:1000,riskPercent:1,stopTicks:8});
  assert.equal(result.contractSymbol,"MES");
  assert.equal(result.tickValue,1.25);
  assert.equal(result.riskPerContract,10);
  assert.equal(result.maxContracts,1);
  assert.equal(result.totalPlannedRisk,10);
});

test("E-mini sizing respects tick value and floors whole contracts", () => {
  const result = calculateFuturesRisk({product:"NQ",size:"mini",capital:1000,riskPercent:1,stopTicks:8});
  assert.equal(result.riskPerContract,40);
  assert.equal(result.maxContracts,0);
});

test("crude micro risk uses one dollar per tick", () => {
  const result = calculateFuturesRisk({product:"CL",size:"micro",capital:500,riskPercent:1,stopTicks:10});
  assert.equal(result.contractSymbol,"MCL");
  assert.equal(result.riskPerContract,10);
  assert.equal(result.maxContracts,0);
});

test("rejects invalid risk inputs instead of guessing", () => {
  assert.throws(()=>calculateFuturesRisk({product:"BTC",size:"mini",capital:100,riskPercent:1,stopTicks:4}),/supported futures/);
  assert.throws(()=>calculateFuturesRisk({product:"ES",size:"micro",capital:100,riskPercent:1,stopTicks:0}),/whole number/);
  assert.throws(()=>calculateFuturesRisk({product:"ES",size:"mini",capital:100,riskPercent:101,stopTicks:2}),/Risk budget/);
});

test("Dow and Russell micro tick values are CME-aligned", () => {
  const dow=calculateFuturesRisk({product:"YM",size:"micro",capital:1000,riskPercent:1,stopTicks:10});
  const russell=calculateFuturesRisk({product:"RTY",size:"micro",capital:1000,riskPercent:1,stopTicks:10});
  assert.equal(dow.tickValue,0.5);
  assert.equal(russell.tickValue,0.5);
  assert.equal(dow.riskPerContract,5);
  assert.equal(russell.riskPerContract,5);
});
