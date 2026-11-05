#!/usr/bin/env python3
"""Draw the pictures under 使用情境 (FIG. 02 to 05) and write them to web/src/hero-figures-data.ts.

    python3 web/scripts/hero-figures.py           # rewrite the data file
    python3 web/scripts/hero-figures.py --check   # exit 1 if the data file is not what this script draws

The drawing is isometric (30°), like the hero's FIG. 01 (hero-figure-data.ts): a point on the ground grid (x, y) at
height z goes to x' = 150 + (x − y)·cos30°·17, y' = 40 + (x + y)·17/2 − z·17. Each picture is a list of SVG elements
in drawing order (what is drawn later covers what is drawn earlier) and a list of labels: positions only, since the
page fills in the words in its language (pages/hero-figure.tsx). How wide a label is comes from the words in
web/src/i18n, the widest of the three languages, so the frame (viewBox) leaves room for each of them.
"""

import json
import math
import random
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "src" / "hero-figures-data.ts"

C, Sn, U = math.cos(math.pi / 6), 0.5, 17
OX, OY = 150, 40


def P(x, y, z=0):
    return (round(OX + (x - y) * C * U, 1), round(OY + (x + y) * Sn * U - z * U, 1))


def pts(*ps):
    return " ".join(f"{a},{b}" for a, b in ps)


def poly(cls, *ps):
    return f'<polygon class="{cls}" points="{pts(*ps)}"/>'


def line(cls, a, b):
    return f'<path class="{cls}" d="M{a[0]},{a[1]} L{b[0]},{b[1]}"/>'


path = line


def box(x, y, w, d, h, z0=0, extra=""):
    """A block: its top, the face toward the viewer (+y, "left") and the face to the right (+x)."""
    return (poly(f"hero-fig__solid hero-fig__top {extra}", P(x, y, z0 + h), P(x + w, y, z0 + h), P(x + w, y + d, z0 + h), P(x, y + d, z0 + h)) +
            poly(f"hero-fig__solid hero-fig__left {extra}", P(x, y + d, z0), P(x + w, y + d, z0), P(x + w, y + d, z0 + h), P(x, y + d, z0 + h)) +
            poly(f"hero-fig__solid hero-fig__right {extra}", P(x + w, y, z0), P(x + w, y + d, z0), P(x + w, y + d, z0 + h), P(x + w, y, z0 + h)))


def shadow(x, y, w, d, o=.4):
    return poly("hero-fig__shadow", P(x + o, y + o), P(x + w + o, y + o), P(x + w + o, y + d + o), P(x + o, y + d + o))


def grid(x0, x1, y0, y1):
    return ('<path class="hero-fig__grid" d="' +
            " ".join(f"M{P(i, y0)[0]},{P(i, y0)[1]} L{P(i, y1)[0]},{P(i, y1)[1]}" for i in range(x0, x1 + 1)) + " " +
            " ".join(f"M{P(x0, j)[0]},{P(x0, j)[1]} L{P(x1, j)[0]},{P(x1, j)[1]}" for j in range(y0, y1 + 1)) + '"/>')


def phone(x, y):
    w, d, h = 1.3, 2.2, .18
    return (shadow(x, y, w, d, .25) + box(x, y, w, d, h) +
            poly("hero-fig__screen", P(x + .15, y + .2, h), P(x + w - .15, y + .2, h), P(x + w - .15, y + d - .35, h), P(x + .15, y + d - .35, h)))


def globe(gx, gy, r=20):
    """The internet as a globe; also returns its centre on the drawing, for the label beside it."""
    cx, cy = P(gx, gy, 1.2)
    sx, sy = P(gx, gy)
    return (f'<ellipse class="hero-fig__shadow" cx="{sx}" cy="{sy + 4}" rx="18" ry="7"/>' +
            f'<circle class="hero-fig__solid hero-fig__top" cx="{cx}" cy="{cy}" r="{r}"/>' +
            f'<ellipse class="hero-fig__slot" cx="{cx}" cy="{cy}" rx="{r * .45:.1f}" ry="{r}"/>' +
            f'<ellipse class="hero-fig__slot" cx="{cx}" cy="{cy}" rx="{r}" ry="{r * .38:.1f}"/>' +
            f'<path class="hero-fig__slot" d="M{cx},{cy - r} V{cy + r}"/>'), (cx, cy)


def cross(c, s=4.5):
    x, y = c
    return f'<path class="hero-fig__x" d="M{x - s},{y - s} L{x + s},{y + s} M{x + s},{y - s} L{x - s},{y + s}"/>'


