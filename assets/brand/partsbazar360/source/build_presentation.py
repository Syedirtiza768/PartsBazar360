"""Assemble presentation/index.html from index.template.html and the built assets.

    python assets/brand/partsbazar360/source/build_presentation.py

Run after build_identity.py and render_assets.cjs. Every logo on the page is a
<use> of the <symbol> defs that build_identity.py writes, so the presentation
cannot drift from the delivered masters.

Placeholders:
  {{DEFS}} {{CONSTRUCTION}} {{CONTRAST_ROWS}} {{TREE}} {{TOTAL_FILES}}
  {{LOGO:id|class|aria label|height px}}  inline <svg> using a symbol
  {{USE:id:x:y:height}}                   <use> inside a mockup SVG
  {{IMG:relative/path.png}}               base64 data URI
  {{G:key}}                               value from source/geometry.json
  {{BARCODE:x:y:w:h}}                     illustrative barcode bars
"""
import base64
import hashlib
import json
import re
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent
PRES = PKG / "presentation"
GEOM = json.loads((PKG / "source" / "geometry.json").read_text(encoding="utf-8"))
RATIOS = GEOM["ratios"]


def luminance(hex_):
    rgb = [int(hex_[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


PAIRS = [
    ("Graphite #0d1519", "#0d1519", "Canvas #f4f2ed", "#f4f2ed", "Wordmark, body text"),
    ("Graphite #0d1519", "#0d1519", "White #ffffff", "#ffffff", "Wordmark on product surfaces"),
    ("Petrol #116b6b", "#116b6b", "White #ffffff", "#ffffff", "Symbol, 360, links"),
    ("Petrol #116b6b", "#116b6b", "Canvas #f4f2ed", "#f4f2ed", "Symbol and 360 on canvas"),
    ("Canvas #f4f2ed", "#f4f2ed", "Petrol #116b6b", "#116b6b", "App icon, logo on petrol"),
    ("Canvas #f4f2ed", "#f4f2ed", "Graphite #0d1519", "#0d1519", "Reversed wordmark"),
    ("Petrol light #3ba49f", "#3ba49f", "Graphite #0d1519", "#0d1519", "Reversed symbol and 360"),
    ("Graphite #0d1519", "#0d1519", "Safety orange #f36b21", "#f36b21", "Text on orange actions"),
    ("White #ffffff", "#ffffff", "Safety orange #f36b21", "#f36b21", "Never: white on orange"),
    ("Petrol #116b6b", "#116b6b", "Graphite #0d1519", "#0d1519", "Never: why reversed uses petrol light"),
]


def grade(r):
    if r >= 7:
        return '<span class="pill pass">AAA</span>'
    if r >= 4.5:
        return '<span class="pill pass">AA</span>'
    if r >= 3:
        return '<span class="pill warn">AA large · graphics</span>'
    return '<span class="pill fail">Fail</span>'


def contrast_rows():
    rows = []
    for fg_name, fg, bg_name, bg, use in PAIRS:
        r = contrast(fg, bg)
        rows.append(
            f'<tr><td><span style="display:inline-block;width:12px;height:12px;background:{fg};'
            f'border:1px solid var(--line);vertical-align:-1px;margin-right:6px"></span>{fg_name}</td>'
            f'<td><span style="display:inline-block;width:12px;height:12px;background:{bg};'
            f'border:1px solid var(--line);vertical-align:-1px;margin-right:6px"></span>{bg_name}</td>'
            f'<td class="num">{r:.2f}:1</td><td>{grade(r)}</td><td>{use}</td></tr>'
        )
    return "\n".join(rows)


def tree():
    lines = ["assets/brand/partsbazar360/"]
    dirs = sorted(d for d in PKG.iterdir() if d.is_dir())
    total = 0
    notes = {
        "svg": "RGB vector masters: 4 layouts x 4 colourways, production, plate, app icons, micro",
        "pdf": "CMYK vector print masters",
        "eps": "CMYK EPSF-3.0 print masters",
        "png": "transparent rasters at 600 / 1200 / 2400 w, symbol 256 / 512 / 1024 h",
        "webp": "lossless WebP twins of every PNG",
        "favicon": "favicon.ico, favicon.svg, apple-touch-icon, PWA icons, site.webmanifest",
        "app-icons": "iOS 1024, Play 512, Android adaptive and notification",
        "social": "profile 1080, WhatsApp Business 640, Open Graph 1200 x 630",
        "concepts": "the five exploration territories, symbol and lockup",
        "qa": "grayscale, photocopy, thermal and actual-size favicon proofs",
        "presentation": "this brand book: template, construction drawing, symbol defs",
        "source": "build_identity.py, render_assets.cjs, build_presentation.py, geometry",
    }
    for i, d in enumerate(dirs):
        files = sorted(p.name for p in d.iterdir() if p.is_file())
        total += len(files)
        branch = "└── " if i == len(dirs) - 1 else "├── "
        lines.append(f"{branch}{d.name + '/':<14}{len(files):>4}  {notes.get(d.name, '')}")
        pad = "    " if i == len(dirs) - 1 else "│   "
        for ex in files[:2]:
            lines.append(f"{pad}    {ex}")
        if len(files) > 2:
            lines.append(f"{pad}    …")
    root_files = [p for p in PKG.iterdir() if p.is_file()]
    total += len(root_files)
    for p in sorted(root_files):
        lines.append(f"    {p.name}")
    return "\n".join(lines), total


def barcode(x, y, w, h):
    bits = hashlib.sha256(b"PB00411872330").digest() * 2
    widths = [1 + (b % 3) for b in bits[:44]]
    unit = w / sum(widths)
    out, cx = [], x
    for i, wd in enumerate(widths):
        if i % 2 == 0:
            out.append(f'<rect x="{cx:.2f}" y="{y}" width="{wd * unit:.2f}" height="{h}"/>')
        cx += wd * unit
    return "".join(out)


def data_uri(rel):
    return "data:image/png;base64," + base64.b64encode((PKG / rel).read_bytes()).decode("ascii")


def logo(m):
    sid, cls, label, height = m.group(1).split("|")
    ratio = RATIOS[sid]
    style = f' style="height:{height}px"' if height else ""
    klass = f' class="{cls}"' if cls else ""
    return (
        f'<svg{klass} viewBox="0 0 {ratio * 100:.2f} 100" role="img" aria-label="{label}"{style}>'
        f'<use href="#{sid}"/></svg>'
    )


def use(m):
    sid, x, y, h = m.group(1).split(":")
    h = float(h)
    return f'<use href="#{sid}" x="{x}" y="{y}" width="{h * RATIOS[sid]:.2f}" height="{h:g}"/>'


def main():
    html = (PRES / "index.template.html").read_text(encoding="utf-8")
    tree_text, total = tree()
    html = html.replace("{{DEFS}}", (PRES / "logo-defs.svg").read_text(encoding="utf-8").strip())
    html = html.replace("{{CONSTRUCTION}}", (PRES / "construction.svg").read_text(encoding="utf-8").strip())
    html = html.replace("{{CONTRAST_ROWS}}", contrast_rows())
    html = html.replace("{{TREE}}", tree_text)
    html = html.replace("{{TOTAL_FILES}}", str(total))
    html = re.sub(r"\{\{LOGO:([^}]+)\}\}", logo, html)
    html = re.sub(r"\{\{USE:([^}]+)\}\}", use, html)
    html = re.sub(r"\{\{IMG:([^}]+)\}\}", lambda m: data_uri(m.group(1)), html)
    html = re.sub(r"\{\{G:(\w+)\}\}", lambda m: f"{GEOM[m.group(1)]:g}", html)
    html = re.sub(r"\{\{BARCODE:([^}]+)\}\}", lambda m: barcode(*map(float, m.group(1).split(":"))), html)
    left = re.findall(r"\{\{[^}]*\}\}", html)
    if left:
        raise SystemExit(f"unreplaced placeholders: {left[:5]}")
    (PRES / "index.html").write_text(html, encoding="utf-8", newline="\n")
    print(f"index.html {len(html) / 1024:.0f} KB, package files: {total}")


if __name__ == "__main__":
    main()
