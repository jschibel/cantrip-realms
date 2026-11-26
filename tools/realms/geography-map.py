"""Draws a plane's travel-map geography (realms/content/<plane>/geography.json) from straight above, to check it by eye.

    python tools/realms/geography-map.py [plane] [out-dir] [--crop x0,z0,x1,z1 [--scale n]]

Writes, at 2 pixels a tile (the default out-dir is realms/web/e2e/screenshots/world2/):
  geography.png                - land, the areas by biome, lakes, rivers, ranges and passes, roads (straight, through
                                 their passes), ferries, towns, dungeons, landmarks and the labels;
  geography-regions.png        - each land tile tinted by its region (the nearest seed on its landmass, as
                                 realms/web/scripts/worldgen/geography.ts regionAt has it), with the region names;
  geography-vs-reference.png   - geography.png beside the reference map the coast was traced from, scaled into the same
                                 frame (when the reference image is there: the references are untracked local files).
With --crop it draws only geography-crop.png: the map over those tiles at `--scale` pixels a tile (6 by default), with
a grid every 8 tiles labelled every 16, to read places off. Needs Pillow and numpy.
"""
import json, math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
args = sys.argv[1:]
CROP = None
if "--crop" in args:
    i = args.index("--crop")
    CROP = [int(v) for v in args[i + 1].split(",")]
    del args[i:i + 2]
SCALE = 6
if "--scale" in args:
    i = args.index("--scale")
    SCALE = int(args[i + 1])
    del args[i:i + 2]
plane = args[0] if len(args) > 0 else "dominaria"
out_dir = args[1] if len(args) > 1 else os.path.join(ROOT, "realms", "web", "e2e", "screenshots", "world2")
geo = json.load(open(os.path.join(ROOT, "realms", "content", plane, "geography.json"), encoding="utf8"))
P = SCALE if CROP else 2
W, H = geo["size"]

BIOME = {
    "heartland": (150, 186, 96), "plains": (170, 190, 110), "coast": (200, 196, 140), "swamp": (88, 104, 72),
    "mountains": (150, 140, 124), "volcanic": (90, 70, 66), "forest": (70, 120, 60), "tundra": (214, 222, 228),
    "waste": (150, 120, 110), "desert": (226, 204, 150), "badlands": (184, 120, 84), "highlands": (138, 150, 100),
    "jungle": (44, 112, 56),
}
PEAK = {"rock": (110, 96, 84), "snow": (236, 240, 246), "ice": (190, 220, 240), "ash": (70, 62, 62), "sandstone": (200, 170, 110), "redrock": (150, 70, 50)}
SEA, DEEP, LAKE, SWAMP, RIVER = (52, 92, 150), (40, 74, 128), (72, 126, 186), (70, 96, 80), (72, 136, 200)


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


F_SMALL, F_MID, F_BIG, F_LAND = font(11), font(13), font(17), font(26)


def xy(p):
    return (p[0] * P, p[1] * P)


def poly(d, pts, **kw):
    d.polygon([xy(p) for p in pts], **kw)


def land_mask():
    m = Image.new("L", (W * P, H * P), 0)
    d = ImageDraw.Draw(m)
    for l in geo["landmasses"]:
        poly(d, l["points"], fill=255)
    return m


def text(d, at, s, f, fill=(20, 20, 20), halo=(255, 255, 255), anchor="mm"):
    d.text(at, s, font=f, fill=fill, anchor=anchor, stroke_width=2, stroke_fill=halo)


