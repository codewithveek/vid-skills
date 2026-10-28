import { PROMPTS, type PromptName } from "./prompts.generated.js";

export { PROMPTS, type PromptName };

/** Renders a prompt template, replacing {{var}} placeholders. Unknown vars become "". */
export function renderPrompt(name: PromptName, vars: Record<string, unknown> = {}, overrides?: Partial<Record<PromptName, string>>): string {
  const tpl = overrides?.[name] ?? PROMPTS[name];
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null) return "";
    return typeof v === "string" ? v : JSON.stringify(v, null, 1);
  });
}
