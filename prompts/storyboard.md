Create the shot list for this narration. One or more shots per script line. Cuts land on anchor words.

SCRIPT (beats → lines):
{{script}}

STYLE: {{style}}
ASSET POLICY: {{assetPolicy}}

Scene types you can use (pick the one that makes the line most literal):
- broll: a single image or video of the literal noun being said. asset.query = a 2–5 word stock search ("tv remote couch night"); asset.prompt = a generation prompt as a fallback (photographic, 16:11 framing, no text, no logos). treatment: natural | bw | dark | warm | cool | vintage. move: pushIn | pullOut | panLeft | panRight | kenBurns | static.
- montage: a fast list. Use it when the line enumerates 3+ items. items = one asset request per item (4–10 items). perItemSec 0.2–0.27.
- diagram: dark-UI motion graphic for a concept with no literal footage. templates:
  - icon-draw {icon, label?, color?, glow?}. Icons: power, standby, onoff, on, off, moon, check, x, bolt, wifi, eye, lock, cpu, battery, globe, clock, warning, arrow, plug, remote, user, dollar
  - button-cards {cards:[{icon,label,state: on|standby|danger|sleep|idle}], active?: index}
  - toggle-switch {onLabel?, offLabel?, label?}
  - flow {nodes:[{label, icon}]} (2–4 nodes)
  - compare {left, right, leftIcon?, rightIcon?}
  - counter {from, to, unit?, label?}
  - timeline {events:[{year,label}]}
  - checklist {items:[...]}
- typewriter: for a year or a single striking word: lead "Back in", highlight "1973". Use it exactly when the narration says the year.
- document: a page of a standard, patent, paper or law (asset.query/prompt describes it) with highlights (normalised boxes) and an optional zoomTo.
- analogy: a relatable visual metaphor with a white tag (caption) naming what it stands for (e.g. caption "Tech industry" on a chaotic crowd). Use one every 20–40 s. Never use film or TV clips or famous people. Describe original or stock imagery.
- stat: big number + caption, for a single impressive figure (cite sourceClaimId).
- quote: a short quotation with attribution.
- cta: for the call to action line (variant subscribe-morph).
- endcard: optional final card (handle/text). At most one, last.

Rules:
- Every shot: id (sh1, sh2, …), lineId (from the script), anchor (an exact word or short phrase from that line where the cut should land; the first shot of a line can omit it).
- A line under ~2 s usually gets one shot; longer lines get a cut every 1–3 s on new nouns.
- Shot 1 must be striking and readable on frame 0 (it is the thumbnail).
- Prefer diagrams for mechanisms, broll for nouns, montage for lists, typewriter for years, document for "the official rulebook says".
- Do not repeat the same asset query twice. Vary treatment and move.
- Optional sfx per shot only for visible actions: click, pop, tick, swipe, whoosh, riser, impact.
