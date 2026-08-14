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
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the local catalogue." },
      { status: 500 },
    );
  }
}
