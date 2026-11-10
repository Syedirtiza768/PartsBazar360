"""Build the PartsBazar360 identity from one geometric source.

    python assets/brand/partsbazar360/source/build_identity.py

Writes vector masters (SVG in RGB; PDF and EPS in CMYK), the five concept
marks, the construction drawing, and the inline SVG defs used by the brand
presentation. Raster exports (PNG, WebP, ICO, app icons, QA sheets) come from
render_assets.cjs, which reads the SVGs written here.

Wordmarks are outlined from the variable fonts the buyer app already ships
(Roboto Condensed, Inter), kerned from each font's GPOS `kern` feature, so no
master depends on an installed font.
"""
import json
import math
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
REPO = PKG.parents[2]
FONTS = REPO / "apps" / "buyer-marketplace" / "app" / "fonts"

SQ3 = math.sqrt(3)

# --------------------------------------------------------------------------
# Palette. RGB from packages/ui/tailwind-preset.cjs. CMYK values are starting
# builds for coated stock; they must be proofed before production.
# --------------------------------------------------------------------------
PALETTE = {
    "petrol": {"hex": "#116b6b", "cmyk": (0.90, 0.30, 0.50, 0.25)},
    "petrol_light": {"hex": "#3ba49f", "cmyk": (0.75, 0.10, 0.42, 0.0)},
    "graphite": {"hex": "#0d1519", "cmyk": (0.70, 0.55, 0.45, 0.85)},
    "canvas": {"hex": "#f4f2ed", "cmyk": (0.02, 0.02, 0.05, 0.0)},
    "signal": {"hex": "#f36b21", "cmyk": (0.0, 0.70, 0.95, 0.0)},
    "black": {"hex": "#000000", "cmyk": (0.0, 0.0, 0.0, 1.0)},
    "white": {"hex": "#ffffff", "cmyk": (0.0, 0.0, 0.0, 0.0)},
}

# Colourways map shape roles to palette keys.
COLORWAYS = {
    "fullcolor": {"symbol": "petrol", "word": "graphite", "num": "petrol"},
    "reversed": {"symbol": "petrol_light", "word": "canvas", "num": "petrol_light"},
    "mono-black": {"symbol": "black", "word": "black", "num": "black"},
    "mono-white": {"symbol": "white", "word": "white", "num": "white"},
}


# --------------------------------------------------------------------------
# Geometry primitives. A shape is a list of subpaths; a subpath is a list of
# segments: ("M", p) ("L", p) ("C", c1, c2, p) ("Z",). Coordinates are y-down.
# --------------------------------------------------------------------------
class Shape:
    def __init__(self, subpaths, role, rule="nonzero"):
        self.subpaths = subpaths
        self.role = role
        self.rule = rule

    def mapped(self, fn):
        out = []
        for sp in self.subpaths:
            nsp = []
            for seg in sp:
                if seg[0] == "Z":
                    nsp.append(seg)
                else:
                    nsp.append((seg[0],) + tuple(fn(p) for p in seg[1:]))
            out.append(nsp)
        return Shape(out, self.role, self.rule)


def poly(points):
    sp = [("M", points[0])] + [("L", p) for p in points[1:]] + [("Z",)]
    return sp


def circle(cx, cy, r):
    k = 0.5522847498 * r
    return [
        ("M", (cx + r, cy)),
        ("C", (cx + r, cy + k), (cx + k, cy + r), (cx, cy + r)),
        ("C", (cx - k, cy + r), (cx - r, cy + k), (cx - r, cy)),
        ("C", (cx - r, cy - k), (cx - k, cy - r), (cx, cy - r)),
        ("C", (cx + k, cy - r), (cx + r, cy - k), (cx + r, cy)),
        ("Z",),
    ]


def transform(shapes, s=1.0, tx=0.0, ty=0.0):
    return [sh.mapped(lambda p: (p[0] * s + tx, p[1] * s + ty)) for sh in shapes]


def bbox(shapes):
    xs, ys = [], []
    for sh in shapes:
        for sp in sh.subpaths:
            for seg in sp:
                for p in seg[1:]:
                    xs.append(p[0])
                    ys.append(p[1])
    return min(xs), min(ys), max(xs), max(ys)


