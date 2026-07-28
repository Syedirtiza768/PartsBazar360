import { NextResponse } from "next/server";
import { currencyForCountry, SETTLEMENT_CURRENCY } from "@/lib/currency";

/**
 * Lightweight geo hint for display-currency defaults.
 * Prefers CDN country headers when present (Cloudflare / generic proxies).
 */
export async function GET(request: Request) {
  const headers = request.headers;
  const country = (
    headers.get("cf-ipcountry") ||
    headers.get("x-vercel-ip-country") ||
    headers.get("x-country-code") ||
    ""
  )
    .trim()
    .toUpperCase();

  const safeCountry =
    country && country !== "XX" && country !== "T1" && /^[A-Z]{2}$/.test(country)
      ? country
      : null;

  return NextResponse.json({
    country: safeCountry,
    currency: safeCountry ? currencyForCountry(safeCountry) : SETTLEMENT_CURRENCY,
    settlementCurrency: SETTLEMENT_CURRENCY,
  });
}
