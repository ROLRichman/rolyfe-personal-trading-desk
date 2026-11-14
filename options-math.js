export function calculateLongOption({premium,multiplier=100,quantity=1,stopPct,targetPct,capital,riskPct}) {
  const values=[premium,multiplier,quantity,stopPct,targetPct,capital,riskPct].map(Number);
  if(values.some(x=>!Number.isFinite(x))||premium<=0||multiplier<=0||quantity<1||!Number.isInteger(quantity)||stopPct<=0||stopPct>=100||targetPct<=0||capital<=0||riskPct<=0||riskPct>100) {
    throw new RangeError("Invalid long-option calculation inputs.");
  }
  const contractCost=Number(premium)*Number(multiplier);
  const stopRiskPerContract=contractCost*Number(stopPct)/100;
  const maxContractsByCapital=Math.floor(Number(capital)/contractCost);
  const maxContractsByRisk=Math.floor((Number(capital)*Number(riskPct)/100)/stopRiskPerContract);
  const maxContracts=Math.max(0,Math.min(maxContractsByCapital,maxContractsByRisk));
  const debit=contractCost*Number(quantity);
  const plannedStopRisk=stopRiskPerContract*Number(quantity);
  const maximumLoss=debit;
  const stopPremium=Number(premium)*(1-Number(stopPct)/100);
  const targetPremium=Number(premium)*(1+Number(targetPct)/100);
  const potentialProfit=contractCost*Number(quantity)*Number(targetPct)/100;
  const riskReward=Number(targetPct)/Number(stopPct);
  return {contractCost,stopRiskPerContract,maxContractsByCapital,maxContractsByRisk,maxContracts,debit,plannedStopRisk,maximumLoss,stopPremium,targetPremium,potentialProfit,riskReward,capitalRemaining:Number(capital)-debit};
}

export function calculateCloseMetrics({entryPremium,exitPremium,quantity,multiplier=100}) {
  const values=[entryPremium,exitPremium,quantity,multiplier].map(Number);
  if(values.some(x=>!Number.isFinite(x))||entryPremium<=0||exitPremium<=0||quantity<1||!Number.isInteger(quantity)||multiplier<=0) {
    throw new RangeError("Invalid option close calculation inputs.");
  }
  const entryDebit=Number(entryPremium)*Number(quantity)*Number(multiplier);
  const exitCredit=Number(exitPremium)*Number(quantity)*Number(multiplier);
  return {entryDebit,exitCredit,realizedPnl:exitCredit-entryDebit};
}
