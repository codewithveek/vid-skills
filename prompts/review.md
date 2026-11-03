Review this video plan like a picky senior editor and fact-checker. Be specific.

HEADLINE: {{headline}}
SCRIPT:
{{script}}
STORYBOARD (shot → line, scene type, anchor):
{{storyboard}}
CLAIMS:
{{claims}}
AUTOMATED QA FINDINGS:
{{findings}}

Check:
1. Hook: is frame 0 striking and does line 1 create a question within 2 seconds?
2. Accuracy: is any factual line unsupported by a high/medium claim? Any overstatement?
3. Literalness: does each shot show what is being said at its anchor word?
4. Rhythm: is there a new visual at least every 3 s and a "turn" every 20–30 s?
5. Rights: any asset that implies copyrighted film or TV, logos as hero, or real people?
6. CTA: does it reuse the topic metaphor?

Return JSON: { "pass": boolean, "score": 0-100, "issues": [{ "severity": "blocker"|"major"|"minor", "where": "line or shot id", "problem": "...", "fix": "..." }] }
