export const FUTURES_CONTRACT_SPECS = Object.freeze({
  ES: Object.freeze({ mini: Object.freeze({ symbol: "ES", tickSize: 0.25, tickValue: 12.5 }), micro: Object.freeze({ symbol: "MES", tickSize: 0.25, tickValue: 1.25 }) }),
  NQ: Object.freeze({ mini: Object.freeze({ symbol: "NQ", tickSize: 0.25, tickValue: 5 }), micro: Object.freeze({ symbol: "MNQ", tickSize: 0.25, tickValue: 0.5 }) }),
  YM: Object.freeze({ mini: Object.freeze({ symbol: "YM", tickSize: 1, tickValue: 5 }), micro: Object.freeze({ symbol: "MYM", tickSize: 1, tickValue: 0.5 }) }),
  RTY: Object.freeze({ mini: Object.freeze({ symbol: "RTY", tickSize: 0.1, tickValue: 5 }), micro: Object.freeze({ symbol: "M2K", tickSize: 0.1, tickValue: 0.5 }) }),
  CL: Object.freeze({ mini: Object.freeze({ symbol: "CL", tickSize: 0.01, tickValue: 10 }), micro: Object.freeze({ symbol: "MCL", tickSize: 0.01, tickValue: 1 }) })
});

export function calculateFuturesRisk({ product, size = "mini", capital, riskPercent, stopTicks }) {
  const spec = FUTURES_CONTRACT_SPECS[String(product || "").toUpperCase()]?.[size];
  if (!spec) throw new RangeError("Choose a supported futures product and contract size.");
  const account = Number(capital), pct = Number(riskPercent), ticks = Number(stopTicks);
  if (!Number.isFinite(account) || account <= 0) throw new RangeError("Account capital must be greater than zero.");
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new RangeError("Risk budget must be greater than 0 and no more than 100 percent.");
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 100000) throw new RangeError("Stop distance must be a whole number of ticks.");
  const riskBudget = account * pct / 100;
  const riskPerContract = ticks * spec.tickValue;
  const maxContracts = Math.floor((riskBudget + Number.EPSILON) / riskPerContract);
  const totalPlannedRisk = maxContracts * riskPerContract;
  return Object.freeze({
    product: String(product).toUpperCase(), contractSymbol: spec.symbol,
    tickSize: spec.tickSize, tickValue: spec.tickValue, stopTicks: ticks,
    riskBudget, riskPerContract, maxContracts, totalPlannedRisk,
    remainingRisk: riskBudget - totalPlannedRisk
  });
}
