"""Helpers for writing replay answer files (examples/replay/*.json) by hand.

Usage in a topic script:  exec(open("examples/replay/tools/mk.py").read())
"""
import json, os
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..") + "/"
def L(i, t, emph, claims=(), pause=0.3): return {"id": i, "text": t, "emphasis": emph, "claimIds": list(claims), "pauseAfterSec": pause}
def B(i, kind, lines, cue="none"): return {"id": i, "kind": kind, "musicCue": cue, "lines": lines}
def C(i, t, src, conf="high"): return {"id": i, "text": t, "sources": src, "confidence": conf}
def S(u, t, q=None):
    d = {"url": u, "title": t}
    if q: d["quote"] = q
    return d
def broll(title, prompt, label=None, move="pushIn"):
    """An exact Wikimedia Commons file, by (part of) its title."""
    s = {"type": "broll", "asset": {"kind": "image", "query": f'intitle:"{title}"', "prompt": prompt, "prefer": "stock"}, "treatment": "natural", "move": move}
    if label: s["label"] = label
    return s
def pxb(pid, prompt, label=None, move="pushIn", kind="image", focusY=None):
    """An exact Pexels photo or video, by id."""
    s = {"type": "broll", "asset": {"kind": kind, "query": f"pexels:{pid}", "prompt": prompt, "prefer": "stock"}, "treatment": "natural", "move": move}
    if label: s["label"] = label
    if focusY is not None: s["focusY"] = focusY
    return s
def icon(ic, label, color="#FFD400", glow=True):
    d = {"icon": ic, "label": label, "color": color}
    if glow: d["glow"] = "yes"
    return {"type": "diagram", "template": "icon-draw", "data": d}
def tw(lead, hl, cps=14): return {"type": "typewriter", "lead": lead, "highlight": hl, "cps": cps}
def stat(value, caption, claim): return {"type": "stat", "value": value, "caption": caption, "sourceClaimId": claim}
def versus(l, r, winner="right"): return {"type": "versus", "left": l, "right": r, "winner": winner}
def sh(i, line, scene, anchor=None):
    d = {"id": i, "lineId": line, "scene": scene}
    if anchor: d["anchor"] = anchor
    return d
HANDLE = "@hiddeninplainsight.tv"
CTA = lambda n: [sh(f"sh{n}", "lz", {"type": "cta", "variant": "subscribe-morph", "text": "FOLLOW", "doneText": "FOLLOWING"}), sh(f"sh{n+1}", "lz", {"type": "endcard", "handle": HANDLE})]
CTAB = B("b9", "cta", [L("lz", "Follow for more things hiding in plain sight.", ["Follow"], (), 0.2)])
REV = {"pass": True, "score": 90, "issues": []}
def doss(topic, summary, angle, claims): return {"topic": topic, "summary": summary, "angle": angle, "claims": claims, "timeline": [], "analogies": [], "visualIdeas": [], "openQuestions": []}
def copy(title, desc, tags, kw, hook, alt, pin, src):
    return {"title": title, "description": desc, "hashtags": tags, "keywords": kw, "hook": hook, "altText": alt, "pinnedComment": pin, "sources": src}
def out(name, d):
    with open(R + name, "w") as f:
        json.dump(d, f, indent=2, ensure_ascii=False); f.write("\n")
