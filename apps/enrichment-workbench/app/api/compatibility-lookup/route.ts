import { NextRequest, NextResponse } from "next/server";
import { lookupCompatibilityByMpn, lookupCompatibilityByOe } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const oeNumber = request.nextUrl.searchParams.get("oe")?.trim() || "";
    const brand = request.nextUrl.searchParams.get("brand")?.trim() || "";
    const manufacturerPartNumber = request.nextUrl.searchParams.get("mpn")?.trim() || "";
    if (oeNumber.length < 5 && (!brand || manufacturerPartNumber.length < 5)) {
      return NextResponse.json(
        { error: "Enter a complete OE number or an exact Brand + MPN before looking up compatibility." },
        { status: 400 },
      );
    }
    const result = oeNumber.length >= 5
      ? await lookupCompatibilityByOe(oeNumber)
      : await lookupCompatibilityByMpn(brand, manufacturerPartNumber);
    if (!result) {
      return NextResponse.json(
        { error: "No confirmed compatibility was found for that exact OE or Brand + MPN in the verified catalogue." },
        { status: 404 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to look up compatibility." },
      { status: 500 },
    );
  }
}
