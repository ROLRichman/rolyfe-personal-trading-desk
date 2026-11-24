export const SETUP_SLIDES = [
  { title: "Bullish Pullback", kind: "trend continuation" },
  { title: "Bearish Rejection", kind: "bearish reversal" },
  { title: "Breakout + Retest", kind: "range expansion" },
  { title: "Liquidity Sweep", kind: "liquidity event" },
  { title: "Opening Range Breakout", kind: "intraday structure" }
];

export const RESOURCE_GROUPS = [
  {
    title: "Market data & API references",
    items: [
      { title: "Moomoo Open API · Getting Started", note: "Setup and first connection", url: "https://open.moomoo.com/api/overview/getting-started" },
      { title: "Moomoo API Overview", note: "API capabilities and structure", url: "https://open.moomoo.com/api/overview/" },
      { title: "Moomoo Quote API", note: "Market quotes and quote data", url: "https://open.moomoo.com/api/quote/overview" },
      { title: "Moomoo Trading API", note: "Trading API reference", url: "https://open.moomoo.com/api/trading/overview" },
      { title: "Moomoo API Reference", note: "Full API reference", url: "https://open.moomoo.com/api-reference" }
    ]
  },
  {
    title: "RO’Lyfe trading workspaces",
    items: [
      { title: "Personal Trading Desk", note: "Current command center · repository", url: "https://github.com/ROLRichman/rolyfe-personal-trading-desk" },
      { title: "Trading Intelligence Classroom", note: "Learning environment · repository", url: "https://github.com/ROLRichman/RO-Lyfe-Trading-Intelligence-Classroom" },
      { title: "Tactical Intelligence Center", note: "Trading scanners and chart engine · repository", url: "https://github.com/ROLRichman/RO-Lyfe-Tactical-Intelligence-Center-" },
      { title: "RO’Lyfe Market Terminal", note: "Market terminal project · repository", url: "https://github.com/ROLRichman/rolyfe-market-terminal" },
      { title: "Trading Calculator Pro", note: "Options and strategy calculator · repository", url: "https://github.com/ROLRichman/ROlyfe-Trading-Calculator-Pro" },
      { title: "RO’Lyfe Terminal Pro", note: "Terminal project · repository", url: "https://github.com/ROLRichman/rolyfe-terminal-pro" },
      { title: "Family Wealth & Trading Academy", note: "Family learning workspace · repository", url: "https://github.com/ROLRichman/rolyfe-family-wealth-academy" }
    ]
  }
];

function renderResources() {
  const root = document.getElementById("resourceLibraryGroups");
  if (!root) return;
  root.replaceChildren();
  RESOURCE_GROUPS.forEach(group => {
    const section = document.createElement("section");
    section.className = "resource-group";
    const heading = document.createElement("h3");
    heading.className = "resource-group-title";
    heading.textContent = group.title;
    const links = document.createElement("div");
    links.className = "resource-links";
    group.items.forEach(item => {
      const anchor = document.createElement("a");
      anchor.className = "resource-link";
      anchor.href = item.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      const copy = document.createElement("span");
      copy.className = "resource-link-copy";
      const title = document.createElement("b");
      title.textContent = item.title;
      const note = document.createElement("small");
      note.textContent = item.note;
      copy.append(title, note);
      const arrow = document.createElement("span");
      arrow.className = "resource-link-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";
      anchor.append(copy, arrow);
      links.append(anchor);
    });
    section.append(heading, links);
    root.append(section);
  });
}

function setupSlider() {
  const track = document.getElementById("setupSlider");
  const count = document.getElementById("setupSliderCount");
  const previous = document.getElementById("setupSliderPrev");
  const next = document.getElementById("setupSliderNext");
  if (!track || !count || !previous || !next) return;
  const slides = Array.from(track.querySelectorAll(".setup-slide"));
  const updateCount = () => {
    const first = slides.findIndex(slide => slide.offsetLeft + slide.offsetWidth > track.scrollLeft + 12);
    const active = Math.max(0, first);
    count.textContent = String(active + 1).padStart(2, "0") + " / " + String(slides.length).padStart(2, "0");
    previous.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
  };
  const move = direction => {
    const step = Math.max(220, Math.round(track.clientWidth * 0.82));
    track.scrollBy({ left: direction * step, behavior: "smooth" });
  };
  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  track.addEventListener("scroll", updateCount, { passive: true });
  window.addEventListener("resize", updateCount);
  updateCount();
}

if (typeof document !== "undefined") {
  renderResources();
  setupSlider();
}
