"""Traces the land of the classic map of the Domains into travel-map polygons: how geography.json's coast was made.

    python tools/realms/geography-trace.py <domains2.jpg> <out.json> [epsilon]

The reference (realms/docs/ref/domains2.jpg, 811 x 1250, untracked) separates land from its blue sea by color. Sea is
bluer than green and red by margins; on Icehaven, whose glaciers are painted lavender, only deep blue counts. The mask
loses the haze over the top and the signature, is opened and closed (3x3) to drop the lettering, has its holes filled
(lakes are authored apart), and keeps every island of 10 tiles or more. Each outline is scaled into the travel map
(tile = pixel * 0.6 + (12, -19): a 12-tile sea margin west and east) and simplified by Douglas-Peucker to `epsilon`
tiles (0.8). Writes [{area, c: centroid, points}] largest first; geography.json took these as its landmasses (named by
hand, clockwise, the islets where Walassa, Denawa and Stahaan were drawn dropped). Needs Pillow, numpy, scipy, OpenCV.
"""
import json, sys
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

S = 0.60              # tiles per image pixel
OX, OZ = 12.0, -19.0  # tile = pixel * S + O

ref, out_path = sys.argv[1], sys.argv[2]
eps = float(sys.argv[3]) if len(sys.argv) > 3 else 0.8
a = np.asarray(Image.open(ref).convert("RGB")).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
sea = (b - g > 12) & (b - r > 45)
ice = np.zeros_like(sea)
ice[95:300, 40:480] = True  # Icehaven
sea = np.where(ice, (b - r > 70) & (b - g > 25), sea)
land = ~sea
land[:70, :] = False         # the haze over the top
land[1205:, 690:] = False    # the signature
land = ndi.binary_opening(land, np.ones((3, 3)))
land = ndi.binary_closing(land, np.ones((3, 3)))
land = ndi.binary_fill_holes(land)
lab, n = ndi.label(land)
areas = ndi.sum(land, lab, range(1, n + 1))
keep = np.zeros(n + 1, bool)
keep[1:] = np.asarray(areas) >= 10 / (S * S)
land = keep[lab]

polygons = []
contours, _ = cv2.findContours(land.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
for c in contours:
    t = c[:, 0, :].astype(float) * S + np.array([OX, OZ])
    ap = cv2.approxPolyDP(t.astype(np.float32).reshape(-1, 1, 2), eps, True)[:, 0, :]
    if len(ap) < 3:
        continue
    cx, cz = np.mean(ap, axis=0)
    polygons.append({"area": round(float(cv2.contourArea(ap.astype(np.float32))), 1), "c": [round(float(cx)), round(float(cz))],
                     "points": [[round(float(x), 1), round(float(z), 1)] for x, z in ap]})
polygons.sort(key=lambda o: -o["area"])
json.dump(polygons, open(out_path, "w"))
print(len(polygons), "polygons,", sum(len(o["points"]) for o in polygons), "points")
