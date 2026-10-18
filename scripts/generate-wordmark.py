#!/usr/bin/env python3
"""Turn `Logo + wordmark.png` (flat art on opaque white) into transparent PNGs.

Naive white-keying fails on this artwork for two reasons:

  * the ring and the "h" *inside* the mark are white too, so keying every white
    pixel would punch a hole straight through the logo; and
  * the faded gauge arc (#8FC4B1) is an opaque light green that happens to equal
    55%-white-over-green, so a coverage heuristic reads it as 44% alpha.

So the matte is solved against the artwork's actual palette: for each pixel find
the palette colour and alpha that best explain it as a blend with white, then
re-opaque any white that is *enclosed* by ink (found by flood-filling from the
border), which restores the ring and "h".

The header draws the lockup at 32dp. Shipping one tall bitmap and letting the
renderer shrink it ~5x is what made the header look mushy, so the matte is cut
once at full resolution and written out as React Native density variants -- the
device then picks a bitmap that is already (within a few percent of) the size it
paints, and nothing is resampled at draw time.
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'Heft Logo', 'Logo + wordmark.png')
OUT = os.path.join(ROOT, 'assets', 'images', 'wordmark')
BASE_HEIGHT = 32           # dp of the header logo -> 1x bitmap is 32px tall

# Every non-white colour actually present in the artwork.
PALETTE = np.array([
    [0x06, 0x7D, 0x52],   # mark green
    [0x0A, 0x2E, 0x22],   # wordmark ink
    [0x8F, 0xC4, 0xB1],   # faded gauge arc (opaque)
], dtype=np.float64)
W = 255.0
TOL = 4.0                 # squared error allowed when tie-breaking by alpha

im = Image.open(SRC).convert('RGB')
px = np.asarray(im, dtype=np.float64)
h, w, _ = px.shape

# --- solve  P = a*C + (1-a)*W  for every palette colour, keep the best fit ---
best_err = np.full((h, w), np.inf)
best_a = np.zeros((h, w))
best_c = np.zeros((h, w, 3))
for C in PALETTE:
    d = C - W                                   # constant 3-vector
    a = np.clip(((px - W) @ d) / (d @ d), 0.0, 1.0)
    recon = a[..., None] * C + (1 - a)[..., None] * W
    err = ((px - recon) ** 2).sum(axis=2)
    # Prefer the candidate that explains the pixel *most opaquely*: the faded
    # arc fits both "faded @ 1.0" and "green @ 0.45" exactly, and only the
    # opaque reading survives on a dark background.
    better = (err < best_err - TOL) | ((err <= best_err + TOL) & (a > best_a))
    best_a = np.where(better, a, best_a)
    best_c = np.where(better[..., None], C, best_c)
    best_err = np.where(better, err, best_err)

alpha = (best_a * 255).round().astype(np.uint8)
rgb = best_c.round().astype(np.uint8)

# --- restore white that is enclosed by ink (the ring and the "h") -----------
transparent = alpha <= 5
outside = np.zeros((h, w), dtype=bool)
stack = []
for x in range(w):
    for y in (0, h - 1):
        if transparent[y, x] and not outside[y, x]:
            outside[y, x] = True
            stack.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if transparent[y, x] and not outside[y, x]:
            outside[y, x] = True
            stack.append((y, x))
while stack:
    y, x = stack.pop()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < h and 0 <= nx < w and transparent[ny, nx] and not outside[ny, nx]:
            outside[ny, nx] = True
            stack.append((ny, nx))
enclosed = transparent & ~outside
rgb[enclosed] = 255
alpha[enclosed] = 255
print(f'enclosed white restored: {int(enclosed.sum()):,} px')

master = Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), 'RGBA')

# --- crop to the ink once, so every variant shares one aspect ratio ---------
bb = master.getchannel('A').getbbox()
m = 6
master = master.crop((max(0, bb[0] - m), max(0, bb[1] - m),
                      min(w, bb[2] + m), min(h, bb[3] + m)))
print('master (cropped)', master.size, 'aspect', master.width / master.height)

# --- write the density variants React Native picks from ---------------------
for suffix, factor in (('', 1), ('@2x', 2), ('@3x', 3)):
    height = BASE_HEIGHT * factor
    img = master.resize((round(master.width * height / master.height), height),
                        Image.LANCZOS)
    path = f'{OUT}{suffix}.png'
    img.save(path)
    print(f'wrote {path}  {img.width}x{img.height}')
