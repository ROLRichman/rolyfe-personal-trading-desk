import assert from "node:assert/strict";
import { calculateLongOption, calculateCloseMetrics } from "../options-math.js";

const stops=[1,2,5,7,10,15,20];
const targets=[10,15,20,25,30];
for(let i=1;i<=20;i++){
  const premium=Number((0.19+i*0.137).toFixed(3));
  const multiplier=i%4===0?10:100;
  const quantity=(i%3)+1;
  const stopPct=stops[(i-1)%stops.length];
  const targetPct=targets[(i-1)%targets.length];
  const capital=1000+i*125;
  const riskPct=1+(i%5);
  const result=calculateLongOption({premium,multiplier,quantity,stopPct,targetPct,capital,riskPct});
  const contractCost=premium*multiplier;
  const stopRiskPerContract=contractCost*stopPct/100;
  assert.equal(result.contractCost,contractCost,"case "+i+": contract debit");
  assert.equal(result.debit,contractCost*quantity,"case "+i+": total debit");
  assert.equal(result.plannedStopRisk,stopRiskPerContract*quantity,"case "+i+": planned stop risk");
  assert.equal(result.maximumLoss,result.debit,"case "+i+": max long-option loss");
  assert.ok(Math.abs(result.stopPremium-premium*(1-stopPct/100))<1e-10,"case "+i+": stop premium");
  assert.ok(Math.abs(result.targetPremium-premium*(1+targetPct/100))<1e-10,"case "+i+": target premium");
  assert.equal(result.potentialProfit,contractCost*quantity*targetPct/100,"case "+i+": target profit");
  assert.equal(result.riskReward,targetPct/stopPct,"case "+i+": risk/reward");
  assert.equal(result.maxContracts,Math.max(0,Math.min(Math.floor(capital/contractCost),Math.floor((capital*riskPct/100)/stopRiskPerContract))),"case "+i+": whole-contract cap");
  const exit=Number((premium*(1+((i%9)-4)/100)).toFixed(4));
  const close=calculateCloseMetrics({entryPremium:premium,exitPremium:exit,quantity,multiplier});
  assert.equal(close.entryDebit,premium*quantity*multiplier,"case "+i+": close entry");
  assert.equal(close.exitCredit,exit*quantity*multiplier,"case "+i+": close credit");
  assert.ok(Math.abs(close.realizedPnl-(exit-premium)*quantity*multiplier)<1e-8,"case "+i+": realized P/L");
}
assert.throws(()=>calculateLongOption({premium:0,multiplier:100,quantity:1,stopPct:5,targetPct:20,capital:100,riskPct:1}),RangeError);
assert.throws(()=>calculateCloseMetrics({entryPremium:1,exitPremium:0,quantity:1,multiplier:100}),RangeError);
console.log("PASS: 20 option quote math scenarios plus invalid-input guards.");
