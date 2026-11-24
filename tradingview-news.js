(() => {
  const panel = document.getElementById("tradingViewNewsPanel");
  if (!panel) return;
  // TradingView's embed script loads only while the collapsible panel is open.
  // The widget itself owns its feed, refresh cadence, and story destinations.
  let loaded = false;
  const load = () => {
    if (loaded) return;
    const source = panel.querySelector('script[src*="embed-widget-timeline.js"]');
    if (!source) return;
    const script = document.createElement("script");
    script.src = source.src;
    script.async = true;
    script.type = "text/javascript";
    script.text = source.textContent;
    source.replaceWith(script);
    loaded = true;
  };
  if (panel.open) load();
  panel.addEventListener("toggle", () => { if (panel.open) load(); });
})();