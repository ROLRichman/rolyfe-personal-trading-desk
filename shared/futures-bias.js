/* RO'Lyfe Futures Bias Engine — deterministic, data-provenance-aware analysis. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ROLyfeFuturesBias = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";

  const TIMEFRAMES = Object.freeze(["1d", "4h", "1h", "15m", "5m"]);
  const RULES = Object.freeze({
    "1d":  { weight: 3,   maxAgeMs: 72 * 60 * 60 * 1000 },
    "4h":  { weight: 2.5, maxAgeMs: 18 * 60 * 60 * 1000 },
    "1h":  { weight: 2,   maxAgeMs: 4 * 60 * 60 * 1000 },
    "15m": { weight: 1.5, maxAgeMs: 75 * 60 * 1000 },
    "5m":  { weight: 1,   maxAgeMs: 30 * 60 * 1000 }
  });
  const BAD_SOURCE = /(sample|mock|demo|synthetic|fixture|illustrative|simulated)/i;
  const ACCEPTED_DATA_STATUS = new Set(["provider_response", "verified", "actual"]);
  const finite = value => Number.isFinite(Number(value));
  const num = value => value == null || value === "" ? NaN : Number(value);

  function timestampMs(value) {
    if (value == null || value === "") return NaN;
    if (typeof value === "string" && !/^\d{9,}$/.test(value.trim())) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return NaN;
    if (n > 1e16) return n / 1e6; // nanoseconds
    if (n > 1e13) return n / 1e6; // nanoseconds, lower epoch range
    if (n > 1e12) return n;      // milliseconds
    if (n > 1e9) return n * 1000;// seconds
    return NaN;
  }

  function ema(values, period) {
    const out = Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let seed = [], previous = null;
    for (let i = 0; i < values.length; i++) {
      const v = num(values[i]);
      if (!Number.isFinite(v)) { seed = []; previous = null; continue; }
      if (previous === null) {
        seed.push(v);
        if (seed.length === period) {
          previous = seed.reduce((sum, item) => sum + item, 0) / period;
          out[i] = previous;
        }
      } else {
        previous = v * k + previous * (1 - k);
        out[i] = previous;
      }
    }
    return out;
  }

  function wma(values, period) {
    const out = Array(values.length).fill(null);
    const divisor = period * (period + 1) / 2;
    for (let i = period - 1; i < values.length; i++) {
      let total = 0, valid = true;
      for (let j = 0; j < period; j++) {
        const v = num(values[i - period + 1 + j]);
        if (!Number.isFinite(v)) { valid = false; break; }
        total += v * (j + 1);
      }
      if (valid) out[i] = total / divisor;
    }
    return out;
  }

  function hma(values, period) {
    const half = Math.max(1, Math.floor(period / 2));
    const root = Math.max(1, Math.floor(Math.sqrt(period)));
    const a = wma(values, half), b = wma(values, period);
    const diff = values.map((_, i) => Number.isFinite(a[i]) && Number.isFinite(b[i]) ? 2 * a[i] - b[i] : null);
    return wma(diff, root);
  }

  function rsi(values, period = 14) {
    const out = Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = num(values[i]) - num(values[i - 1]);
      gain += Math.max(d, 0);
      loss += Math.max(-d, 0);
    }
    let avgGain = gain / period, avgLoss = loss / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < values.length; i++) {
      const d = num(values[i]) - num(values[i - 1]);
      avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }

  function macdHistogram(values) {
    const fast = ema(values, 12), slow = ema(values, 26);
    const line = values.map((_, i) => fast[i] == null || slow[i] == null ? null : fast[i] - slow[i]);
    const signal = ema(line, 9);
    return line.map((v, i) => v == null || signal[i] == null ? null : v - signal[i]);
  }

  function normalizeBars(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(bar => {
      const time = timestampMs(bar.time ?? bar.t ?? bar.timestamp ?? bar.window_start ?? bar.windowStart);
      return {
        time,
        open: num(bar.open ?? bar.o),
        high: num(bar.high ?? bar.h),
        low: num(bar.low ?? bar.l),
        close: num(bar.close ?? bar.c),
        volume: num(bar.volume ?? bar.v),
        sessionEndDate: String(bar.session_end_date ?? bar.sessionEndDate ?? "")
      };
    }).filter(bar =>
      Number.isFinite(bar.time) &&
      [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) &&
      bar.high >= bar.low &&
      bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0
    ).sort((a, b) => a.time - b.time);
  }

  function sessionVwap(bars, interval) {
    if (["1d", "1w", "1mo"].includes(interval)) return null;
    const last = bars[bars.length - 1];
    const lastSession = last.sessionEndDate || new Date(last.time).toISOString().slice(0, 10);
    let pv = 0, volume = 0;
    for (const bar of bars) {
      const session = bar.sessionEndDate || new Date(bar.time).toISOString().slice(0, 10);
      if (session !== lastSession || !Number.isFinite(bar.volume) || bar.volume <= 0) continue;
      const typical = (bar.high + bar.low + bar.close) / 3;
      pv += typical * bar.volume;
      volume += bar.volume;
    }
    return volume > 0 ? pv / volume : null;
  }

  function structureSignal(bars) {
    if (bars.length < 20) return { points: null, detail: "Not enough bars for a 20-bar structure check." };
    const old = bars.slice(-20, -10), recent = bars.slice(-10);
    const oldHigh = Math.max(...old.map(x => x.high));
    const oldLow = Math.min(...old.map(x => x.low));
    const newHigh = Math.max(...recent.map(x => x.high));
    const newLow = Math.min(...recent.map(x => x.low));
    if (newHigh > oldHigh && newLow > oldLow) return { points: 1, detail: "Recent 10-bar range has higher highs and higher lows." };
    if (newHigh < oldHigh && newLow < oldLow) return { points: -1, detail: "Recent 10-bar range has lower highs and lower lows." };
    return { points: 0, detail: "Recent 10-bar structure is overlapping or mixed." };
  }

  function analyzeFrame(key, frame, now) {
    const rule = RULES[key];
    if (!frame || typeof frame !== "object") return { timeframe: key, valid: false, reason: "Frame not supplied." };
    const provider = String(frame.provider || frame.source || "");
    const dataStatus = String(frame.dataStatus || frame.data_status || "").toLowerCase();
    if (!provider || BAD_SOURCE.test(provider)) return { timeframe: key, valid: false, reason: "Provider provenance is missing or marked as sample/demo." };
    if (!ACCEPTED_DATA_STATUS.has(dataStatus) || BAD_SOURCE.test(dataStatus)) {
      return { timeframe: key, valid: false, reason: "Data status is not verified provider data." };
    }
    const bars = normalizeBars(frame.bars);
    if (bars.length < 200) return { timeframe: key, valid: false, reason: "At least 200 valid OHLC bars are required for EMA 200.", bars: bars.length };
    const closes = bars.map(x => x.close);
    const last = bars[bars.length - 1];
    const asOf = timestampMs(frame.asOf ?? frame.as_of) || last.time;
    const ageMs = Math.max(0, now - asOf);
    const stale = ageMs > rule.maxAgeMs;
    const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
    const hma32 = hma(closes, 32), rsi14 = rsi(closes, 14), macd = macdHistogram(closes);
    const current = closes[closes.length - 1];
    const signals = [];
    const add = (name, points, detail) => {
      if (points == null || !Number.isFinite(points)) return;
      signals.push({ name, points, detail });
    };
    add("Price vs EMA 20", current > e20.at(-1) ? 1 : current < e20.at(-1) ? -1 : 0,
      current > e20.at(-1) ? "Close is above EMA 20." : current < e20.at(-1) ? "Close is below EMA 20." : "Close is at EMA 20.");
    add("EMA 20 / EMA 50", e20.at(-1) > e50.at(-1) ? 1 : e20.at(-1) < e50.at(-1) ? -1 : 0,
      e20.at(-1) > e50.at(-1) ? "EMA 20 is above EMA 50." : e20.at(-1) < e50.at(-1) ? "EMA 20 is below EMA 50." : "EMA 20 and EMA 50 are equal.");
    add("EMA 50 / EMA 200", e50.at(-1) > e200.at(-1) ? 1 : e50.at(-1) < e200.at(-1) ? -1 : 0,
      e50.at(-1) > e200.at(-1) ? "EMA 50 is above EMA 200." : e50.at(-1) < e200.at(-1) ? "EMA 50 is below EMA 200." : "EMA 50 and EMA 200 are equal.");
    const hNow = hma32.at(-1), hPrev = hma32.at(-2);
    if (Number.isFinite(hNow) && Number.isFinite(hPrev)) add("HMA 32 slope", hNow > hPrev ? 1 : hNow < hPrev ? -1 : 0,
      hNow > hPrev ? "HMA 32 is rising." : hNow < hPrev ? "HMA 32 is falling." : "HMA 32 is flat.");
    const rNow = rsi14.at(-1);
    if (Number.isFinite(rNow)) add("RSI 14", rNow > 55 ? 1 : rNow < 45 ? -1 : 0,
      "RSI 14 is " + rNow.toFixed(1) + (rNow > 55 ? " (above 55)." : rNow < 45 ? " (below 45)." : " (neutral zone)."));
    const mNow = macd.at(-1);
    if (Number.isFinite(mNow)) add("MACD histogram", mNow > 0 ? 1 : mNow < 0 ? -1 : 0,
      mNow > 0 ? "MACD histogram is positive." : mNow < 0 ? "MACD histogram is negative." : "MACD histogram is flat.");
    const vwap = sessionVwap(bars, key);
    if (Number.isFinite(vwap)) add("Session VWAP", current > vwap ? 1 : current < vwap ? -1 : 0,
      current > vwap ? "Close is above the current session VWAP." : current < vwap ? "Close is below the current session VWAP." : "Close is at session VWAP.");
    const structure = structureSignal(bars);
    add("Market structure", structure.points, structure.detail);

    const pointTotal = signals.reduce((sum, item) => sum + item.points, 0);
    const confluenceScore = signals.length ? Math.round((pointTotal / signals.length) * 100) : 0;
    const direction = confluenceScore >= 25 ? "BULLISH" : confluenceScore <= -25 ? "BEARISH" : "NEUTRAL";
    const swing = bars.slice(-20);
    return {
      timeframe: key, valid: true, provider, dataStatus,
      asOf: new Date(asOf).toISOString(), ageMs, stale, bars: bars.length,
      close: current, ema20: e20.at(-1), ema50: e50.at(-1), ema200: e200.at(-1),
      hma32: hNow, rsi14: rNow, macdHistogram: mNow, vwap,
      confluenceScore, direction, signals,
      swingLow: Math.min(...swing.map(x => x.low)),
      swingHigh: Math.max(...swing.map(x => x.high))
    };
  }

  function analyze(input, options = {}) {
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const frames = input && input.frames && typeof input.frames === "object" ? input.frames : {};
    const results = TIMEFRAMES.map(key => analyzeFrame(key, frames[key], now));
    const invalid = results.filter(x => !x.valid);
    const stale = results.filter(x => x.valid && x.stale);
    const valid = results.filter(x => x.valid);
    if (invalid.length) {
      return {
        status: "INCOMPLETE", bias: "UNAVAILABLE", tradable: false,
        message: "Futures Bias is unavailable until all required, provenance-verified timeframes contain at least 200 valid bars.",
        missing: invalid.map(x => ({ timeframe: x.timeframe, reason: x.reason, bars: x.bars ?? null })),
        stale: stale.map(x => x.timeframe), frames: results,
        score: null, confluenceScore: null, isProbability: false
      };
    }
    const weights = valid.reduce((sum, item) => sum + RULES[item.timeframe].weight, 0);
    const weighted = valid.reduce((sum, item) => sum + item.confluenceScore * RULES[item.timeframe].weight, 0);
    const score = Math.round(weighted / weights);
    const byTf = Object.fromEntries(valid.map(x => [x.timeframe, x.direction]));
    const higher = [byTf["1d"], byTf["4h"]];
    const lower = [byTf["1h"], byTf["15m"], byTf["5m"]];
    const higherDirectional = higher.filter(x => x === "BULLISH" || x === "BEARISH");
    const higherAligned = higherDirectional.length === 2 && higher[0] === higher[1];
    const higherConflict = higherDirectional.length === 2 && higher[0] !== higher[1];
    const higherSide = higherAligned ? higher[0] : null;
    const opposingLower = higherSide ? lower.filter(x => x !== "NEUTRAL" && x !== higherSide).length : 0;
    const supportingLower = higherSide ? lower.filter(x => x === higherSide).length : 0;
    let bias = score >= 25 ? "BULLISH" : score <= -25 ? "BEARISH" : "NEUTRAL";
    if (higherConflict || (higherSide && opposingLower >= 2 && supportingLower === 0)) bias = "MIXED";
    if (bias !== "MIXED" && bias !== "NEUTRAL" && higherSide && bias !== higherSide) bias = "MIXED";
    const status = stale.length ? "STALE" : "FRESH";
    const oneHour = valid.find(x => x.timeframe === "1h");
    const latest = valid.reduce((max, x) => Math.max(max, timestampMs(x.asOf)), 0);
    const providers = [...new Set(valid.map(x => x.provider))];
    const tradable = status === "FRESH" && bias !== "MIXED" && bias !== "NEUTRAL" && higherAligned &&
      supportingLower >= 2 && opposingLower === 0;
    return {
      status, bias, tradable, score, confluenceScore: score, isProbability: false,
      message: status === "STALE"
        ? "Historical or delayed provider data detected. Directional context is computed, but this is not a current trading signal."
        : tradable
          ? "Higher and lower timeframes align on fresh provider data. This is a confluence reading, not an order instruction or probability."
          : "Directional confluence is incomplete or mixed. Wait for clearer alignment; this is not an order instruction.",
      asOf: latest ? new Date(latest).toISOString() : null,
      providers, stale: stale.map(x => x.timeframe), frames: results,
      opposingLowerTimeframes: opposingLower, supportingLowerTimeframes: supportingLower,
      higherTimeframesAligned: higherAligned,
      invalidation: oneHour ? {
        bullishBelow: oneHour.swingLow,
        bearishAbove: oneHour.swingHigh,
        sourceTimeframe: "1h",
        note: "Reference swing boundaries from the last 20 one-hour bars; validate against the active contract and current session."
      } : null
    };
  }

  return Object.freeze({ analyze, timestampMs, normalizeBars, version: "1.0.0", timeframes: TIMEFRAMES });
});