def packet(x, y, z, bad=False):
    return box(x, y, .5, .5, .5, z, "hero-fig__bad" if bad else "")


def tower(x, y, w=1.6, d=1.6, h=2.6):
    """A node: a server cabinet with slots on two faces and a light."""
    out = shadow(x, y, w, d, .45) + box(x, y, w, d, h)
    for k in range(1, 4):
        z = h * k / 4
        out += line("hero-fig__slot", P(x + .2, y + d, z), P(x + w - .2, y + d, z))
        out += line("hero-fig__slot", P(x + w, y + .2, z), P(x + w, y + d - .2, z))
    lx, ly = P(x + .35, y + d, h - .3)
    return out + f'<circle class="hero-fig__led" cx="{lx}" cy="{ly}" r="1.6"/>'


def router(x, y, w=1.8, d=1.2, h=.55):
    """The relay's entry: a flat box with two lights on its front and two short antennas."""
    out = shadow(x, y, w, d, .3) + box(x, y, w, d, h)
    for k in (.35, .65):
        lx, ly = P(x + .3 + k * .6, y + d, h * .55)
        out += f'<circle class="hero-fig__led" cx="{lx}" cy="{ly}" r="1.3"/>'
    for ax in (.35, w - .35):
        out += line("hero-fig__slot", P(x + ax, y + .3, h), P(x + ax, y + .3, h + .9))
    return out


def ring(x, y, z, r, n=16):
    """Points of a circle standing upright in the plane y = const, facing the viewer."""
    return [P(x + r * math.cos(2 * math.pi * k / n), y, z + r * math.sin(2 * math.pi * k / n)) for k in range(n + 1)]


def key(x, y, z, cls):
    """A key standing upright, facing the viewer: a ring, a shaft to the right, two teeth hanging from it."""
    r = .34
    out = shadow(x - r, y - .05, 1.9, .2, .25)
    out += poly(f"hero-fig__solid {cls}", *ring(x, y, z, r)[:-1])
    out += poly("hero-fig__keyhole", *ring(x, y, z, r * .45)[:-1])
    out += box(x + r * .85, y - .06, 1.1, .12, .14, z - .07, cls)
    out += box(x + r * .85 + .62, y - .06, .14, .12, .2, z - .27, cls)
    out += box(x + r * .85 + .92, y - .06, .14, .12, .28, z - .35, cls)
    return out


# ---------- labels ----------

# the words of each label, as the page names them (pages/hero-figure.tsx, WORDS)
WORDS = {
    "device": "hero.fig.device", "internet": "hero.fig.internet", "website": "hero.fig2.website", "lists": "hero.fig2.lists",
    "malware": "hero.fig2.malware", "phishing": "hero.fig2.phishing", "scam": "hero.fig2.scam",
    "inspection": "hero.fig3.inspection", "plain": "hero.fig3.plain", "vessel": "hero.fig3.vessel", "fixed": "hero.fig3.fixed",
    "ordinary": "hero.fig3.ordinary",
    "node": "hero.fig4.node", "exit": "hero.fig4.exit", "entry": "hero.fig4.entry", "forward": "hero.fig4.forward",
    "direct": "hero.fig4.direct", "relayed": "hero.fig4.relayed",
    "private": "hero.fig5.private", "public": "hero.fig5.public", "portal": "hero.fig5.portal", "noemail": "hero.fig5.noemail",
    "nodek": "hero.fig5.node",
}
MESSAGES = [json.loads((WEB / "src" / "i18n" / f"{loc}.json").read_text()) for loc in ("zh-TW", "zh-CN", "en")]
# drawing units: a wide (CJK) character 10, any other 5.5, the widest of the three languages
WIDTHS = {k: max(sum(10 if ord(ch) > 0x2e80 else 5.5 for ch in m[w]) for m in MESSAGES) for k, w in WORDS.items()}

LABELS = []


def label(x, y, key, en, anchor="start", note=False, on=False):
    """A label at (x, y): the page writes its words, and under them `en` in small capitals except in English.
    `note` sets it in the lighter type of an aside, `on` gives it a halo where it sits over a shape."""
    LABELS.append({"key": key, "x": round(x, 1), "y": round(y, 1), "anchor": anchor, "note": note, "on": on, "en": en})
    return ""


def label_width(l):
    return max(WIDTHS[l["key"]], len(l["en"]) * 5.3)


