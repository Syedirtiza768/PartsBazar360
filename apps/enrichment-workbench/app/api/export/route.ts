import { NextResponse } from "next/server";
import { exportApproved } from "@/lib/store";

export const dynamic = "force-dynamic";

function csvCell(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  try {
    const listings = await exportApproved();
    const header = [
      "listing_id",
      "canonical_part_id",
      "source_updated_at",
      "enriched_title",
      "oe_number",
      "image_urls",
      "compatibility_json",
      "universal_fitment",
      "reviewer_note",
      "approved_at",
    ];
    const rows = listings.map((listing) =>
      [
        listing.listingId,
        listing.canonicalPartId,
        listing.sourceUpdatedAt,
        listing.title,
        listing.oemPartNumber,
        listing.imageUrls.join("|"),
        listing.compatibility,
        String(listing.universalFitment),
        listing.reviewerNote,
        listing.editUpdatedAt,
      ]
        .map(csvCell)
        .join(","),
    );
    const csv = [header.join(","), ...rows].join("\r\n");
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="superior-approved-enrichment-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create the export." },
      { status: 500 },
    );
  }
}