def hex_points(cx, cy, r):
    """Pointy-top hexagon: top, upper-right, lower-right, bottom, lower-left, upper-left."""
    w = r * SQ3 / 2
    return [
        (cx, cy - r),
        (cx + w, cy - r / 2),
        (cx + w, cy + r / 2),
        (cx, cy + r),
        (cx - w, cy + r / 2),
        (cx - w, cy - r / 2),
    ]


# --------------------------------------------------------------------------
# Fonts: outline + GPOS kerning.
# --------------------------------------------------------------------------
class SegPen(BasePen):
    def __init__(self, glyph_set, xf):
        super().__init__(glyph_set)
        self.xf = xf
        self.subpaths = []

    def _moveTo(self, p):
        self.cur = [("M", self.xf(p))]
        self.subpaths.append(self.cur)

    def _lineTo(self, p):
        self.cur.append(("L", self.xf(p)))

    def _curveToOne(self, p1, p2, p3):
        self.cur.append(("C", self.xf(p1), self.xf(p2), self.xf(p3)))

    def _qCurveToOne(self, p1, p2):
        p0 = self._getCurrentPoint()
        c1 = (p0[0] + 2 / 3 * (p1[0] - p0[0]), p0[1] + 2 / 3 * (p1[1] - p0[1]))
        c2 = (p2[0] + 2 / 3 * (p1[0] - p2[0]), p2[1] + 2 / 3 * (p1[1] - p2[1]))
        self.cur.append(("C", self.xf(c1), self.xf(c2), self.xf(p2)))

    def _closePath(self):
        self.cur.append(("Z",))

    def _endPath(self):
        self.cur.append(("Z",))


class Face:
    _cache = {}

    def __new__(cls, filename, wght):
        key = (filename, wght)
        if key not in cls._cache:
            obj = super().__new__(cls)
            obj._load(filename, wght)
            cls._cache[key] = obj
        return cls._cache[key]

    def _load(self, filename, wght):
        tt = TTFont(FONTS / filename)
        loc = {a.axisTag: a.defaultValue for a in tt["fvar"].axes}
        loc["wght"] = wght
        tt = instancer.instantiateVariableFont(tt, loc)
        self.gs = tt.getGlyphSet()
        self.cmap = tt.getBestCmap()
        self.hmtx = tt["hmtx"]
        self.upm = tt["head"].unitsPerEm
        self.cap = tt["OS/2"].sCapHeight
        self.subs = []
        gpos = tt["GPOS"].table
        idxs = set()
        for fr in gpos.FeatureList.FeatureRecord:
            if fr.FeatureTag == "kern":
                idxs.update(fr.Feature.LookupListIndex)
        for i in sorted(idxs):
            lk = gpos.LookupList.Lookup[i]
            for st in lk.SubTable:
                t = lk.LookupType
                if t == 9:
                    t, st = st.ExtensionLookupType, st.ExtSubTable
                if t == 2:
                    self.subs.append(st)

    def kern(self, a, b):
        for st in self.subs:
            cov = st.Coverage.glyphs
            if a not in cov:
                continue
            if st.Format == 1:
                for rec in st.PairSet[cov.index(a)].PairValueRecord:
                    if rec.SecondGlyph == b:
                        return getattr(rec.Value1, "XAdvance", 0) or 0
            elif st.Format == 2:
                c1 = st.ClassDef1.classDefs.get(a, 0)
                c2 = st.ClassDef2.classDefs.get(b, 0)
                v = getattr(st.Class1Record[c1].Class2Record[c2].Value1, "XAdvance", 0) or 0
                if v:
                    return v
        return 0

    def ink(self, name):
        bp = BoundsPen(self.gs)
        self.gs[name].draw(bp)
        return bp.bounds

    def set(self, text, x, baseline, cap_height, tracking=0.0, pairs=None):
        """Outline `text` with its ink starting at x. Returns ([(char, subpaths)], width)."""
        s = cap_height / self.cap
        names = [self.cmap[ord(c)] for c in text]
        pos, pen = [], 0.0
        for i, n in enumerate(names):
            pos.append(pen)
            if i + 1 < len(names):
                adj = (pairs or {}).get(text[i : i + 2], 0.0)
                pen += self.hmtx[n][0] + self.kern(n, names[i + 1]) + (tracking + adj) * self.upm
        left = pos[0] + self.ink(names[0])[0]
        right = pos[-1] + self.ink(names[-1])[2]
        ox = x - left * s
        out = []
        for i, n in enumerate(names):
            dx = ox + pos[i] * s
            pen_ = SegPen(self.gs, lambda p, dx=dx: (dx + p[0] * s, baseline - p[1] * s))
            self.gs[n].draw(pen_)
            out.append((text[i], pen_.subpaths))
        return out, (right - left) * s


