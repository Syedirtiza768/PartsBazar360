import { NextRequest, NextResponse } from "next/server";
import { getListing, saveListing } from "@/lib/store";
import type { CompatibilityRow, ReviewStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const listing = await getListing(id);
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    return NextResponse.json(listing);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load this listing." },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      title?: unknown;
      oemPartNumber?: unknown;
      imageUrls?: unknown;
      compatibility?: unknown;
      universalFitment?: unknown;
      reviewerNote?: unknown;
      status?: unknown;
    };
    const status: ReviewStatus = body.status === "approved" ? "approved" : "draft";
    const result = await saveListing(id, {
      title: typeof body.title === "string" ? body.title : "",
      oemPartNumber: typeof body.oemPartNumber === "string" ? body.oemPartNumber : "",
      imageUrls: Array.isArray(body.imageUrls)
        ? body.imageUrls.filter((item): item is string => typeof item === "string")
        : [],
      compatibility: Array.isArray(body.compatibility)
        ? (body.compatibility as CompatibilityRow[])
        : [],
      universalFitment: body.universalFitment === true,
      reviewerNote: typeof body.reviewerNote === "string" ? body.reviewerNote : "",
      status,
    });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result.listing);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save this listing." },
      { status: 500 },
    );
  }
}
