import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=readFileSync(new URL("../shared/atlas-universal.js",import.meta.url),"utf8");
assert.match(source,/const legacyPromptFab = document\.getElementById\("aiFab"\)/);
assert.match(source,/legacyPromptFab\.style\.right = "136px"/);
assert.match(source,/legacyPromptFab\.style\.zIndex = "30"/);
console.log("PASS: Universal Atlas no longer covers the legacy classroom prompt helper.");
