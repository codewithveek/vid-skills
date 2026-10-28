// Renders docs/provider-limits.md from the providers' limits registry.
import { writeFileSync } from "node:fs";
import { limitsMarkdown } from "../packages/providers/src/limits.js";
import { allPlatformSpecs } from "../packages/core/src/platforms.js";

let md = limitsMarkdown();
md += "## PUBLISHING PLATFORMS\n\n| Platform | Duration | Max size | Caption limit | Notes |\n| --- | --- | --- | --- | --- |\n";
for (const p of allPlatformSpecs()) {
  md += `| ${p.label} | ${p.minSec}–${p.maxSec} s | ${(p.maxBytes / 2 ** 20).toFixed(0)} MB | ${p.text.captionMax} ${p.text.countUnit} | ${p.notes.join(" ").replace(/\|/g, "/")} ([source](${p.source}), ${p.verifiedAt}) |\n`;
}
writeFileSync(new URL("../docs/provider-limits.md", import.meta.url), md);
console.log("docs/provider-limits.md written");
