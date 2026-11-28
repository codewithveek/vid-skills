"""Contact sheet of stock candidates, to pick exact files for a replay.

  python3 -I probe.py OUT.jpg "wm:<commons search>" "photo:<pexels query>" "video:<pexels query>" ...
Prints one line per candidate (index, source, id/title, size, license) and saves a labelled grid.
Wikimedia is rate limited: keep probes small, and never run them while a build is downloading.
"""
import io, json, os, sys, time, urllib.parse, urllib.request
from PIL import Image, ImageDraw
UA = "vid-skills/0.1 (https://github.com/codewithveek/vid-skills)"
def get(url, headers=None):
    for n in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
            return urllib.request.urlopen(req, timeout=30).read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and n < 3: time.sleep(5 * 2 ** n); continue
            raise
out, specs = sys.argv[1], sys.argv[2:]
items = []
def collect(kind, q):
    if kind == "wm":
        u = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": 6, "gsrsearch": f"filetype:bitmap {q}", "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": 330})
        pages = json.loads(get(u)).get("query", {}).get("pages", {})
        for p in sorted(pages.values(), key=lambda p: p.get("index", 0)):
            ii = p["imageinfo"][0]; lic = ii.get("extmetadata", {}).get("LicenseShortName", {}).get("value", "?")
            items.append((q, p["title"], f'{ii["width"]}x{ii["height"]} {lic}', ii["thumburl"]))
    else:
        u = f"https://api.pexels.com/{'videos/' if kind == 'video' else 'v1/'}search?" + urllib.parse.urlencode({"query": q, "per_page": 6, "orientation": "portrait"})
        for r in json.loads(get(u, {"Authorization": os.environ["PEXELS_API_KEY"]})).get("videos" if kind == "video" else "photos", []):
            if kind == "video": items.append((q, f"V{r['id']}", f"{r['duration']}s {r['url'][-60:]}", r["image"]))
            else: items.append((q, f"P{r['id']}", f"{r['width']}x{r['height']} {r.get('alt', '')[:70]}", r["src"]["medium"]))
for spec in specs:
    kind, q = spec.split(":", 1)
    try: collect(kind, q)
    except Exception as e: print(f"skip {spec}: {e}")
W, H, cols = 250, 330, 6
sheet = Image.new("RGB", (W * cols, (H + 40) * ((len(items) + cols - 1) // cols)), "white")
d = ImageDraw.Draw(sheet)
for i, (q, title, info, thumb) in enumerate(items):
    print(i, q, "|", title, "|", info)
    try:
        im = Image.open(io.BytesIO(get(thumb))).convert("RGB"); im.thumbnail((W - 10, H - 10))
        sheet.paste(im, ((i % cols) * W + 5, (i // cols) * (H + 40) + 5))
    except Exception as e: print("  thumb failed", e)
    d.text(((i % cols) * W + 5, (i // cols) * (H + 40) + H + 2), f"{i}: {title[:40]}", fill="red")
sheet.save(out)
