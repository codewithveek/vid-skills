---
name: research-and-script
description: Research a topic into a cited dossier and write a beat-structured, ear-friendly narration script for a short explainer (hook, stakes, twist, history, mechanism, proof, payoff, CTA) with claim ids, caption emphasis and a word budget. Use before storyboarding, or when asked to write or fix a video script.
---

# Research and script

## Research → `ResearchDossier`

- Tools: MCP `research_topic`, or `stageResearch()`. Providers: Tavily, Exa, Brave or SearXNG for search, Jina Reader or plain fetch for reading, and Wikipedia as the keyless baseline.
- Aim for **one surprising, true angle**: "X isn't actually Y" or "the reason for Z is hidden in plain sight".
- Use 6–14 atomic claims, each with an id (`c1`…), its sources (a URL plus a verbatim quote) and a confidence:
  - **high**: two independent reputable sources, or one primary source (a standard, paper or official doc)
  - **medium**: one reputable secondary source
  - **low**: unverified. It may add color but must not carry the story.
- **Never invent URLs.** Leave sources empty and say what to verify in `openQuestions`.

## Script → `Script`

Word budget = `durationSec × wpm / 60` (wpm ≈ 170). Stay within ±10 %.

| Beat | Job | Rules |
| --- | --- | --- |
| hook | Stop the scroll | Imperative or direct question. Line 1 ≤ 12 words. No greeting |
| stakes | Make it universal | Lists go in ONE comma-separated line (the editor cuts a montage per item) |
| twist | Pattern break | Starts with "Except" or "But". Set `musicCue: "drop"` |
| history / mechanism | Earn the claim | Year anchors ("Back in 1973", "By 2004") become typewriter cards |
| proof | Make it relatable | 1–3 modern, concrete examples |
| payoff | Reframe the hook | One emotional line |
| cta | Convert | Reuse the metaphor ("Your power button lies. The subscribe button won't.") |

Line rules: one sentence per line, ≤ 22 words, spoken English, digits for numbers, 1–2 `emphasis` words, `claimIds` on every factual line, and unique ids `l1…`/`b1…`.

## Self-check before saving

Read it aloud at 170 wpm. Is there a turn every 20–30 s? Can every factual line point to a high or medium claim? Does the CTA reuse the hook's object? Then save it with `save_stage { stage: "script" }` and `resume_job`.
