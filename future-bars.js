const ALLOWED_FUTURE_BAR_COUNTS = new Set([3, 5, 8, 12]);

export function validateFutureBarPlan(plan) {
  if (!plan || !["Long", "Short"].includes(plan.side)) return "Choose Buy / Long or Sell / Short.";
  const entry = Number(plan.entry);
  if (!Number.isFinite(entry) || entry <= 0) return "Entry must be a price greater than zero.";
  const stop = plan.stop === null || plan.stop === undefined || plan.stop === "" ? null : Number(plan.stop);
  if (stop !== null && (!Number.isFinite(stop) || stop <= 0)) return "Stop must be a price greater than zero.";
  if (plan.side === "Long" && stop !== null && stop >= entry) return "For a Long plan, the stop must be below entry.";
  if (plan.side === "Short" && stop !== null && stop <= entry) return "For a Short plan, the stop must be above entry.";

  const targets = Array.isArray(plan.targets) ? plan.targets.filter(value => value !== null && value !== undefined && value !== "").map(Number) : [];
  if (targets.some(value => !Number.isFinite(value) || value <= 0)) return "Each target must be a price greater than zero.";
  for (let index = 0; index < targets.length; index++) {
    if (plan.side === "Long" && targets[index] <= entry) return "For a Long plan, every target must be above entry.";
    if (plan.side === "Short" && targets[index] >= entry) return "For a Short plan, every target must be below entry.";
    if (index > 0 && plan.side === "Long" && targets[index] <= targets[index - 1]) return "Long targets must step upward from T1 to T3.";
    if (index > 0 && plan.side === "Short" && targets[index] >= targets[index - 1]) return "Short targets must step downward from T1 to T3.";
  }
  if (!ALLOWED_FUTURE_BAR_COUNTS.has(Number(plan.futureBars))) return "Choose 3, 5, 8 or 12 future bars.";
  if (!["hollow", "solid"].includes(plan.barStyle)) return "Choose hollow or solid future bars.";
  return "";
}

/**
 * Build schematic candles for the plan overlay. These are deliberately
 * derived only from the saved entry, first target and stop distance. They
 * are visual planning marks—not provider bars, predictions or backtest data.
 */
export function buildFuturePlanBars(plan) {
  const count = Number(plan?.futureBars);
  const entry = Number(plan?.entry);
  if (!ALLOWED_FUTURE_BAR_COUNTS.has(count) || !Number.isFinite(entry) || entry <= 0) return [];

  const targets = Array.isArray(plan.targets) ? plan.targets.filter(Number.isFinite) : [];
  const destination = targets.length ? targets[0] : entry;
  const stop = Number(plan.stop);
  const riskSpan = Number.isFinite(stop) && stop > 0 ? Math.abs(entry - stop) : entry * 0.002;
  const wickBase = Math.max(riskSpan * 0.18, entry * 0.0005);
  let previousClose = entry;

  return Array.from({ length: count }, (_, index) => {
    const progress = (index + 1) / count;
    const close = entry + (destination - entry) * progress;
    const open = previousClose;
    const wick = wickBase * (index % 2 === 0 ? 1 : 0.72);
    const high = Math.max(open, close) + wick;
    const low = Math.max(0, Math.min(open, close) - wick);
    previousClose = close;
    return { index, o: open, h: high, l: low, c: close };
  });
}