def label_box(l, pad=3):
    w = label_width(l)
    left = {"start": l["x"], "middle": l["x"] - w / 2, "end": l["x"] - w}[l["anchor"]]
    return (left - pad, l["y"] - 8 - pad, left + w + pad, l["y"] + 12 + pad)


def shape_boxes(markup):
    """The box around each solid shape, to keep labels off them."""
    out = []
    for m in re.finditer(r'<(polygon|ellipse|circle)[^>]*class="([^"]*)"[^>]*>', markup):
        tag, cls, t = m.group(1), m.group(2), m.group(0)
        if "grid" in cls or "shadow" in cls:
            continue
        if tag == "polygon":
            ps = [tuple(map(float, q.split(","))) for q in re.search(r'points="([^"]+)"', t).group(1).split()]
            xs, ys = [a for a, _ in ps], [b for _, b in ps]
        else:
            num = lambda a: float(re.search(rf' {a}="([^"]+)"', t).group(1))
            cx, cy = num("cx"), num("cy")
            rx, ry = (num("r"), num("r")) if tag == "circle" else (num("rx"), num("ry"))
            xs, ys = [cx - rx, cx + rx], [cy - ry, cy + ry]
        out.append((min(xs), min(ys), max(xs), max(ys)))
    return out


def settle(body):
    """Move each label, in order, to the nearest spot around where it was put that covers no shape and no label."""
    shapes = shape_boxes("".join(body))
    hit = lambda a, b: a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]
    placed = []
    steps = sorted(((dx, dy) for dx in range(-40, 41, 2) for dy in range(-40, 41, 2)), key=lambda d: d[0] ** 2 + d[1] ** 2)
    for l in LABELS:
        x0, y0 = l["x"], l["y"]
        for dx, dy in steps:
            l["x"], l["y"] = round(x0 + dx, 1), round(y0 + dy, 1)
            box_ = label_box(l)
            if not any(hit(box_, s) for s in shapes) and not any(hit(box_, o) for o in placed):
                break
        else:
            l["x"], l["y"] = x0, y0
            sys.exit(f"no room for the label {l['key']}")
        placed.append(label_box(l))


def drawing(body):
    """The picture: its shapes, its labels, and a viewBox around both with a margin."""
    global LABELS
    out = "".join(body)
    xs, ys = [], []
    for m in re.finditer(r'points="([^"]+)"', out):
        for p in m.group(1).split():
            a, b = p.split(",")
            xs.append(float(a))
            ys.append(float(b))
    for l in LABELS:
        w = label_width(l)
        left = {"start": l["x"], "middle": l["x"] - w / 2, "end": l["x"] - w}[l["anchor"]]
        xs += [left, left + w]
        ys += [l["y"] - 10, l["y"] + 13]
    x0, x1, y0, y1 = min(xs) - 12, max(xs) + 12, min(ys) - 10, max(ys) + 10
    res = {"viewBox": f"{x0:.0f} {y0:.0f} {x1 - x0:.0f} {y1 - y0:.0f}", "shapes": out, "labels": LABELS}
    LABELS = []
    return res


# ---------- FIG. 02: lookups go up through three lists; each stops what it knows ----------

def wall_y(x0, x1, wy, h):
    """A thin wall across x at y = wy, its face toward the viewer on the +y side, with a mesh on that face."""
    out = box(x0, wy, x1 - x0, .14, h, 0, "hero-fig__wall")
    for k in range(1, 4):
        z = h * k / 4
        out += line("hero-fig__mesh", P(x0, wy + .14, z), P(x1, wy + .14, z))
    for k in range(1, 6):
        xx = x0 + (x1 - x0) * k / 6
        out += line("hero-fig__mesh", P(xx, wy + .14, 0), P(xx, wy + .14, h))
    return out


