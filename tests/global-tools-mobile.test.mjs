import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
test("shared mobile toolbar cannot force page width beyond viewport",()=>{
 const source=readFileSync(new URL("../shared/rolyfe-global-tools.js",import.meta.url),"utf8");
 assert.match(source,/max-width:100vw;overflow-x:clip/);
 assert.match(source,/rol-global-group[^}]*flex-wrap:wrap/);
 assert.match(source,/rol-global-current[^}]*white-space:normal/);
});
