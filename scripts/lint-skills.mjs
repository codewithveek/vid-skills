#!/usr/bin/env node
// Validates skills/*/SKILL.md and agents/*.md frontmatter (name matches folder, description present and specific).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const errors = [];
const front = (file) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, "utf8"));
  if (!m) return null;
  return Object.fromEntries(m[1].split("\n").map((l) => l.match(/^(\w[\w-]*):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2]]));
};
for (const d of readdirSync("skills")) {
  const f = join("skills", d, "SKILL.md");
  if (!existsSync(f)) continue;
  const fm = front(f);
  if (!fm) errors.push(`${f}: missing frontmatter`);
  else {
    if (fm.name !== d) errors.push(`${f}: name "${fm.name}" must equal folder "${d}"`);
    if (!fm.description || fm.description.length < 60) errors.push(`${f}: description too short`);
    if (fm.description && fm.description.length > 1024) errors.push(`${f}: description over 1024 chars`);
  }
}
for (const f of readdirSync("agents").filter((x) => x.endsWith(".md"))) {
  const fm = front(join("agents", f));
  if (!fm?.name || !fm?.description) errors.push(`agents/${f}: needs name and description`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("skills ok");
