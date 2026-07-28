#!/usr/bin/env python3
from bs4 import BeautifulSoup
import re

html = open("/tmp/partsouq-flare.html", encoding="utf-8", errors="ignore").read()
for m in re.finditer(r"(?i)compatibil", html):
    start = max(0, m.start() - 80)
    end = min(len(html), m.end() + 250)
    print("--- raw ---")
    print(repr(html[start:end]))
    print()

soup = BeautifulSoup(html, "lxml")
text = soup.get_text("\n", strip=True)
lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
for i, ln in enumerate(lines):
    if "compat" in ln.lower() or ln.lower().startswith("make"):
        print("LINE", i, repr(ln))
        for j in range(i, min(i + 20, len(lines))):
            print(" ", j, repr(lines[j][:160]))
        print()

# Look for class names related to compatibility
for el in soup.find_all(class_=re.compile(r"compat|model|fitment", re.I)):
    print("EL", el.name, el.get("class"), el.get_text(" ", strip=True)[:200])

# Sample a few img srcs near PN
print("\nIMG samples:")
for img in soup.find_all("img")[:30]:
    src = img.get("src") or img.get("data-src") or ""
    if src:
        print(src[:140])
