import { NextResponse } from "next/server";
import { fetchPublicRemnants, getPublicRemnantFilters } from "@/server/public-api";
import { buildPublicOptionsResponse, withPublicCors } from "@/server/public-route";

export async function GET(request) {
  try {
    const filters = getPublicRemnantFilters(request.nextUrl.searchParams);
    const rows = await fetchPublicRemnants(filters);
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
