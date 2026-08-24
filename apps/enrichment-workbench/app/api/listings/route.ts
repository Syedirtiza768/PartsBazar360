import { NextRequest, NextResponse } from "next/server";
import { listListings } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const result = await listListings({
      query: params.get("q") || "",
      filter: params.get("filter") || "all",
      page: Number(params.get("page") || 1),
      pageSize: Number(params.get("pageSize") || 24),
      brand: params.get("brand") || undefined,
      category: params.get("category") || undefined,
      productType: params.get("productType") || undefined,
      systemCategory: params.get("systemCategory") || undefined,
      partType: params.get("partType") || undefined,
      condition: params.get("condition") || undefined,
      sourceTag: params.get("sourceTag") || undefined,
      currency: params.get("currency") || undefined,
      titleState: (params.get("titleState") as "all" | "complete" | "needs" | null) || undefined,
      imageState: (params.get("imageState") as "all" | "has" | "missing" | null) || undefined,
      compatibilityState: (params.get("compatibilityState") as "all" | "confirmed" | "has" | "missing" | null) || undefined,
      oeState: (params.get("oeState") as "all" | "has" | "missing" | null) || undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the local catalogue." },
      { status: 500 },
    );
  }
}
