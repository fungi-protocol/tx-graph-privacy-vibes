// Inline the esbuild bundle into the html template, producing the single
// deliverable file. usage: node build.mjs <bundle.js> <template.html> <out.html>
import { readFileSync, writeFileSync } from "node:fs";

const [js, template, out] = process.argv.slice(2);
const bundle = readFileSync(js, "utf8");
const html = readFileSync(template, "utf8");
const marker = "<!--APP_JS-->";
if (!html.includes(marker)) throw new Error(`template missing ${marker}`);
// </script> inside the bundle would terminate the inline script early
const safe = bundle.replaceAll("</script>", "<\\/script>");
// function replacement: a string here would mangle $-sequences ($$, $&, $')
// that legitimately occur in minified JavaScript
writeFileSync(out, html.replace(marker, () => `<script>${safe}</script>`));
console.log(`wrote ${out}`);
