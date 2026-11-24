(() => {
  const panel = document.getElementById("tradingViewNewsPanel");
  if (!panel) return;
  let loaded = false;
  const load = () => {
    if (loaded) return;
    const configNode = panel.querySelector(".tv-news-widget-config");
    const container = panel.querySelector(".tv-news-widget");
    if (!configNode || !container) return;
    let config;
    try { config = JSON.parse(configNode.textContent || "{}"); }
    catch (_) { return; }
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-timeline.js";
    script.async = true;
    script.type = "text/javascript";
    script.textContent = JSON.stringify(config);
    container.appendChild(script);
    loaded = true;
  };
  if (panel.open) load();
  panel.addEventListener("toggle", () => { if (panel.open) load(); });
})();