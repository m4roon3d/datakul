// The app's scripts share one global scope, so a top-level function or variable declared in two files silently
// replaces the first (a function) or breaks the second file (const/let). Fail if any top-level name repeats.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "../web");
const html = readFileSync(join(web, "index.html"), "utf8");
const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]).filter((f) => !/^https?:/.test(f) && f !== "config.js");
const seen = new Map(), clashes = [];
for (const f of files) {
  let src = "";
  try { src = readFileSync(join(web, f), "utf8"); } catch { continue; }
  for (const m of src.matchAll(/^(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))/gm)) {
    const name = m[1] || m[2];
    if (seen.has(name) && seen.get(name) !== f) clashes.push(`${name}: ${seen.get(name)} and ${f}`);
    else seen.set(name, f);
  }
}
if (clashes.length) { console.error("Top-level names declared in more than one script:\n- " + clashes.join("\n- ")); process.exit(1); }
console.log(`no clashes across ${files.length} scripts (${seen.size} top-level names)`);