def word_shapes(glyphs, split_at, roles=("word", "num")):
    a = [sp for _, sps in glyphs[:split_at] for sp in sps]
    b = [sp for _, sps in glyphs[split_at:] for sp in sps]
    shapes = [Shape(a, roles[0])]
    if b:
        shapes.append(Shape(b, roles[1]))
    return shapes


# --------------------------------------------------------------------------
# MASTER SYMBOL: the hex P.
# A pointy-top hexagon ring is the bowl; its left vertical edge continues
# down as the stem. Six sides x 60 degrees = one full turn (360) of a nut.
# The counter is a hexagonal bore, concentric with the bowl, and its left
# edge lines up exactly with the stem's inner edge.
# --------------------------------------------------------------------------
SYM_H = 92.0  # chosen over 100 in the refinement study: tighter, more compact P
R = 31.0  # bowl circumradius
T = 16.0  # stroke (perpendicular ring thickness = stem width)
FOOT = "hexcut"  # stem terminal cut parallel to the bowl's lower-right edge (30 degrees): a hex-key end


def master_geometry():
    cx, cy = R * SQ3 / 2, R
    r = R - T / (SQ3 / 2)
    top, ur, lr, b, ll, ul = hex_points(cx, cy, R)
    j = (T, ll[1] + T / SQ3)  # stem's inner edge meets the lower-left bowl edge
    if FOOT == "hexcut":
        foot = [(T, SYM_H - T / SQ3), (0.0, SYM_H)]
    else:
        foot = [(T, SYM_H), (0.0, SYM_H)]
    outer = [top, ur, lr, b, j] + foot + [ul]
    inner = hex_points(cx, cy, r)
    return {
        "cx": cx,
        "cy": cy,
        "R": R,
        "r": r,
        "T": T,
        "W": R * SQ3,
        "H": SYM_H,
        "outer": outer,
        "inner": inner,
        "shoulder": ul[1],
        "base": b[1],
        "counter_w": r * SQ3,
        "counter_h": 2 * r,
    }


G = master_geometry()


def master_symbol(role="symbol"):
    return [Shape([poly(G["outer"]), poly(G["inner"][::-1])], role, "evenodd")]


# Wordmark: Roboto Condensed Bold, the display face of the buyer app.
WORD_FACE = ("RobotoCondensed-latin-var.woff2", 720)
WORD_TRACK = 0.0
WORD_PAIRS = {"r3": 0.012}  # a little air before the numerals
CAP = G["base"] - G["shoulder"]  # cap height = hexagon shoulder to hexagon base
GAP = G["counter_w"]  # symbol-to-wordmark gap = counter width


def master_wordmark(x, baseline, cap=CAP, face=WORD_FACE, tracking=WORD_TRACK):
    glyphs, width = Face(*face).set("PartsBazar360", x, baseline, cap, tracking, WORD_PAIRS)
    return word_shapes(glyphs, 10), width


def lockup_horizontal(face=WORD_FACE, tracking=WORD_TRACK):
    words, ww = master_wordmark(G["W"] + GAP, G["base"], face=face, tracking=tracking)
    return master_symbol() + words


def lockup_stacked():
    words, ww = master_wordmark(0, 0)
    sym_h = 4.4 * CAP  # symbol width lands near 30% of the wordmark width
    s = sym_h / SYM_H
    sym = transform(master_symbol(), s, (ww - G["W"] * s) / 2, 0)
    gap = G["counter_h"] * s * 0.8
    words = transform(words, 1, 0, sym_h + gap + CAP)
    return sym + words


def wordmark_only():
    words, _ = master_wordmark(0, CAP)
    return words


def production_horizontal():
    # Embroidery / engraving: heavier wordmark, opened tracking.
    return lockup_horizontal(("RobotoCondensed-latin-var.woff2", 820), 0.025)


