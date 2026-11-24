export function normalizeFuturesBars(input) {
  if (!Array.isArray(input)) return [];
  const normalized = input.map((bar) => {
    const rawTime = bar?.window_start ?? bar?.t ?? bar?.time ?? bar?.timestamp;
    let millis = NaN;
    if (typeof rawTime === "string" && !/^\d{9,}$/.test(rawTime.trim())) millis = Date.parse(rawTime);
    else {
      const value = Number(rawTime);
      if (Number.isFinite(value)) millis = value > 1e16 ? value / 1e6 : value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN;
    }
    const open=Number(bar?.open??bar?.o),high=Number(bar?.high??bar?.h),low=Number(bar?.low??bar?.l),close=Number(bar?.close??bar?.c),volume=Number(bar?.volume??bar?.v);
    if(!Number.isFinite(millis)||![open,high,low,close].every(Number.isFinite)||millis<=0)return null;
    return {t:new Date(millis).toISOString(),o:open,h:high,l:low,c:close,v:Number.isFinite(volume)&&volume>=0?volume:0};
  }).filter(Boolean);
  const unique=new Map(normalized.map(bar=>[bar.t,bar]));
  return [...unique.values()].sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
}