def base_picture():
    """The land, areas, lakes and rivers: what both the map and the regions view start from."""
    img = Image.new("RGB", (W * P, H * P), SEA)
    d = ImageDraw.Draw(img)
    # a margin band, to show the frame's edge
    d.rectangle([0, 0, W * P - 1, H * P - 1], outline=DEEP, width=geo.get("margin", 12) * P)
    mask = land_mask()
    paint = Image.new("RGB", img.size, BIOME[geo["base"]])
    for a in geo["areas"]:
        # an area paints its polygon over the land - only over its landmass's, when it names one
        m = Image.new("L", img.size, 0)
        poly(ImageDraw.Draw(m), a["points"], fill=255)
        if a.get("landmass"):
            only = Image.new("L", img.size, 0)
            poly(ImageDraw.Draw(only), next(l for l in geo["landmasses"] if l["id"] == a["landmass"])["points"], fill=255)
            m = Image.fromarray(np.minimum(np.asarray(m), np.asarray(only)))
        paint.paste(BIOME[a["biome"]], (0, 0), m)
    img.paste(paint, (0, 0), mask)
    for l in geo["landmasses"]:
        poly(d, l["points"], outline=(30, 40, 30))
    return img, d, mask


def draw_water(d):
    for l in geo["lakes"]:
        poly(d, l["points"], fill=SWAMP if l["kind"] == "swamp" else LAKE, outline=(40, 70, 110))
    for r in geo["rivers"]:
        d.line([xy(p) for p in r["points"]], fill=RIVER, width=max(1, int(r["width"] * P)), joint="curve")


def ridge_peaks(m):
    """Peak glyphs along a ridge, every few tiles."""
    pts = m["points"]
    out = []
    step = max(3.0, m["width"] / 2)
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, z1 - z0) / step))
        for k in range(n):
            t = k / n
            out.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t))
    out.append(tuple(pts[-1]))
    return out


def draw_relief(d):
    for m in geo["mountains"]:
        c = PEAK[m["kind"]]
        band = tuple(int(v * 0.75 + 40) for v in PEAK["rock"])
        d.line([xy(p) for p in m["points"]], fill=band, width=int(m["width"] * P), joint="curve")
        s = (2 + 1.6 * m["height"]) * P
        for i, (x, z) in enumerate(ridge_peaks(m)):
            for off in ((-m["width"] / 4, 0), (m["width"] / 4, m["width"] / 5)) if m["width"] >= 8 else ((0, 0),):
                px, pz = (x + off[0] * ((-1) ** i)) * P, (z + off[1]) * P
                d.polygon([(px - s, pz + s * 0.6), (px, pz - s), (px + s, pz + s * 0.6)], fill=(60, 50, 44))
                d.polygon([(px - s * 0.45, pz - s * 0.1), (px, pz - s), (px + s * 0.45, pz - s * 0.1)], fill=c)
    for p in geo["passes"]:
        x, z = xy(p["at"])
        d.ellipse([x - 5, z - 5, x + 5, z + 5], outline=(255, 230, 0), width=2)


def place(end):
    if end.startswith("ferry:"):
        _, fid, side = end.split(":")
        f = next(f for f in geo["ferries"] if f["id"] == fid)
        return f[side]
    if end in geo["towns"]:
        return geo["towns"][end]["at"]
    return geo["dungeons"][end]["at"]


def draw_ways(d):
    passes = {p["name"]: p["at"] for p in geo["passes"]}
    for r in geo["roads"]:
        pts = [place(r["from"])] + [passes[v] for v in r.get("via", [])] + [place(r["to"])]
        d.line([xy(p) for p in pts], fill=(120, 60, 20) if r.get("main") else (160, 110, 60), width=4 if r.get("main") else 2)
    for f in geo["ferries"]:
        (x0, z0), (x1, z1) = f["from"], f["to"]
        n = max(1, int(math.hypot(x1 - x0, z1 - z0) / 3))
        for k in range(0, n, 2):
            a, b = k / n, min(1, (k + 1) / n)
            d.line([((x0 + (x1 - x0) * a) * P, (z0 + (z1 - z0) * a) * P), ((x0 + (x1 - x0) * b) * P, (z0 + (z1 - z0) * b) * P)], fill=(250, 250, 250), width=2)
        for e in (f["from"], f["to"]):
            x, z = xy(e)
            d.rectangle([x - 3, z - 3, x + 3, z + 3], fill=(250, 250, 250), outline=(0, 0, 0))


