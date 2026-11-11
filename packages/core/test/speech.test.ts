import { describe, expect, it } from "vitest";
import { MemoryStorage, cardinal, estimateWordTimings, remapToDisplay, runPipeline, toSpeech, yearWords, type TTSProvider, type TTSRequest } from "../src/index.js";
import { fakeLLM, fakeTTS } from "./fixtures.js";

describe("speech normalization", () => {
  it("reads years like a narrator", () => {
    expect(yearWords(1868)).toBe("eighteen sixty-eight");
    expect(yearWords(1905)).toBe("nineteen oh five");
    expect(yearWords(1900)).toBe("nineteen hundred");
    expect(yearWords(2000)).toBe("two thousand");
    expect(yearWords(2004)).toBe("two thousand four");
    expect(yearWords(2024)).toBe("twenty twenty-four");
  });
  it("rewrites years in context and keeps punctuation", () => {
    expect(toSpeech("Back in 1868, outside Parliament.").spoken).toBe("Back in eighteen sixty-eight, outside Parliament.");
    expect(toSpeech("By 2004, a new standard").spoken).toBe("By two thousand four, a new standard");
    expect(toSpeech("In 1920, a Detroit signal").spoken).toBe("In nineteen twenty, a Detroit signal");
    expect(toSpeech("on 2 January 1869 it exploded").spoken).toBe("on two January eighteen sixty-nine it exploded");
    expect(toSpeech("Sony made the last ones in 2011.").spoken).toBe("Sony made the last ones in twenty eleven.");
    expect(toSpeech("Then came the 1840 election.").spoken).toBe("Then came the eighteen forty election.");
    expect(toSpeech("the 1500 people who came").spoken).toBe("the one thousand five hundred people who came");
  });
  it("reads Roman numerals after cue words as numbers", () => {
    expect(toSpeech("the Harvard Mark II found a moth").spoken).toBe("the Harvard Mark two found a moth");
    expect(toSpeech("after World War I, and Apollo XI.").spoken).toBe("after World War one, and Apollo eleven.");
    expect(toSpeech("I think Henry VIII and I agree").spoken).toBe("I think Henry VIII and I agree");
  });
  it("handles decades, quantities, money, percent and ordinals", () => {
    expect(toSpeech("the 1980s").spoken).toBe("the nineteen eighties");
    expect(toSpeech("1500 people").spoken).toBe("one thousand five hundred people");
    expect(toSpeech("it holds 1.44 megabytes").spoken).toBe("it holds one point four four megabytes");
    expect(toSpeech("$5 or 45% on the 3rd day").spoken).toBe("five dollars or forty-five percent on the third day");
    expect(cardinal(1_250_000)).toBe("one million two hundred and fifty thousand");
  });
  it("folds spoken word timings back onto display tokens", () => {
    const sp = toSpeech("Back in 1868, outside.");
    const spoken = estimateWordTimings(sp.spoken, 2);
    expect(spoken.length).toBe(5);
    const display = remapToDisplay(spoken, sp);
    expect(display.map((w) => w.text)).toEqual(["Back", "in", "1868,", "outside."]);
    expect(display[2]!.start).toBe(spoken[2]!.start);
    expect(display[2]!.end).toBe(spoken[3]!.end);
  });
  it("leaves timings alone when counts don't line up", () => {
    const sp = toSpeech("Back in 1868");
    const odd = estimateWordTimings("back in eighteen sixty eight", 2); // STT split the hyphen
    expect(remapToDisplay(odd, sp)).toBe(odd);
  });
  it("respells words engines misread, keeping the display text", () => {
    const sp = toSpeech("The Gaels called it Samhain, the end of harvest.");
    expect(sp.spoken).toBe("The Gaels called it Souwin, the end of harvest.");
    expect(sp.map.find((m) => m.display === "Samhain,")?.spoken).toBe(1);
  });
  it("says GIF and JIF as words with the intended g", () => {
    expect(toSpeech("He made the GIF. He said JIF.").spoken).toBe("He made the giff. He said jiff.");
  });
});

describe("pipeline voice stage", () => {
  it("sends spelled-out years to TTS but keeps digits in captions", async () => {
    const seen: string[] = [];
    const base = fakeTTS();
    const tts: TTSProvider = { ...base, synthesize: (r: TTSRequest) => (seen.push(r.text), base.synthesize(r)) };
    const res = await runPipeline({ topic: "the floppy disk save icon", durationSec: 25 }, { providers: { llm: fakeLLM(), tts }, storage: new MemoryStorage(), jobId: "sp1", stopAfter: "sound" });
    expect(seen.join(" ")).toContain("nineteen eighty-one");
    expect(seen.join(" ")).not.toMatch(/\b1981\b/);
    const capWords = res.timeline!.captions.flatMap((c) => c.words.map((w) => w.text));
    expect(capWords.some((w) => w.startsWith("1981"))).toBe(true);
    // the typewriter shot still lands on the year
    const tw = res.timeline!.scenes.find((s) => s.scene.type === "typewriter")!;
    const yearWord = res.timeline!.captions.flatMap((c) => c.words).find((w) => w.text.startsWith("1981"))!;
    expect(Math.abs(tw.start - yearWord.start)).toBeLessThan(0.1);
  });
});

describe("handle", () => {
  it("uses the brief's handle on the end card and watermark", async () => {
    const res = await runPipeline({ topic: "the floppy disk save icon", durationSec: 25, handle: "@hiddeninplainsight.tv" }, { providers: { llm: fakeLLM(), tts: fakeTTS() }, storage: new MemoryStorage(), jobId: "h1", stopAfter: "compose" });
    const end = res.timeline!.scenes.find((s) => s.scene.type === "endcard")!;
    expect(end.scene.type === "endcard" && end.scene.handle).toBe("@hiddeninplainsight.tv");
    expect(res.project!.files["compositions/chrome.html"]).toContain("@hiddeninplainsight.tv");
    expect(Object.values(res.project!.files).join("")).not.toContain("@vidskills");
  });
});

