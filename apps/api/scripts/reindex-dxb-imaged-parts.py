#!/usr/bin/env python3
"""Reindex DXB parts that have images, restoring full OpenSearch docs (incl. offers)."""
from __future__ import annotations

import json
import os
import urllib.request

import psycopg

DATABASE_URL = os.environ["DATABASE_URL"]
OPENSEARCH_URL = os.environ["OPENSEARCH_URL"].rstrip("/")
INDEX = os.environ.get("OPENSEARCH_INDEX", "canonical_parts")
SOURCE_FILE = os.environ.get("DXB_SOURCE_FILE", "DXB-EXW.xlsx")


def put_doc(part_id: str, body: dict) -> None:
    req = urllib.request.Request(
        f"{OPENSEARCH_URL}/{INDEX}/_doc/{part_id}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        res.read()


def main() -> int:
    ok = 0
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT c.id, c.title, c.brand, c."manufacturerPartNumber",
                       c.category, c."partType", c."imageUrls", c."listingUrl",
                       c."oeNumbers", c.compatibility, c."partSource", c."qualityTier",
                       c."fitmentStatus", c."fitmentConfidence", c."createdAt"
                FROM "SourceRecord" sr
                JOIN "SellerOffer" o ON o.id = sr."sellerOfferId"
                JOIN "CanonicalPart" c ON c.id = o."canonicalPartId"
                WHERE sr."sourceFileName" = %s
                  AND cardinality(c."imageUrls") > 0
                """,
                (SOURCE_FILE,),
            )
            parts = cur.fetchall()
        print(json.dumps({"event": "reindex_start", "parts": len(parts)}), flush=True)

        for row in parts:
            (
                part_id,
                title,
                brand,
                mpn,
                category,
                part_type,
                image_urls,
                listing_url,
                oe_numbers,
                compatibility,
                part_source,
                quality_tier,
                fitment_status,
                fitment_confidence,
                created_at,
            ) = row
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT o.id, o.price, o.currency, o.condition, o."partSource",
                           o."qualityTier", o."sellerId", o.status, s.name
                    FROM "SellerOffer" o
                    JOIN "Seller" s ON s.id = o."sellerId"
                    WHERE o."canonicalPartId" = %s
                    """,
                    (part_id,),
                )
                offers = [
                    {
                        "id": r[0],
                        "price": r[1],
                        "currency": r[2],
                        "condition": r[3],
                        "partSource": r[4],
                        "qualityTier": r[5],
                        "sellerId": r[6],
                        "status": r[7],
                        "sellerName": r[8],
                    }
                    for r in cur.fetchall()
                ]
                cur.execute(
                    """
                    SELECT "displayNumber", "normalizedNumber", "numberType"
                    FROM "CatalogPartNumber"
                    WHERE "canonicalPartId" = %s
                    """,
                    (part_id,),
                )
                part_numbers = [
                    {"displayNumber": r[0], "normalizedNumber": r[1], "numberType": r[2]}
                    for r in cur.fetchall()
                ]

            prices = [o["price"] for o in offers if o.get("price") is not None]
            body = {
                "id": part_id,
                "title": title,
                "brand": brand,
                "manufacturerPartNumber": mpn,
                "category": category,
                "partType": part_type,
                "imageUrls": list(image_urls or []),
                "listingUrl": listing_url,
                "oeNumbers": list(oe_numbers or []),
                "compatibility": compatibility,
                "partSource": part_source,
                "qualityTier": quality_tier,
                "fitmentStatus": fitment_status,
                "fitmentConfidence": fitment_confidence,
                "createdAt": created_at.isoformat() if created_at else None,
                "minPrice": min(prices) if prices else None,
                "normalizedPartNumbers": [
                    n["normalizedNumber"]
                    for n in part_numbers
                    if n["numberType"] != "OEM_CROSS_REFERENCE" and n.get("normalizedNumber")
                ],
                "interchangePartNumbers": [
                    n["normalizedNumber"]
                    for n in part_numbers
                    if n["numberType"] == "OEM_CROSS_REFERENCE" and n.get("normalizedNumber")
                ],
                "partNumbers": part_numbers,
                "fitments": [],
                "offers": offers,
            }
            put_doc(part_id, body)
            ok += 1
            if ok % 100 == 0:
                print(json.dumps({"event": "progress", "ok": ok}), flush=True)

    print(json.dumps({"event": "reindex_done", "ok": ok}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
