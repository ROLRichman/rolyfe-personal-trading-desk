import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SETUP_SLIDES, RESOURCE_GROUPS } from "../setup-library.js";

test("setup gallery contains the five intended swipe slides", () => {
  assert.equal(SETUP_SLIDES.length, 5);
  assert.deepEqual(SETUP_SLIDES.map(item => item.title), [
    "Bullish Pullback",
    "Bearish Rejection",
    "Breakout + Retest",
    "Liquidity Sweep",
    "Opening Range Breakout"
  ]);
});

test("resource library keeps verified Moomoo docs and RO’Lyfe project repositories", () => {
  const items = RESOURCE_GROUPS.flatMap(group => group.items);
  assert.ok(items.some(item => item.url === "https://open.moomoo.com/api-reference"));
  assert.ok(items.some(item => item.url === "https://github.com/ROLRichman/rolyfe-personal-trading-desk"));
  assert.ok(items.some(item => item.url === "https://github.com/ROLRichman/RO-Lyfe-Trading-Intelligence-Classroom"));
  assert.ok(items.every(item => item.url.startsWith("https://")));
  assert.equal(new Set(items.map(item => item.url)).size, items.length);
});

test("setup and resources page is accessible from the workspace navigation", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /data-view="library"/);
  assert.match(html, /id="view-library"/);
  assert.match(html, /id="setupSlider"/);
  assert.match(html, /id="resourceLibraryGroups"/);
});