# --------------------------------------------------------------------------
# Micro symbol, hand-tuned on a 16 px grid: pixel-aligned stem and counter.
# --------------------------------------------------------------------------
def rrect(x, y, w, h, r):
    k = 0.5522847498 * r
    return [
        ("M", (x + r, y)),
        ("L", (x + w - r, y)),
        ("C", (x + w - r + k, y), (x + w, y + r - k), (x + w, y + r)),
        ("L", (x + w, y + h - r)),
        ("C", (x + w, y + h - r + k), (x + w - r + k, y + h), (x + w - r, y + h)),
        ("L", (x + r, y + h)),
        ("C", (x + r - k, y + h), (x, y + h - r + k), (x, y + h - r)),
        ("L", (x, y + r)),
        ("C", (x, y + r - k), (x + r - k, y), (x + r, y)),
        ("Z",),
    ]


def micro16_shapes():
    # Optical changes from the master: the P fills more of the tile, and the
    # counter is a pixel-aligned 2 x 3.5 px slot because a 2 px hexagon blurs shut.
    outer = [(8, 1.5), (12, 4), (12, 9), (8, 11.5), (7, 10.875), (7, 13.0), (4, 14.75), (4, 4)]
    inner = [(7, 5), (9, 5), (9, 8.5), (7, 8.5)]
    return [
        Shape([rrect(0, 0, 16, 16, 3.5)], "tile"),
        Shape([poly(outer), poly(inner[::-1])], "symbol", "evenodd"),
    ]


# --------------------------------------------------------------------------
# Emitters
# --------------------------------------------------------------------------
def fmt(v):
    t = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if t in ("-0", "") else t


def svg_d(subpaths):
    out = []
    for sp in subpaths:
        for seg in sp:
            op = seg[0]
            if op == "Z":
                out.append("Z")
            else:
                out.append(op + " ".join(f"{fmt(p[0])} {fmt(p[1])}" for p in seg[1:]))
    return "".join(out)


def svg_doc(shapes, colors, title, pad=0.0, bg=None, rx=0.0, box=None):
    x0, y0, x1, y1 = box or bbox(shapes)
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    w, h = x1 - x0, y1 - y0
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{fmt(x0)} {fmt(y0)} {fmt(w)} {fmt(h)}" role="img">',
        f"  <title>{title}</title>",
    ]
    if bg:
        parts.append(
            f'  <rect x="{fmt(x0)}" y="{fmt(y0)}" width="{fmt(w)}" height="{fmt(h)}"'
            + (f' rx="{fmt(rx)}"' if rx else "")
            + f' fill="{PALETTE[bg]["hex"]}"/>'
        )
    for sh in shapes:
        rule = ' fill-rule="evenodd"' if sh.rule == "evenodd" else ""
        parts.append(f'  <path fill="{PALETTE[colors[sh.role]]["hex"]}"{rule} d="{svg_d(sh.subpaths)}"/>')
    parts.append("</svg>\n")
    return "\n".join(parts)


def _ops(shapes, colors, x0, y1, mode):
    """PostScript-style drawing ops; y flipped so the artwork's top is y1."""
    lines = []
    for sh in shapes:
        c, m, y, k = PALETTE[colors[sh.role]]["cmyk"]
        lines.append(f"{fmt(c)} {fmt(m)} {fmt(y)} {fmt(k)} " + ("k" if mode == "pdf" else "setcmykcolor"))
        if mode == "eps":
            lines.append("newpath")
        for sp in sh.subpaths:
            for seg in sp:
                pts = [(p[0] - x0, y1 - p[1]) for p in seg[1:]]
                coords = " ".join(f"{fmt(px)} {fmt(py)}" for px, py in pts)
                if seg[0] == "M":
                    lines.append(coords + (" m" if mode == "pdf" else " moveto"))
                elif seg[0] == "L":
                    lines.append(coords + (" l" if mode == "pdf" else " lineto"))
                elif seg[0] == "C":
                    lines.append(coords + (" c" if mode == "pdf" else " curveto"))
                else:
                    lines.append("h" if mode == "pdf" else "closepath")
        if mode == "pdf":
            lines.append("f*" if sh.rule == "evenodd" else "f")
        else:
            lines.append("eofill" if sh.rule == "evenodd" else "fill")
    return "\n".join(lines)


