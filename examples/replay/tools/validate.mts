// Validate replay answer files against the pipeline schemas and print the narration as it will be spoken.
// Usage: npx tsx examples/replay/tools/validate.mts <name> [<name>...]   (name = file in examples/replay without .json)
import { readFileSync } from "node:fs";
import { PublishCopy, ResearchDossier, Script, Storyboard, toSpeech } from "../../../packages/core/src/index.js";

for (const name of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(new URL(`../${name}.json`, import.meta.url), "utf8"));
  const errs: string[] = [];
  for (const [k, schema] of [["ResearchDossier", ResearchDossier], ["Script", Script], ["Storyboard", Storyboard], ["PublishCopy", PublishCopy]] as const) {
    const r = schema.safeParse(d[k]);
    if (!r.success) errs.push(`${k}: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const lines = new Set<string>(d.Script.beats.flatMap((b: { lines: { id: string }[] }) => b.lines.map((l) => l.id)));
  for (const s of d.Storyboard.shots) if (!lines.has(s.lineId)) errs.push(`shot ${s.id}: unknown line ${s.lineId}`);
  console.log(`${name} ${errs.length ? "INVALID" : "valid"}`);
  for (const e of errs) console.log(`  ${e}`);
  for (const b of d.Script.beats) for (const l of b.lines) console.log(`   ${toSpeech(l.text).spoken}`);
}
