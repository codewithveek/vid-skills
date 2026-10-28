import { readFileSync } from "node:fs";
import { runPipeline, type StockProvider } from "@vid-skills/core";
import { FsStorage } from "../src/fs-storage.js";
import { materializeProject, checkProject, renderProjectDir } from "../src/render.js";
import { fakeLLM, fakeTTS } from "../../core/test/fixtures.js";

const out = process.argv[2]!;
const media = `${out}/media`;
const dataUrl = (f: string, mime: string) => `data:${mime};base64,${readFileSync(`${media}/${f}`).toString("base64")}`;
let n = 0;
const stock: StockProvider = {
  id: "mock-stock",
  kinds: ["image", "video"],
  async search(q) {
    const lic = { name: "test", commercialUse: true, requiresAttribution: false };
    if (q.kind === "video") return [{ id: "v", kind: "video", url: dataUrl("clip.mp4", "video/mp4"), width: 1280, height: 720, durationSec: 6, provider: "mock", license: lic }];
    const i = n++ % 5;
    return [{ id: `i${i}-${n}`, kind: "image", url: dataUrl(`img${i}.jpg`, "image/jpeg") + `#${n}`, width: 1280, height: 880, provider: "mock", license: lic }];
  },
};
const storage = new FsStorage(`${out}/store`);
const res = await runPipeline({ topic: "the floppy disk save icon", durationSec: 25, handle: "@vidskills" }, { providers: { llm: fakeLLM(), tts: fakeTTS(), stock: [stock] }, storage, jobId: "demo2" });
const dir = await materializeProject({ files: res.project!.files, assetPaths: res.project!.assetPaths }, `${out}/project2`, storage);
const chk = await checkProject(dir);
console.log("CHECK ok=", chk.ok);
console.log(chk.raw.length);
if (process.argv[3] === "render") {
  const t0 = Date.now();
  const r = await renderProjectDir(dir, `${out}/demo.mp4`, { fps: 30, quality: "draft", master: { lufs: -14, truePeak: -1 } }, {});
  console.log("RENDER", JSON.stringify(r).slice(0, 400), (Date.now() - t0) / 1000, "s");
}
