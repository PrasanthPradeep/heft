#!/usr/bin/env python3
"""Generate every app-icon asset from the Heft logo's vector geometry.

Source of truth: assets/Heft Logo/heft-logo-svg.svg
  <rect width=1024 height=1024 rx=230 fill=#067D52/>
  <g transform="translate(512,512) scale(5) translate(-100,-100)">   ->  p -> 5p + 12
    <circle r=60 stroke=#fff stroke-opacity=.55 stroke-width=16
            stroke-dasharray="282.7 377" linecap=round rotate=135/>
    <circle r=60 stroke=#fff stroke-width=16
            stroke-dasharray="205 377" linecap=round rotate=135/>
    <path d="M85 70 V130 M85 104 C85 86 117 86 117 106 V130"
          stroke=#fff stroke-width=14 linecap=round linejoin=round/>
  </g>

PIL measures arc angles from 3 o'clock going clockwise, which is exactly SVG's
y-down convention, so the 135deg rotation transfers unchanged.
"""
import math
import os

from PIL import Image, ImageDraw

# ---- geometry in the SVG's own 1024-unit space ------------------------------
CANVAS = 1024.0
CX = CY = 512.0
RING_R = 300.0          # 60 * 5
RING_W = 80.0           # 16 * 5
H_W = 70.0              # 14 * 5
CORNER_RX = 230.0
ROT = 135.0             # degrees, starts the dash pattern
CIRC = 2 * math.pi * 60  # 376.99, the dasharray total
TRACK_CAP = 0.55        # stroke-opacity of the faded gauge

LOGO_GREEN = '#067D52'
WHITE = '#FFFFFF'
DARK = '#183326'        # Colors.text, reused as the iOS dark field
MINT = '#6EE7AE'        # Colors.accent

SS = 4096               # artwork is rendered once here, then downscaled

# The mark's outer diameter (ring radius + half stroke) as a fraction of the
# 1024 canvas: 680/1024. Adaptive-icon layers need it smaller so a circular
# mask cannot clip the ring.
MARK_NATIVE = (RING_R + RING_W / 2) * 2 / CANVAS          # 0.664
SAFE_FRACTION = 0.60    # inside Android's 66/108dp safe zone


def transform(pts, scale, centre):
    """Scale a point list about the canvas centre."""
    cxp, cyp = centre
    return [(cxp + (x - CANVAS / 2) * scale, cyp + (y - CANVAS / 2) * scale)
            for x, y in pts]


def svg_point(x, y):
    """Apply the SVG group transform p -> 5p + 12."""
    return (5 * x + 12, 5 * y + 12)


def arc_points(radius, a0, a1, step=0.35):
    """Sample a circular arc clockwise from a0 to a1 (degrees)."""
    pts = []
    n = max(2, int(abs(a1 - a0) / step) + 1)
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        pts.append((CX + radius * math.cos(a), CY + radius * math.sin(a)))
    return pts