def draw_places(d):
    size = {"capital": 7, "town": 5, "village": 3}
    layout = os.path.join(ROOT, "realms", "content", plane, "layout.json")
    kinds = {t["id"]: t["kind"] for t in json.load(open(layout, encoding="utf8"))["towns"]} if os.path.exists(layout) else {}
    for tid, t in geo["towns"].items():
        s = size.get(kinds.get(tid, "village"), 5) / 2 * P
        x, z = xy(t["at"])
        d.rectangle([x - s, z - s, x + s, z + s], fill=(230, 60, 50), outline=(0, 0, 0), width=2)
        text(d, (x, z - s - 9), tid, F_MID, fill=(120, 10, 10))
    for did, dg in geo["dungeons"].items():
        x, z = xy(dg["at"])
        tower = did.rsplit("-", 1)[-1].isdigit()
        if tower:
            d.polygon([(x, z - 6), (x + 5, z + 4), (x - 5, z + 4)], fill=(120, 90, 220), outline=(0, 0, 0))
        else:
            d.ellipse([x - 5, z - 5, x + 5, z + 5], fill=(20, 20, 20), outline=(250, 200, 0), width=2)
        text(d, (x, z + 12), did, F_SMALL, fill=(40, 20, 80) if tower else (0, 0, 0))
    for l in geo["landmarks"]:
        x, z = xy(l["at"])
        d.rectangle([x - 3 * P / 2, z - 3 * P / 2, x + 3 * P / 2, z + 3 * P / 2], fill=(255, 215, 0), outline=(0, 0, 0))
        text(d, (x, z - 11), l["name"], F_SMALL, fill=(90, 60, 0))


def draw_labels(d):
    style = {"land": (F_LAND, (40, 40, 40)), "region": (F_BIG, (30, 30, 80)), "feature": (F_MID, (60, 40, 20)), "sea": (F_BIG, (20, 40, 90))}
    for l in geo["labels"]:
        f, c = style[l["kind"]]
        text(d, (l["x"] * P, l["z"] * P), l["name"].upper() if l["kind"] in ("land", "sea") else l["name"], f, fill=c, halo=(235, 240, 250) if l["kind"] == "sea" else (250, 250, 240))


def region_raster():
    """Each land tile's region index (-1 for sea), by the rule geography.ts regionAt keeps."""
    lm = Image.new("I", (W, H), -1)
    d = ImageDraw.Draw(lm)
    for i, l in enumerate(geo["landmasses"]):
        d.polygon([(x - 0.5, z - 0.5) for x, z in l["points"]], fill=i)  # a tile is land when its middle is in
    lm = np.asarray(lm)
    zs, xs = np.mgrid[0:H, 0:W]
    cx, cz = xs + 0.5, zs + 0.5
    seeds = []  # (region index, landmass index, x, z, weight)
    for ri, r in enumerate(geo["regions"]):
        for s in r["seeds"]:
            seeds.append((ri, int(lm[int(s[1]), int(s[0])]), s[0] + 0.5, s[1] + 0.5, r.get("weight", 1)))
    out = np.full((H, W), -1)
    for li in range(len(geo["landmasses"])):
        sel = lm == li
        if not sel.any():
            continue
        mine = [s for s in seeds if s[1] == li] or seeds
        best = np.full(sel.sum(), np.inf); who = np.full(sel.sum(), -1)
        for ri, _, sx, sz, w in mine:
            dd = np.hypot(cx[sel] - sx, cz[sel] - sz) / w
            better = dd < best
            best[better] = dd[better]; who[better] = ri
        out[sel] = who
    return out


