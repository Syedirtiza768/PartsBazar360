#!/usr/bin/env python3
"""Enrich Superior Auto Parts with images from PartSouq via FlareSolverr. Reads target list from CSV."""
import csv, json, os, re, sys, time, urllib.request
import psycopg2

FLARESOLVERR_URL = "http://localhost:8191/v1"
DB_DSN = "host=172.18.0.10 port=5432 dbname=partsbazar_db user=partsbazar_user password=partsbazar_password"
DELAY_S = float(os.environ.get("DELAY_S", "1.5"))
LIMIT = int(os.environ.get("LIMIT", "0")) or None
CSV_PATH = os.environ.get("CSV_PATH", "/tmp/partsouq_targets.csv")
STATE_PATH = "/tmp/partsouq-enrich-progress.json"

def normalize_pn(v):
    return re.sub(r"[^A-Z0-9]", "", str(v or "").upper())

def flaresolverr_get(url, timeout=25000):
    payload = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": timeout}).encode()
    req = urllib.request.Request(FLARESOLVERR_URL, data=payload, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=timeout // 1000 + 15)
        data = json.loads(resp.read())
        sol = data.get("solution", {})
        return {"ok": True, "status": sol.get("status", 0), "html": sol.get("response", "")}
    except Exception as e:
        return {"ok": False, "status": 0, "html": "", "error": str(e)[:100]}

def parse_images(html, pn):
    pn_norm = normalize_pn(pn)
    images = []
    for pat in [r'partsimages', r'tesseract', r'PartThumbnail']:
        for m in re.finditer(rf'(https?://[^\s"\']*{pat}[^\s"\']*)', html):
            url = m.group(1).replace("&amp;", "&")
            if url not in images:
                images.append(url)
    images.sort(key=lambda u: (0 if pn_norm and pn_norm in normalize_pn(u) else 1))
    return images[:12]

def fetch_image(pn):
    url = f"https://partsouq.com/en/search/all?q={pn}"
    r = flaresolverr_get(url)
    if not r["ok"]:
        return {"ok": False, "error": r.get("error", ""), "images": []}
    html = r["html"]
    if "Just a moment" in html:
        return {"ok": False, "error": "cf_blocked", "images": []}
    imgs = parse_images(html, pn)
    return {"ok": bool(imgs), "images": imgs}

def load_state():
    try:
        with open(STATE_PATH) as f:
            d = json.load(f)
        return {"done": set(d.get("done", [])), "ok": d.get("ok", 0), "fail": d.get("fail", 0), "nf": d.get("nf", 0)}
    except:
        return {"done": set(), "ok": 0, "fail": 0, "nf": 0}

def save_state(s):
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"done": list(s["done"]), "ok": s["ok"], "fail": s["fail"], "nf": s["nf"], "ts": time.strftime("%Y-%m-%dT%H:%M:%S")}, f)
    os.replace(tmp, STATE_PATH)

def main():
    state = load_state()
    print(f"Prev: ok={state['ok']} fail={state['fail']} nf={state['nf']} done={len(state['done'])}", file=sys.stderr)

    # Read CSV
    parts = []
    with open(CSV_PATH) as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid = row.get("id", "").strip()
            if pid and pid not in state["done"]:
                parts.append({"id": pid, "brand": row.get("brand", "").strip(), "mpn": row.get("manufacturerPartNumber", "").strip()})

    if LIMIT:
        parts = parts[:LIMIT]
    print(f"Loaded {len(parts)} parts from CSV", file=sys.stderr)

    if not parts:
        print("Nothing to do"); return

    conn = psycopg2.connect(DB_DSN)
    conn.autocommit = True
    cur = conn.cursor()

    cf_streak = 0
    for i, part in enumerate(parts):
        mpn = part["mpn"]
        if not mpn:
            state["done"].add(part["id"]); continue

        result = fetch_image(mpn)

        if result["ok"] and result["images"]:
            imgs = result["images"][:5]
            cur.execute('UPDATE "CanonicalPart" SET "imageUrls"=%s, "updatedAt"=NOW() WHERE id=%s', (imgs, part["id"]))
            state["ok"] += 1; state["done"].add(part["id"]); cf_streak = 0
            print(json.dumps({"i": i+1, "t": len(parts), "s": "ok", "b": part["brand"], "p": mpn, "imgs": len(imgs)}), flush=True)
        elif result.get("error") == "cf_blocked":
            state["fail"] += 1; cf_streak += 1
            print(json.dumps({"i": i+1, "s": "cf_block", "p": mpn, "streak": cf_streak}), flush=True)
            if cf_streak >= 3:
                print("3 consecutive CF blocks, sleeping 30s...", file=sys.stderr)
                time.sleep(30); cf_streak = 0
            else:
                time.sleep(5)
        else:
            state["nf"] += 1; state["done"].add(part["id"]); cf_streak = 0
            if (i+1) % 100 == 0:
                print(json.dumps({"i": i+1, "t": len(parts), "s": "nf", "ok": state["ok"], "fail": state["fail"], "nf": state["nf"]}), flush=True)

        if (i+1) % 50 == 0:
            save_state(state)

        time.sleep(DELAY_S)

    save_state(state)
    print(json.dumps({"event": "done", "ok": state["ok"], "fail": state["fail"], "nf": state["nf"]}))
    cur.close(); conn.close()

if __name__ == "__main__":
    main()