def cubic(p0, c1, c2, p3, n=900):
    out = []
    for i in range(n + 1):
        t = i / n
        m = 1 - t
        out.append((
            m**3 * p0[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t**3 * p3[0],
            m**3 * p0[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t**3 * p3[1],
        ))
    return out


def resample(pts, step):
    """Walk a polyline, emitting points at most `step` apart.

    PIL's own thick-polyline drawing (``joint='curve'``) spikes when the
    segments are much shorter than the stroke is wide, so strokes here are
    built by stamping a round brush along a re-spaced path instead."""
    out = [pts[0]]
    for cur in pts[1:]:
        while True:
            d = math.dist(out[-1], cur)
            if d < step:
                break
            f = step / d
            out.append((out[-1][0] + (cur[0] - out[-1][0]) * f,
                        out[-1][1] + (cur[1] - out[-1][1]) * f))
    if math.dist(out[-1], pts[-1]) > 1e-6:
        out.append(pts[-1])
    return out


def stroke(draw, pts, width, fill):
    """Round-capped, round-joined stroke: a circular brush along the path."""
    r = width / 2
    for x, y in resample(pts, max(0.5, width / 8)):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def mark_layer(render_size, colour, size_ratio, alpha=1.0):
    """The ring + 'h' on transparent, scaled so the ring spans size_ratio of it."""
    k = render_size / CANVAS
    scale = size_ratio / MARK_NATIVE
    centre = (CANVAS / 2, CANVAS / 2)

    layer = Image.new('RGBA', (int(render_size), int(render_size)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    def put(pts, width, op):
        scaled = transform(pts, scale, centre)
        scaled = [(x * k, y * k) for x, y in scaled]
        stroke(draw, scaled, width * scale * k, (255, 255, 255, round(255 * op)))

    # faded gauge track: 282.7 of 377 = 270 degrees
    put(arc_points(RING_R, ROT, ROT + 360 * 282.7 / CIRC), RING_W, TRACK_CAP)
    # solid arc: 205 of 377 = 195.75 degrees
    put(arc_points(RING_R, ROT, ROT + 360 * 205 / CIRC), RING_W, 1.0)
    # the 'h'
    stem = [svg_point(85, 70), svg_point(85, 130)]
    put(stem, H_W, 1.0)
    shoulder = cubic(svg_point(85, 104), svg_point(85, 86),
                     svg_point(117, 86), svg_point(117, 106))
    shoulder.append(svg_point(117, 130))
    put(shoulder, H_W, 1.0)

    if colour != WHITE:
        solid = Image.new('RGBA', layer.size, colour + 'FF')
        solid.putalpha(layer.getchannel('A'))
        layer = solid
    if alpha != 1.0:
        a = layer.getchannel('A').point(lambda v: round(v * alpha))
        layer.putalpha(a)
    return layer


def field(size, colour, rounded=False):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        r = CORNER_RX / CANVAS * size
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=colour + 'FF')
    else:
        d.rectangle([0, 0, size - 1, size - 1], fill=colour + 'FF')
    return img


def compose(size, field_colour, mark_colour, size_ratio, rounded=False, with_field=True):
    """Render at SS, downscale to `size`."""
    k = SS / CANVAS
    out = Image.new('RGBA', (SS, SS), (0, 0, 0, 0))
    if with_field:
        out = field(SS, field_colour, rounded=rounded)
    mark = mark_layer(SS, mark_colour, size_ratio)
    out = Image.alpha_composite(out, mark)
    return out.resize((size, size), Image.LANCZOS)


def opaque(img, bg=(255, 255, 255)):
    """Flatten alpha onto a solid background (stores forbid transparency)."""
    flat = Image.new('RGB', img.size, bg)
    flat.paste(img, (0, 0), img)
    return flat


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'images')

# 1. Top-level icon: iOS-facing, so full bleed with no corner rounding and no
#    alpha (iOS applies its own mask and renders transparency as black).
opaque(compose(1024, LOGO_GREEN, WHITE, MARK_NATIVE)).save(f'{OUT}/icon.png')

# 2. Android adaptive layers. Background bleeds to every edge; the foreground
#    mark is pulled in to the safe zone. 1024 square, matching each other.
field(1024, LOGO_GREEN, rounded=False).convert('RGB').save(
    f'{OUT}/android-icon-background.png')
compose(1024, LOGO_GREEN, WHITE, SAFE_FRACTION, with_field=False).save(
    f'{OUT}/android-icon-foreground.png')

# 3. Monochrome (Android 13+ themed icons): a single-ink silhouette on
#    transparent. The OS recolours it, so black is arbitrary but neutral; the
#    0.55 gauge arc survives as a lighter tint.
compose(1024, LOGO_GREEN, '#000000', SAFE_FRACTION, with_field=False).save(
    f'{OUT}/android-icon-monochrome.png')

# 4. Splash mark: white, no field, tightly cropped so `imageWidth` in app.json
#    maps to the visible width rather than including transparent padding.
compose(512, LOGO_GREEN, WHITE, 0.94, with_field=False).save(
    f'{OUT}/splash-icon.png')

# 5. Favicon: the logo as drawn, rounded corners and all.
compose(192, LOGO_GREEN, WHITE, MARK_NATIVE, rounded=True).save(
    f'{OUT}/favicon.png')

# 6. iOS appearance variants. `light` is simply icon.png (identical artwork),
#    so only the dark field needs its own file.
opaque(compose(1024, DARK, WHITE, MARK_NATIVE)).save(
    f'{OUT}/ios-icon-dark.png')

for f in sorted(os.listdir(OUT)):
    if f.endswith('.png') and ('icon' in f or 'favicon' in f):
        im = Image.open(os.path.join(OUT, f))
        print(f'{f:34} {im.size[0]}x{im.size[1]} {im.mode}')
