import type { LLMProvider, LLMRequest, TTSProvider } from "../src/providers.js";
import { floatToWav } from "../src/audio/codec.js";
import type { ResearchDossier, Script, Storyboard } from "../src/spec.js";

export const dossier: ResearchDossier = {
  topic: "the floppy disk save icon",
  summary: "The save icon is a 3.5-inch floppy disk, a medium most users under 25 have never touched.",
  angle: "The most-clicked icon in software depicts an object that disappeared decades ago.",
  claims: [
    { id: "c1", text: "Sony introduced the 3.5-inch floppy disk in 1981.", sources: [], confidence: "medium" },
    { id: "c2", text: "A 3.5-inch high-density floppy holds 1.44 MB.", sources: [], confidence: "high" },
    { id: "c3", text: "Sony stopped manufacturing floppy disks in 2011.", sources: [], confidence: "medium" },
  ],
  timeline: [
    { year: "1981", event: "3.5-inch floppy introduced", claimId: "c1" },
    { year: "2011", event: "Sony ends production", claimId: "c3" },
  ],
  analogies: ["a skeuomorph, like a phone icon shaped like a handset"],
  visualIdeas: ["close-up of a blue floppy disk"],
  openQuestions: [],
};

export const script: Script = {
  headline: "Your Save Icon Is a Fossil",
  cta: "Follow for more icons hiding history.",
  beats: [
    { id: "b1", kind: "hook", musicCue: "none", lines: [{ id: "l1", text: "Look at the save button in whatever app you have open.", emphasis: ["save"], claimIds: [], pauseAfterSec: 0.25 }] },
    {
      id: "b2",
      kind: "stakes",
      musicCue: "none",
      lines: [{ id: "l2", text: "Word, Excel, Photoshop, even your browser all use the same little square.", emphasis: ["same"], claimIds: [], pauseAfterSec: 0.25 }],
    },
    { id: "b3", kind: "twist", musicCue: "drop", lines: [{ id: "l3", text: "Except that square is a floppy disk, and it holds 1.44 megabytes.", emphasis: ["floppy"], claimIds: ["c2"], pauseAfterSec: 0.3 }] },
    { id: "b4", kind: "history", musicCue: "none", lines: [{ id: "l4", text: "Back in 1981, Sony shrank the disk to fit a shirt pocket.", emphasis: ["1981"], claimIds: ["c1"], pauseAfterSec: 0.25 }] },
    { id: "b5", kind: "payoff", musicCue: "none", lines: [{ id: "l5", text: "Sony made the last ones in 2011, but the icon never left.", emphasis: ["never"], claimIds: ["c3"], pauseAfterSec: 0.25 }] },
    { id: "b6", kind: "cta", musicCue: "none", lines: [{ id: "l6", text: "Save this video. The irony is free.", emphasis: ["free"], claimIds: [], pauseAfterSec: 0.2 }] },
  ],
};

export const storyboard: Storyboard = {
  shots: [
    { id: "sh1", lineId: "l1", scene: { type: "diagram", template: "icon-draw", data: { icon: "check", label: "SAVE", color: "#20FFF6", glow: "yes" } } },
    {
      id: "sh2",
      lineId: "l2",
      scene: {
        type: "montage",
        perItemSec: 0.22,
        items: [
          { kind: "image", query: "word processor", prefer: "either" },
          { kind: "image", query: "spreadsheet", prefer: "either" },
          { kind: "image", query: "photo editor", prefer: "either" },
          { kind: "image", query: "web browser", prefer: "either" },
        ],
      },
    },
    { id: "sh3", lineId: "l3", anchor: "floppy", scene: { type: "broll", asset: { kind: "image", query: "floppy disk", prefer: "either" }, treatment: "natural", move: "pushIn", label: "1.44 MB" } },
    { id: "sh4", lineId: "l4", anchor: "1981", scene: { type: "typewriter", lead: "Back in", highlight: "1981", cps: 12 } },
    { id: "sh5", lineId: "l4", anchor: "pocket", scene: { type: "diagram", template: "compare", data: { left: "8-INCH", right: "3.5-INCH", leftIcon: "off", rightIcon: "check" } } },
    { id: "sh6", lineId: "l5", scene: { type: "diagram", template: "timeline", data: { events: [{ year: "1981", label: "Introduced" }, { year: "2011", label: "Last made" }] } } },
    { id: "sh7", lineId: "l6", scene: { type: "cta", variant: "subscribe-morph", text: "FOLLOW", doneText: "FOLLOWING" } },
    { id: "sh8", lineId: "l6", scene: { type: "endcard", handle: "@vidskills" } },
  ],
};

/** A fake LLM that answers by schema name, optionally failing once to exercise the repair loop. */
export function fakeLLM(opts: { garbleFirst?: boolean } = {}): LLMProvider & { calls: number } {
  let calls = 0;
  const answers: Record<string, unknown> = {
    ResearchDossier: dossier,
    Script: script,
    Storyboard: storyboard,
    PublishCopy: { title: "The save icon is a 1981 fossil", description: "Look at your save button.", hashtags: ["tech", "history"], keywords: ["floppy disk"], hook: "Your save icon is older than you think.", sources: [] },
  };
  return {
    id: "fake",
    model: "fake-1",
    capabilities: { jsonSchema: false, jsonMode: false, tools: false, vision: false, contextTokens: 32000, maxOutputTokens: 8000 },
    get calls() {
      return calls;
    },
    async complete(req: LLMRequest) {
      calls++;
      const sys = req.messages[0]?.content ?? "";
      const user = req.messages.map((m) => m.content).join("\n");
      const name = /ResearchDossier|research dossier/i.test(user) ? "ResearchDossier" : /shot list/i.test(user) ? "Storyboard" : /narration script/i.test(user) ? "Script" : /publishing copy/i.test(user) ? "PublishCopy" : "Script";
      if (opts.garbleFirst && calls === 1) return { text: "Sure! Here is the JSON:\n```json\n{\"topic\": 1,}\n```", finishReason: "stop" };
      void sys;
      return { text: "Here you go:\n```json\n" + JSON.stringify(answers[name]) + "\n```", finishReason: "stop" };
    },
  };
}

/** A fake TTS that returns silent WAV whose length follows the word count (no timestamps). */
export function fakeTTS(): TTSProvider {
  return {
    id: "fake-tts",
    capabilities: { maxCharsPerRequest: 300, timestamps: "none", ssml: false, instructions: false, contextStitching: false, languages: ["en"], outputs: ["wav"], local: true },
    async synthesize(req) {
      const words = req.text.split(/\s+/).length;
      const dur = (words / 170) * 60 + 0.3;
      const sr = 24000;
      const samples = new Float32Array(Math.floor(dur * sr));
      for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 12) * 0.05 * Math.sin((Math.PI * i) / samples.length);
      return { bytes: floatToWav(samples, sr), mime: "audio/wav", sampleRate: sr, alignment: "none", license: { name: "test", commercialUse: true, requiresAttribution: false } };
    },
  };
}