def fig2():
    b = [grid(-1, 12, -2, 12)]
    px = 5.5
    gl, gc = globe(px, -1.0)
    b.append(gl)
    b.append(path("hero-fig__path hero-fig__path--live", P(px, 10.0, .7), P(px, -.4, .7)))
    b.append(packet(px - .25, 0.9, .45))
    walls = [(2.2, "scam", "SCAM"), (5.0, "phishing", "PHISHING"), (7.8, "malware", "MALWARE")]
    x0, x1, h = 3.4, 7.6, 2.4
    for wy, _, _ in walls:
        b.append(shadow(x0, wy, x1 - x0, .14, .3))
        b.append(wall_y(x0, x1, wy, h))
        b.append(packet(px - .25, wy + .55, .45, bad=True))
        b.append(cross(P(px, wy + .8, 1.4)))
    # the lists' names last, over every wall, each at the top left of its own
    for wy, k, en in walls:
        t = P(x0 + .3, wy + .14, h - .55)
        b.append(label(t[0], t[1], k, en, "start", on=True))
    b.append(phone(px - .65, 10.3))
    d = P(px - .65, 10.3 + 2.2, 0)
    b.append(label(d[0] - 6, d[1] + 4, "device", "YOUR DEVICE", "end"))
    b.append(label(gc[0] + 28, gc[1] - 6, "website", "WEBSITE", "start"))
    m = P(x1, 7.94, 0)
    b.append(label(m[0] + 14, m[1] + 8, "lists", "BLOCKLISTS, COMBINED", "start", True))
    return drawing(b)


# ---------- FIG. 03: a fixed header is recognised at the checkpoint, a disguised packet is not ----------

def noisy(x, y):
    """Vessel's packet: a block with short strokes at random on two faces, nothing the same twice."""
    out = box(x, y, .6, .6, .6, .4)
    rnd = random.Random(int(x * 10 + y * 3))
    for _ in range(4):
        u, v = rnd.uniform(.08, .45), rnd.uniform(.55, .9)
        out += line("hero-fig__slot", P(x + u, y + .6, v), P(x + u + rnd.uniform(.06, .14), y + .6, v))
        u2, v2 = rnd.uniform(.08, .45), rnd.uniform(.55, .9)
        out += line("hero-fig__slot", P(x + .6, y + u2, v2), P(x + .6, y + u2 + rnd.uniform(.06, .14), v2))
    return out


def fig3():
    b = [grid(-1, 13, -2, 12)]
    xa, xb = 2.6, 7.4      # the two lanes, going up from your devices
    gy = 4.6               # the checkpoint across both lanes
    gl, gc = globe(xb, -1.2)
    b.append(gl)
    b.append(path("hero-fig__path hero-fig__path--live", P(xb, 9.6, .7), P(xb, -.6, .7)))
    b.append(path("hero-fig__path", P(xa, 9.6, .7), P(xa, gy + .3, .7)))
    b.append(noisy(xb - .3, 1.6))
    # the checkpoint: a line on the ground across both lanes
    b.append(path("hero-fig__scan hero-fig__scan--ground", P(xa - 1.2, gy + .2, 0), P(xb + 1.2, gy + .2, 0)))
    # a pyramid between the lanes, behind the line, with an eye above its tip; the scan comes from the eye
    tw = 1.5
    tx, ty = (xa + xb) / 2 - tw / 2 - 1.4, gy - 3.2
    apex = P(tx + tw / 2, ty + tw / 2, 2.4)
    ex, ey = apex[0], round(apex[1] - 12, 1)
    b.append(shadow(tx, ty, tw, tw, .3))
    b.append(poly("hero-fig__solid hero-fig__left", P(tx, ty + tw), P(tx + tw, ty + tw), apex))
    b.append(poly("hero-fig__solid hero-fig__right", P(tx + tw, ty), P(tx + tw, ty + tw), apex))
    # two beams over the pyramid, one on each lane, each sweeping to and fro about the eye (styles.css,
    # .hero-fig__sweep), and the eye over the beams
    for x, side in ((xa, "a"), (xb, "b")):
        b.append(path(f"hero-fig__scan hero-fig__sweep hero-fig__sweep--{side}", (ex, ey), P(x, gy + .2, .1)))
    b.append(f'<path class="hero-fig__solid hero-fig__top" d="M{ex - 10},{ey} Q{ex},{ey - 8.5} {ex + 10},{ey} Q{ex},{ey + 8.5} {ex - 10},{ey} Z"/>')
    b.append(f'<circle class="hero-fig__led" cx="{ex}" cy="{ey}" r="3.6"/>')
    b.append(f'<circle class="hero-fig__glint" cx="{ex + 1.2}" cy="{ey - 1.2}" r="1"/>')
    for k in (-1, 0, 1):
        b.append(path("hero-fig__slot", (ex + k * 7, ey - 10 - (0 if k else 2)), (ex + k * 9.5, ey - 14 - (0 if k else 3))))
    # lane A: the same header every time, stopped in front of the checkpoint
    pa = (xa - .3, gy + .7)
    b.append(box(pa[0], pa[1], .6, .6, .6, .4, "hero-fig__bad"))
    x, y = pa
    b.append(poly("hero-fig__header", P(x, y + .6, .78), P(x + .6, y + .6, .78), P(x + .6, y + .6, .9), P(x, y + .6, .9)))
    b.append(poly("hero-fig__header", P(x + .6, y, .78), P(x + .6, y + .6, .78), P(x + .6, y + .6, .9), P(x + .6, y, .9)))
    b.append(cross(P(xa + .55, gy + .9, 1.5), 5))
    b.append(noisy(xb - .3, 6.6))
    b.append(phone(xa - .65, 9.9))
    b.append(phone(xb - .65, 9.9))
    b.append(label(ex, ey - 34, "inspection", "TRAFFIC INSPECTION", "middle"))
    la = P(xa, 9.9 + 2.2, 0)
    b.append(label(la[0] + 6, la[1] + 22, "plain", "PLAIN VPN", "middle"))
    lb = P(xb, 9.9 + 2.2, 0)
    b.append(label(lb[0] + 6, lb[1] + 22, "vessel", "AMNEZIAWG", "middle"))
    ha = P(pa[0], pa[1] + .6, .5)
    b.append(label(ha[0] - 10, ha[1] + 6, "fixed", "FIXED HEADER", "end", True))
    hb = P(xb + .3, 1.6 + .6, .7)
    b.append(label(hb[0] + 12, hb[1] + 4, "ordinary", "ORDINARY TRAFFIC", "start", True))
    b.append(label(gc[0] + 28, gc[1] - 6, "internet", "INTERNET", "start"))
    return drawing(b)