def pdf_doc(shapes, colors, title):
    x0, y0, x1, y1 = bbox(shapes)
    w, h = x1 - x0, y1 - y0
    content = _ops(shapes, colors, x0, y1, "pdf").encode("ascii")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {fmt(w)} {fmt(h)}] "
            f"/TrimBox [0 0 {fmt(w)} {fmt(h)}] /Contents 4 0 R /Resources << >> >>"
        ).encode("ascii"),
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
        f"<< /Title ({title}) /Creator (PartsBazar360 build_identity.py) >>".encode("ascii"),
    ]
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def eps_doc(shapes, colors, title):
    x0, y0, x1, y1 = bbox(shapes)
    w, h = x1 - x0, y1 - y0
    return (
        "%!PS-Adobe-3.0 EPSF-3.0\n"
        f"%%BoundingBox: 0 0 {math.ceil(w)} {math.ceil(h)}\n"
        f"%%HiResBoundingBox: 0 0 {fmt(w)} {fmt(h)}\n"
        f"%%Title: {title}\n"
        "%%Creator: PartsBazar360 build_identity.py\n"
        "%%LanguageLevel: 2\n"
        "%%Pages: 1\n"
        "%%EndComments\n"
        "gsave\n" + _ops(shapes, colors, x0, y1, "eps") + "\ngrestore\nshowpage\n%%EOF\n"
    )


# --------------------------------------------------------------------------
# Concepts (exploration territories). All drawn at symbol height 100.
# --------------------------------------------------------------------------
def line_x(n1, d1, n2, d2):
    det = n1[0] * n2[1] - n1[1] * n2[0]
    return ((d1 * n2[1] - d2 * n1[1]) / det, (n1[0] * d2 - n2[0] * d1) / det)


def concept_fit_frame():
    s = 100 / 64
    brackets = [
        poly([(0, 0), (18, 0), (18, 6), (6, 6), (6, 18), (0, 18)]),
        poly([(64, 0), (46, 0), (46, 6), (58, 6), (58, 18), (64, 18)]),
        poly([(64, 64), (46, 64), (46, 58), (58, 58), (58, 46), (64, 46)]),
        poly([(0, 64), (18, 64), (18, 58), (6, 58), (6, 46), (0, 46)]),
    ]
    nut = [poly(hex_points(32, 32, 17)), circle(32, 32, 6.5)]
    sym = transform([Shape(brackets, "ink"), Shape(nut, "symbol", "evenodd")], s)
    glyphs, _ = Face("RobotoCondensed-latin-var.woff2", 900).set("PARTSBAZAR360", 128, 76.5, 53, 0.02)
    return sym, word_shapes(glyphs, 10)


def _clip(subject, clipper):
    """Sutherland-Hodgman: subject polygon clipped by a convex clockwise-in-svg polygon."""

    def inside(p, a, b):
        return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0

    def inter(p, q, a, b):
        x1, y1, x2, y2 = p[0], p[1], q[0], q[1]
        x3, y3, x4, y4 = a[0], a[1], b[0], b[1]
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

    out = subject
    for i in range(len(clipper)):
        a, b = clipper[i], clipper[(i + 1) % len(clipper)]
        inp, out = out, []
        for j in range(len(inp)):
            p, q = inp[j], inp[(j + 1) % len(inp)]
            if inside(q, a, b):
                if not inside(p, a, b):
                    out.append(inter(p, q, a, b))
                out.append(q)
            elif inside(p, a, b):
                out.append(inter(p, q, a, b))
    return out


def concept_exchange():
    rr, t = 40.0, 11.0
    ri = rr - t / (SQ3 / 2)
    a_o, a_i = hex_points(36, 50, rr), hex_points(36, 50, ri)
    b_o, b_i = hex_points(84, 50, rr), hex_points(84, 50, ri)
    lens = _clip(a_o, b_o)  # where buyer and seller overlap: the verified part
    sym = [
        Shape([poly(lens)], "accent"),
        Shape([poly(a_o), poly(a_i[::-1])], "ink", "evenodd"),
        Shape([poly(b_o), poly(b_i[::-1])], "symbol", "evenodd"),
    ]
    glyphs, _ = Face("Inter-latin-var.woff2", 700).set("PartsBazar360", 148, 69, 38, -0.01)
    return sym, word_shapes(glyphs, 10)


