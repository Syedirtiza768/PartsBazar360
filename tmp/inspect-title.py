#!/usr/bin/env python3
from bs4 import BeautifulSoup
import re

html = open("/tmp/partsouq-flare.html", encoding="utf-8", errors="ignore").read()
soup = BeautifulSoup(html, "lxml")

car = soup.select_one('a.compatibility-car[data-number="1230A153"]')
print("car", bool(car))
node = car
for i in range(12):
    if node is None:
        break
    txt = (node.get_text(" ", strip=True) or "")[:100]
    print(i, node.name, node.get("class"), repr(txt))
    node = node.parent

idx = html.find("data-number=\"1230A153\"")
print("\n--- HTML chunk ---")
print(html[max(0, idx - 1200) : idx + 500])