# ---------- FIG. 04: a direct connection and one through the Taipei entry reach the same node, the same exit ----------

def fig4():
    b = [grid(-1, 12, -2, 11)]
    gl, gc = globe(7.0, -1.8)
    b.append(gl)
    nx, ny = 3.2, 0.4                       # the node, at the top
    pxp, pyp = 1.6, 8.0                     # your device, at the bottom
    rx, ry = 6.0, 5.2                       # the Taipei entry, to the right on the way up
    dev = (pxp + .65, pyp)
    b.append(path("hero-fig__path hero-fig__path--live", P(nx + 1.6, ny + .5, 1.6), P(7.0, -1.5, 1.0)))
    # straight up to the node
    b.append(path("hero-fig__path", P(dev[0], dev[1], .3), P(nx + .5, ny + 1.6, .3)))
    # to the entry, then on to the same node
    b.append(path("hero-fig__path hero-fig__path--live", P(dev[0] + .3, dev[1], .3), P(rx, ry + .9, .3)))
    b.append(path("hero-fig__path hero-fig__path--live", P(rx + .4, ry, .3), P(nx + 1.4, ny + 1.4, .3)))
    b.append(tower(nx, ny))
    b.append(router(rx, ry))
    b.append(phone(pxp, pyp))
    b.append(packet(2.25, 5.2, .3))
    b.append(packet(4.9, 3.2, .3))
    nt = P(nx, ny + 1.6, 2.6)
    b.append(label(nt[0] - 10, nt[1] - 2, "node", "NODE · SIN", "end"))
    b.append(label(nt[0] - 10, nt[1] + 24, "exit", "SAME EXIT", "end", True))
    rt = P(rx + 1.8, ry, .55)
    b.append(label(rt[0] + 10, rt[1] + 4, "entry", "TAIPEI ENTRY", "start"))
    b.append(label(rt[0] + 10, rt[1] + 30, "forward", "FORWARD ONLY", "start", True))
    dm = P(dev[0], 5.0, .3)
    b.append(label(dm[0] - 14, dm[1] + 4, "direct", "DIRECT", "end", True))
    rm = P(4.2, 7.0, .3)
    b.append(label(rm[0] + 6, rm[1] + 20, "relayed", "RELAYED", "start", True))
    d = P(pxp + .65, pyp + 2.2, 0)
    b.append(label(d[0] + 4, d[1] + 22, "device", "YOUR DEVICE", "middle"))
    b.append(label(gc[0] + 28, gc[1] - 6, "internet", "INTERNET", "start"))
    settle(b)
    return drawing(b)


# ---------- FIG. 05: the keys are made on your device; only the public key goes to the portal and the node ----------