def concept_full_turn():
    c, rr, t, g = (50.0, 50.0), 50.0, 17.0, 3.2
    a = rr * SQ3 / 2
    normals = [(math.cos(math.radians(60 * k)), math.sin(math.radians(60 * k))) for k in range(6)]
    bars = []
    for k in range(6):
        nk, np_, nn = normals[k], normals[k - 1], normals[(k + 1) % 6]
        o = line_x(np_, a, nk, a)
        bpt = line_x(nk, a - t, np_, a)
        cpt = line_x(nk, a - t, nn, a - t - g)
        dpt = line_x(nk, a, nn, a - t - g)
        pts = [(c[0] + p[0], c[1] - p[1]) for p in (o, dpt, cpt, bpt)]
        bars.append(poly(pts))
    sym = [Shape(bars, "symbol")]
    glyphs, _ = Face("Inter-latin-var.woff2", 600).set("partsbazar360", 128, 62, 34, -0.015)
    return sym, word_shapes(glyphs, 10)


def concept_hex_p():
    words, _ = master_wordmark(G["W"] + GAP, G["base"])
    return master_symbol(), words


def concept_ledger_tag():
    tag = [(20, 0), (112, 0), (112, 64), (20, 64), (0, 44), (0, 20)]
    hole = circle(17, 32, 6)
    digits, dw = Face("Inter-latin-var.woff2", 800).set("360", 33, 44.5, 25, 0.0)
    knock = [sp for _, sps in digits for sp in sps]
    tag_shape = Shape([poly(tag), hole] + knock, "symbol", "evenodd")
    sym = transform([tag_shape], 1, 0, 18)
    glyphs, _ = Face("Inter-latin-var.woff2", 800).set("PartsBazar", 134, 68, 36, -0.02)
    return sym, word_shapes(glyphs, 10)


CONCEPTS = [
    ("c1-fit-frame", "Fit Frame", concept_fit_frame),
    ("c2-exchange", "Exchange", concept_exchange),
    ("c3-full-turn", "Full Turn", concept_full_turn),
    ("c4-hex-p", "Hex P", concept_hex_p),
    ("c5-ledger-tag", "Ledger Tag", concept_ledger_tag),
]
CONCEPT_COLORS = {"symbol": "petrol", "ink": "graphite", "accent": "petrol_light", "word": "graphite", "num": "petrol"}


# --------------------------------------------------------------------------
# Construction drawing (presentation + standards).
# --------------------------------------------------------------------------
def construction_svg():
    m = 26
    W, H = G["W"], G["H"]
    vb = f"{-m} {-m} {fmt(W + 2 * m + 70)} {fmt(H + 2 * m)}"
    cx, cy = G["cx"], G["cy"]
    sym = svg_d(master_symbol()[0].subpaths)
    outer_hex = " ".join(f"{fmt(x)},{fmt(y)}" for x, y in hex_points(cx, cy, G["R"]))
    inner_hex = " ".join(f"{fmt(x)},{fmt(y)}" for x, y in G["inner"])
    s = G["shoulder"]
    b = G["base"]
    lab = 'font-family="ui-monospace,Menlo,Consolas,monospace" font-size="4.2" fill="currentColor"'
    guide = 'stroke="currentColor" stroke-width="0.35" fill="none"'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" class="construction">
  <title>Hex P construction</title>
  <path d="{sym}" fill-rule="evenodd" style="fill:var(--accent)" opacity="0.18"/>
  <circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(G['R'])}" {guide} stroke-dasharray="1.2 1.2"/>
  <polygon points="{outer_hex}" {guide}/>
  <polygon points="{inner_hex}" {guide}/>
  <circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="0.9" fill="currentColor"/>
  <line x1="{-m + 4}" y1="{fmt(s)}" x2="{fmt(W + 60)}" y2="{fmt(s)}" {guide} stroke-dasharray="2 1.5"/>
  <line x1="{-m + 4}" y1="{fmt(b)}" x2="{fmt(W + 60)}" y2="{fmt(b)}" {guide} stroke-dasharray="2 1.5"/>
  <line x1="{-m + 4}" y1="0" x2="{fmt(W + 60)}" y2="0" {guide} stroke-dasharray="0.6 1.4"/>
  <line x1="{-m + 4}" y1="{fmt(H)}" x2="{fmt(W + 60)}" y2="{fmt(H)}" {guide} stroke-dasharray="0.6 1.4"/>
  <line x1="{fmt(T)}" y1="{fmt(-m + 6)}" x2="{fmt(T)}" y2="{fmt(H + m - 6)}" {guide} stroke-dasharray="2 1.5"/>
  <line x1="{fmt(cx)}" y1="{fmt(cy)}" x2="{fmt(cx + G['R'] * SQ3 / 2)}" y2="{fmt(cy - G['R'] / 2)}" {guide}/>
  <text x="{fmt(cx + 6)}" y="{fmt(cy - 9)}" {lab}>R</text>
  <text x="{fmt(W + 8)}" y="{fmt(s - 1.5)}" {lab}>shoulder · cap height top</text>
  <text x="{fmt(W + 8)}" y="{fmt(b - 1.5)}" {lab}>base · wordmark baseline</text>
  <text x="{fmt(W + 8)}" y="-1.5" {lab}>apex</text>
  <text x="{fmt(W + 8)}" y="{fmt(H - 1.5)}" {lab}>stem foot</text>
  <text x="{fmt(T + 1.5)}" y="{fmt(H + m - 8)}" {lab}>stem = counter edge</text>
  <text x="{fmt(-m + 4)}" y="{fmt((s + b) / 2 + 1.5)}" {lab}>1.5R</text>
