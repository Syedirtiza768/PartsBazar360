import json
from pathlib import Path

d = json.loads(Path(r"F:/apps/PartsBazar360/tmp/rt-detail-sample.json").read_text(encoding="utf-8"))
print("=== TARGET SCAN ===")
print(json.dumps(d["targetScan"], indent=2))
print("\n=== GLOBAL VS SUM ===")
print(json.dumps(d["globalVsSum"], indent=2))
print("\n=== BL404 ===")
print(json.dumps(d["blacklineUnknownId"], indent=2))
samples = d["liveStoreSample"]["samples"]
print(f"\n=== LIVE STORE total={d['liveStoreSample']['listTotal']} samples={len(samples)} ===")
for i, s in enumerate(samples[:3]):
    print(f"\n--- sample {i} LIST ---")
    print(json.dumps(s["list"], indent=2))
    print(f"--- sample {i} DETAIL ---")
    print(json.dumps(s["detail"], indent=2))
