#!/usr/bin/env python3
"""Diagnose RealTrack + start Salvage/Blackline sync on EC2."""
import json
import os
import subprocess
import time
from pathlib import Path

CID = subprocess.check_output(
    ["bash", "-lc", "cd ~/PartsBazar360 && sudo docker compose ps -q api"],
    text=True,
).strip()
print("CID", CID)

diag = r'''
const base = (process.env.REALTRACK_API_URL || 'https://mhn.realtrackapp.com/api').replace(/\/$/, '');
const email = process.env.REALTRACK_API_EMAIL;
const password = process.env.REALTRACK_API_PASSWORD;
const login = await fetch(base + '/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const lj = await login.json();
if (!login.ok) throw new Error('auth failed ' + login.status + ' ' + JSON.stringify(lj));
const token = lj.accessToken;
async function get(path) {
  const r = await fetch(base + path, { headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json().catch(() => ({}));
  return { path, status: r.status, total: j.total, items: (j.items || []).length, message: j.message || j.error, sample: (j.items || [])[0] && {
    id: j.items[0].id,
    storeId: j.items[0].storeId,
    title: String(j.items[0].title || '').slice(0, 70),
    listingStatus: j.items[0].listingStatus,
    quantityAvailable: j.items[0].quantityAvailable,
    imageCount: Array.isArray(j.items[0].imageUrls) ? j.items[0].imageUrls.length : 0,
    hasCompat: j.items[0].compatibility != null,
  }};
}
const paths = [
  '/published-listings?page=1&limit=3',
  '/stores/d16199c4-55b5-429e-ad27-892bed94e00d/listings/published?page=1&limit=3',
  '/stores/3b84b063-3811-481f-a61d-f7846a03558f/listings/published?page=1&limit=3',
  '/stores/eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0/listings/published?page=1&limit=3',
  '/published-listings?page=1&limit=3&storeId=d16199c4-55b5-429e-ad27-892bed94e00d',
  '/published-listings?page=1&limit=3&storeId=eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0',
  '/published-listings?page=1&limit=3&storeSlug=salvagea',
  '/published-listings?page=1&limit=3&storeSlug=blacklineusedautoparts',
  '/published-listings?page=1&limit=3&marketplaceId=EBAY_MOTORS_US',
];
const out = [];
for (const p of paths) out.push(await get(p));
console.log(JSON.stringify({ email, results: out }, null, 2));
'''
Path('/tmp/rt-paths.mjs').write_text(diag)
subprocess.check_call(["sudo", "docker", "cp", "/tmp/rt-paths.mjs", f"{CID}:/tmp/rt-paths.mjs"])
print("=== REALTRACK PATH PROBE ===")
subprocess.check_call(["sudo", "docker", "exec", "-w", "/app", CID, "node", "/tmp/rt-paths.mjs"])

print("=== QUEUE operations/sync/all-us ===")
try:
    out = subprocess.check_output(
        [
            "sudo",
            "docker",
            "exec",
            CID,
            "wget",
            "-qO-",
            "--post-data=",
            "--header=Content-Type: application/json",
            "http://127.0.0.1:3001/operations/sync/all-us",
        ],
        text=True,
    )
    print(out)
except subprocess.CalledProcessError as e:
    print("queue failed", e)

print("=== START seed:realtrack-dynatrade (no Dynatrade) ===")
subprocess.call(["sudo", "docker", "exec", CID, "sh", "-c", "pkill -f seed-realtrack-dynatrade || true"])
subprocess.check_call(
    [
        "sudo",
        "docker",
        "exec",
        "-d",
        CID,
        "sh",
        "-c",
        "cd /app && SEED_INCLUDE_DYNATRADE=0 npm run seed:realtrack-dynatrade > /tmp/seed-realtrack.log 2>&1",
    ]
)
time.sleep(5)
print("=== PROCESS ===")
subprocess.call(["sudo", "docker", "exec", CID, "sh", "-c", "ps aux | grep -E 'seed-realtrack|seed-realtrack-dynatrade' | grep -v grep || echo not_running"])
print("=== LOG TAIL ===")
subprocess.call(["sudo", "docker", "exec", CID, "sh", "-c", "wc -l /tmp/seed-realtrack.log; tail -n 50 /tmp/seed-realtrack.log"])
