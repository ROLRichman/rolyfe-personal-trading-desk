import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const news = readFileSync(new URL("../tradingview-news.js", import.meta.url), "utf8");

assert.match(app, /let rlPullbackEnabled = true/);
assert.match(app, /enableRLPullbackIndicator\(\);/);
assert.doesNotMatch(app, /\/functions\/v1\/rol-trading-ai/);
assert.match(app, /window\.ROLyfeAtlasLocal/);
assert.match(html, /id="indicator-rl-pullback"[^>]*checked/);
assert.match(html, /shared\/atlas-local\.js/);
assert.match(html, /id="tradingViewNewsPanel"/);
assert.match(html, /tv-news-widget-config/);
assert.match(news, /embed-widget-timeline\.js/);
assert.match(news, /panel\.addEventListener\("toggle"/);
console.log("PASS: RL Pullback defaults ON, Atlas uses local-only guide, TradingView news feed loads on expand.");