def regions_picture():
    img = Image.new("RGB", (W * P, H * P), SEA)
    reg = region_raster()
    rng = np.random.default_rng(7)
    colors = rng.integers(70, 235, size=(len(geo["regions"]), 3))
    pix = np.zeros((H, W, 3), np.uint8); pix[:] = SEA
    pix[reg >= 0] = colors[reg[reg >= 0]]
    img = Image.fromarray(pix).resize((W * P, H * P), Image.NEAREST)
    d = ImageDraw.Draw(img)
    for l in geo["landmasses"]:
        poly(d, l["points"], outline=(20, 20, 20))
    for ri, r in enumerate(geo["regions"]):
        for s in r["seeds"]:
            x, z = xy(s); d.ellipse([x - 3, z - 3, x + 3, z + 3], fill=(0, 0, 0))
        ys, xs_ = np.nonzero(reg == ri)
        if len(xs_):
            text(d, (xs_.mean() * P, ys.mean() * P), f'{r["name"]} ({r["id"]})', F_MID)
    for tid, t in geo["towns"].items():
        x, z = xy(t["at"]); d.rectangle([x - 4, z - 4, x + 4, z + 4], fill=(230, 60, 50), outline=(0, 0, 0))
    return img


def reference_picture():
    ref = geo.get("reference")
    if not ref:
        return None
    path = os.path.join(ROOT, ref["image"])
    if not os.path.exists(path):  # a worktree: the references are untracked, so look in the main checkout
        try:
            common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
            path = os.path.join(os.path.dirname(os.path.abspath(os.path.join(ROOT, common))), ref["image"])
        except OSError:
            pass
    if not os.path.exists(path):
        print(f"no {ref['image']} here: geography-vs-reference.png left out")
        return None
    im = Image.open(path).convert("RGB")
    s = ref["scale"] * P
    out = Image.new("RGB", (W * P, H * P), SEA)
    out.paste(im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS), (round(ref["offset"][0] * P), round(ref["offset"][1] * P)))
    return out


def main():
    os.makedirs(out_dir, exist_ok=True)
    img, d, _ = base_picture()
    draw_water(d)
    draw_relief(d)
    draw_ways(d)
    draw_places(d)
    if CROP:
        x0, z0, x1, z1 = CROP
        for t in range(0, max(W, H) + 1, 8):
            c = (255, 60, 60) if t % 32 == 0 else (255, 255, 120)
            d.line([(t * P, 0), (t * P, H * P)], fill=c, width=1)
            d.line([(0, t * P), (W * P, t * P)], fill=c, width=1)
        for x in range(0, W, 16):
            for z in range(0, H, 16):
                d.text((x * P + 2, z * P + 1), f"{x},{z}", fill=(255, 255, 255), font=F_SMALL)
        img.crop((x0 * P, z0 * P, x1 * P, z1 * P)).save(os.path.join(out_dir, "geography-crop.png"))
        print("drew", os.path.join(out_dir, "geography-crop.png"))
        return
    draw_labels(d)
    img.save(os.path.join(out_dir, "geography.png"))
    regions_picture().save(os.path.join(out_dir, "geography-regions.png"))
    ref = reference_picture()
    if ref is not None:
        both = Image.new("RGB", (W * P * 2 + 8, H * P), (0, 0, 0))
        both.paste(img, (0, 0)); both.paste(ref, (W * P + 8, 0))
        # the traced coast over the reference, to judge the trace
        rd = ImageDraw.Draw(both)
        o = W * P + 8
        at = lambda p: (p[0] * P + o, p[1] * P)
        for l in geo["landmasses"]:
            rd.polygon([at(p) for p in l["points"]], outline=(255, 40, 40))
        # and the authored lines over it: ridges, rivers, places
        for m in geo["mountains"]:
            rd.line([at(p) for p in m["points"]], fill=(255, 0, 255), width=2)
        for r in geo["rivers"]:
            rd.line([at(p) for p in r["points"]], fill=(0, 255, 255), width=1)
        for t in geo["towns"].values():
            x, z = at(t["at"]); rd.rectangle([x - 3, z - 3, x + 3, z + 3], outline=(255, 255, 0), width=2)
        both.save(os.path.join(out_dir, "geography-vs-reference.png"))
    print("drew", out_dir)


main()