def fig5():
    b = [grid(-1, 12, -2, 11)]
    pxp, pyp = 1.4, 8.4       # your device, at the bottom
    sx, sy = 2.6, 4.0         # the portal, on the way up
    nx, ny = 3.6, -0.6        # the node, at the top
    b.append(path("hero-fig__path", P(pxp + .65, pyp, .3), P(sx + .9, sy + 1.3, .3)))
    b.append(path("hero-fig__path", P(sx + 1.0, sy, .3), P(nx + .8, ny + 1.6, .3)))
    b.append(tower(nx, ny))
    # the portal: a low server
    b.append(shadow(sx, sy, 2.0, 1.3, .35) + box(sx, sy, 2.0, 1.3, 1.0))
    for k in (1, 2):
        z = 1.0 * k / 3
        b.append(line("hero-fig__slot", P(sx + .25, sy + 1.3, z), P(sx + 2.0 - .25, sy + 1.3, z)))
        b.append(line("hero-fig__slot", P(sx + 2.0, sy + .2, z), P(sx + 2.0, sy + 1.1, z)))
    b.append(phone(pxp, pyp))
    # the private key stands over the device, over a dashed outline: it never leaves
    cxk, cyk = pxp + .2, pyp + .8
    b.append(poly("hero-fig__case", P(cxk - .5, cyk - .5, 1.1), P(cxk + 1.8, cyk - .5, 1.1), P(cxk + 1.8, cyk + .6, 1.1), P(cxk - .5, cyk + .6, 1.1)))
    b.append(key(cxk, cyk, 1.45, "hero-fig__key--private"))
    # the public key on its way up, to the portal and on to the node
    b.append(key(1.85, 6.5, .75, "hero-fig__key--public"))
    b.append(key(3.4, 2.0, .75, "hero-fig__key--public"))
    pk = P(cxk + .55, cyk, 1.45 + .4)
    b.append(label(pk[0], pk[1] - 18, "private", "PRIVATE KEY", "middle", True))
    pu = P(1.85, 6.5, .55)
    b.append(label(pu[0] + 20, pu[1] + 14, "public", "PUBLIC KEY", "start", True))
    st = P(sx, sy, 1.0)
    b.append(label(st[0] - 6, st[1] - 16, "portal", "PORTAL", "end"))
    sr = P(sx + 2.0, sy + 1.3, 0)
    b.append(label(sr[0] + 10, sr[1] + 2, "noemail", "NO EMAIL", "start", True))
    ntt = P(nx, ny + 1.6, 2.6)
    b.append(label(ntt[0] - 10, ntt[1] + 4, "nodek", "NODE", "end"))
    d = P(pxp + .65, pyp + 2.2, 0)
    b.append(label(d[0] + 4, d[1] + 22, "device", "YOUR DEVICE", "middle"))
    settle(b)
    return drawing(b)


HEADER = """// The pictures under 使用情境 (Vessel 的做法), in the same isometric drawing as the first
// (hero-figure-data.ts): the shapes as SVG markup worked out once, the labels as positions the page fills with words in
// the page's language (pages/hero-figure.tsx). The markup is ours and fixed; nothing a visitor sends goes into it.
// Written by web/scripts/hero-figures.py: change the drawing there and run it, not here.
//   FIG. 02  a lookup goes up from your device through three walls, the blocklists; each stops what it knows
//   FIG. 03  two lanes past a traffic checkpoint, a pyramid with an eye above its tip scanning a line across them: a plain VPN's packet with the same header every time is
//            stopped, Vessel's (AmneziaWG) has nothing steady on it and goes on to the internet
//   FIG. 04  your device to a node two ways, straight and through the Taipei entry, which only forwards; the same exit
//   FIG. 05  the key pair made on your device: the private key stays there, only the public key goes to the portal and the node

export interface Label { key: string; x: number; y: number; anchor: "start" | "middle" | "end"; note: boolean; on: boolean; en: string }
export interface Drawing { viewBox: string; shapes: string; labels: Label[] }
"""


def main() -> None:
    figures = [("LISTS", fig2()), ("DISGUISE", fig3()), ("RELAY", fig4()), ("KEYS", fig5())]
    text = HEADER + "".join(f"\nexport const {name}: Drawing = {json.dumps(d, ensure_ascii=False)};\n" for name, d in figures)
    if "--check" in sys.argv[1:]:
        if OUT.read_text() != text:
            sys.exit(f"{OUT.relative_to(WEB.parent)} is not what web/scripts/hero-figures.py draws: run it and commit the result")
        return
    OUT.write_text(text)


if __name__ == "__main__":
    main()