</svg>
"""


# --------------------------------------------------------------------------
# Inline defs for the presentation: <symbol>s whose fills read CSS custom
# properties, so one definition renders every colourway.
# --------------------------------------------------------------------------
ROLE_VARS = {
    "symbol": "var(--logo-symbol, #116b6b)",
    "word": "var(--logo-word, #0d1519)",
    "num": "var(--logo-num, #116b6b)",
    "ink": "var(--logo-word, #0d1519)",
    "accent": "var(--logo-accent2, #3ba49f)",
    "tile": "var(--logo-tile, #116b6b)",
}


def symbol_def(sid, shapes, pad=0.0):
    x0, y0, x1, y1 = bbox(shapes)
    vb = f"{fmt(x0 - pad)} {fmt(y0 - pad)} {fmt(x1 - x0 + 2 * pad)} {fmt(y1 - y0 + 2 * pad)}"
    paths = "".join(
        f'<path style="fill:{ROLE_VARS[sh.role]}"'
        + (' fill-rule="evenodd"' if sh.rule == "evenodd" else "")
        + f' d="{svg_d(sh.subpaths)}"/>'
        for sh in shapes
    )
    return f'<symbol id="{sid}" viewBox="{vb}">{paths}</symbol>', (x1 - x0 + 2 * pad) / (y1 - y0 + 2 * pad)


def main():
    out_svg, out_pdf, out_eps = PKG / "svg", PKG / "pdf", PKG / "eps"
    out_concepts, out_pres = PKG / "concepts", PKG / "presentation"
    for d in (out_svg, out_pdf, out_eps, out_concepts, out_pres):
        d.mkdir(parents=True, exist_ok=True)

    layouts = {
        "horizontal": lockup_horizontal(),
        "stacked": lockup_stacked(),
        "symbol": master_symbol(),
        "wordmark": wordmark_only(),
    }
    manifest = {"vector": [], "concepts": []}
    for layout, shapes in layouts.items():
        for cw, colors in COLORWAYS.items():
            stem = f"partsbazar360_{layout}_{cw}"
            title = f"PartsBazar360 {layout} {cw}"
            (out_svg / f"{stem}.svg").write_text(svg_doc(shapes, colors, title), encoding="utf-8", newline="\n")
            (out_pdf / f"{stem}.pdf").write_bytes(pdf_doc(shapes, colors, title))
            (out_eps / f"{stem}.eps").write_text(eps_doc(shapes, colors, title), encoding="ascii", newline="\n")
            manifest["vector"].append(stem)

    prod = production_horizontal()
    for cw in ("mono-black", "mono-white"):
        stem = f"partsbazar360_production-horizontal_{cw}"
        title = f"PartsBazar360 production {cw}"
        (out_svg / f"{stem}.svg").write_text(svg_doc(prod, COLORWAYS[cw], title), encoding="utf-8", newline="\n")
        (out_pdf / f"{stem}.pdf").write_bytes(pdf_doc(prod, COLORWAYS[cw], title))
        (out_eps / f"{stem}.eps").write_text(eps_doc(prod, COLORWAYS[cw], title), encoding="ascii", newline="\n")
        manifest["vector"].append(stem)

    # Contrast-safe plate for photography: full-colour lockup on a canvas plate,
    # padded by the clear space (X = counter height).
    horiz = layouts["horizontal"]
    plate = svg_doc(horiz, COLORWAYS["fullcolor"], "PartsBazar360 horizontal on plate", pad=G["counter_h"], bg="canvas")
    (out_svg / "partsbazar360_horizontal_plate.svg").write_text(plate, encoding="utf-8", newline="\n")

    # App icons. Web tile (rounded), full-bleed square (iOS / store), maskable.
    sym = master_symbol()

    def tile(size_frac, rx, name, title, nudge=(0.0, 0.0)):
        h = 64 * size_frac
        s = h / SYM_H
        w = G["W"] * s
        shapes = transform(sym, s, (64 - w) / 2 + nudge[0], (64 - h) / 2 + nudge[1])
        doc = svg_doc(shapes, {"symbol": "canvas"}, title, bg="petrol", rx=rx, box=(0, 0, 64, 64))
        (out_svg / name).write_text(doc, encoding="utf-8", newline="\n")

    tile(0.62, 14, "partsbazar360_appicon_rounded.svg", "PartsBazar360 app icon", (0.6, 0.0))
    tile(0.62, 0, "partsbazar360_appicon_square.svg", "PartsBazar360 app icon (full bleed)", (0.6, 0.0))
    tile(0.46, 0, "partsbazar360_appicon_maskable.svg", "PartsBazar360 maskable icon", (0.45, 0.0))
    tile(0.50, 0, "partsbazar360_avatar.svg", "PartsBazar360 profile image", (0.5, 0.0))
    micro = micro16_shapes()
    (out_svg / "partsbazar360_symbol_micro16.svg").write_text(
        svg_doc(micro, {"tile": "petrol", "symbol": "canvas"}, "PartsBazar360 favicon 16px"), encoding="utf-8", newline="\n"
    )

    # Concepts
    for cid, name, fn in CONCEPTS:
        sym_c, words = fn()
        (out_concepts / f"{cid}_lockup.svg").write_text(
            svg_doc(sym_c + words, CONCEPT_COLORS, f"Concept {name}"), encoding="utf-8", newline="\n"
        )
        (out_concepts / f"{cid}_symbol.svg").write_text(
            svg_doc(sym_c, CONCEPT_COLORS, f"Concept {name} symbol"), encoding="utf-8", newline="\n"
        )
        manifest["concepts"].append(cid)

    (out_pres / "construction.svg").write_text(construction_svg(), encoding="utf-8", newline="\n")

    # Presentation defs
    defs, ratios = [], {}
    for sid, shapes in [
        ("pb-horizontal", layouts["horizontal"]),
        ("pb-stacked", layouts["stacked"]),
        ("pb-symbol", layouts["symbol"]),
        ("pb-wordmark", layouts["wordmark"]),
        ("pb-production", prod),
        ("pb-micro16", micro),
    ] + [(f"pb-{cid}-lockup", sum(fn(), [])) for cid, _, fn in CONCEPTS] + [
        (f"pb-{cid}-symbol", fn()[0]) for cid, _, fn in CONCEPTS
    ]:
        d, ratio = symbol_def(sid, shapes)
        defs.append(d)
        ratios[sid] = round(ratio, 4)
    (out_pres / "logo-defs.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">'
        + "".join(defs)
        + "</svg>\n",
        encoding="utf-8",
        newline="\n",
    )

    geometry = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in G.items() if not isinstance(v, list)}
    geometry.update({"cap": round(CAP, 3), "gap": round(GAP, 3), "ratios": ratios})
    (PKG / "source" / "geometry.json").write_text(json.dumps(geometry, indent=2) + "\n", encoding="utf-8")
    (PKG / "source" / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(geometry, indent=2))


if __name__ == "__main__":
    main()
