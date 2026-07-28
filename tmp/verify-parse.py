#!/usr/bin/env python3
import json
import sys
sys.path.insert(0, "/home/ubuntu/PartsBazar360/apps/api/scripts")
from partsouq_fetch import parse_search_html

html = open("/tmp/partsouq-flare.html", encoding="utf-8", errors="ignore").read()
r = parse_search_html(html, "1230A153", "MITSUBISHI")
print(json.dumps({k: r[k] for k in ["title", "make", "imageUrls", "models"]}, indent=2))
