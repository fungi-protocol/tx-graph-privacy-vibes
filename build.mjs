// Inline the esbuild bundles into the html template, producing the single
// deliverable file.
// usage: node build.mjs <bundle.js> [worker.js] <template.html> <out.html>
// The worker bundle (when given) lands as a JSON string on window, NOT a
// script: the page spawns it as a Blob worker (#84) — a single html file
// has no separate URL to hand new Worker().
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const [js, worker, template, out] = args.length === 4 ? args : [args[0], null, args[1], args[2]];
const bundle = readFileSync(js, "utf8");
let html = readFileSync(template, "utf8");
const marker = "<!--APP_JS-->";
if (!html.includes(marker)) throw new Error(`template missing ${marker}`);
if (worker !== null) {
  const wmarker = "<!--WORKER_SRC-->";
  if (!html.includes(wmarker)) throw new Error(`template missing ${wmarker}`);
  // "</" must not appear literally inside the inline script ("</script>"
  // would terminate it); "<\/" is the same string under JSON's escaping
  const wsafe = JSON.stringify(readFileSync(worker, "utf8")).replaceAll("</", "<\\/");
  // function replacement here and below: a plain string would mangle
  // $-sequences ($$, $&, $') that legitimately occur in minified output
  html = html.replace(wmarker, () => `<script>window.__WORKER_SRC=${wsafe};</script>`);
}
// </script> inside the bundle would terminate the inline script early
const safe = bundle.replaceAll("</script>", "<\\/script>");
writeFileSync(out, html.replace(marker, () => `<script>${safe}</script>`));
console.log(`wrote ${out}`);
