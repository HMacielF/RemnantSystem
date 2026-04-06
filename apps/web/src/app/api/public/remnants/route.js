import { NextResponse } from "next/server";
import { fetchPublicRemnants, getPublicRemnantFilters } from "@/server/public-api";

export async function GET(request) {
  try {
    const filters = getPublicRemnantFilters(request.nextUrl.searchParams);
    const rows = await fetchPublicRemnants(filters);
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Failed to load public remnants:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load public remnants" },
      { status: 500 },
    );
  }
}
