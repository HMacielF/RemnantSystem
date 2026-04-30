import { NextResponse } from "next/server";
import { fetchPublicCompanyRemnants, getPublicRemnantFilters } from "@/server/public-api";
import { buildPublicOptionsResponse, withPublicCors } from "@/server/public-route";

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const company = String(resolvedParams?.company || "").trim();
    const filters = {
      ...getPublicRemnantFilters(request.nextUrl.searchParams),
      requireImage: true,
    };
    const rows = await fetchPublicCompanyRemnants(company, filters);
    return withPublicCors(NextResponse.json(rows), ["GET", "OPTIONS"]);
  } catch (error) {
    console.error("Failed to load company public remnants:", error);
    return withPublicCors(NextResponse.json(
      { error: error.message || "Failed to load company public remnants" },
      { status: error.statusCode || 500 },
    ), ["GET", "OPTIONS"]);
  }
}

export function OPTIONS() {
  return buildPublicOptionsResponse(["GET", "OPTIONS"]);
}
