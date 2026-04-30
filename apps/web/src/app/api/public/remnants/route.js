import { NextResponse } from "next/server";
import { fetchPublicRemnants, getPublicRemnantFilters } from "@/server/public-api";
import { buildPublicOptionsResponse, withPublicCors } from "@/server/public-route";

// Public site is currently the Quick Countertop storefront. The default
// /api/public/remnants response scopes to that company and hides remnants
// without a usable photo so visitors don't see broken-image cards. Override
// via NEXT_PUBLIC_HOME_COMPANY when this template is reused for another
// supplier; the per-company route at /api/public/remnants/[company] still
// honours whatever company slug is passed.
const DEFAULT_HOME_COMPANY = (process.env.NEXT_PUBLIC_HOME_COMPANY || "Quick Countertop").trim();

export async function GET(request) {
  try {
    const filters = {
      ...getPublicRemnantFilters(request.nextUrl.searchParams),
      requireImage: true,
    };
    const rows = await fetchPublicRemnants(filters, { companyName: DEFAULT_HOME_COMPANY });
    return withPublicCors(NextResponse.json(rows), ["GET", "OPTIONS"]);
  } catch (error) {
    console.error("Failed to load public remnants:", error);
    return withPublicCors(NextResponse.json(
      { error: error.message || "Failed to load public remnants" },
      { status: 500 },
    ), ["GET", "OPTIONS"]);
  }
}

export function OPTIONS() {
  return buildPublicOptionsResponse(["GET", "OPTIONS"]);
}
