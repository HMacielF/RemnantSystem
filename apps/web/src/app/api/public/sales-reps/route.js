import { NextResponse } from "next/server";
import { fetchPublicSalesRepRows } from "@/server/public-api";
import { buildPublicOptionsResponse, withPublicCors } from "@/server/public-route";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    return withPublicCors(NextResponse.json(
      await fetchPublicSalesRepRows({
        internalRemnantId: searchParams.get("remnant_id"),
        externalRemnantId: searchParams.get("external_remnant_id"),
      }),
    ), ["GET", "OPTIONS"]);
  } catch (error) {
    console.error("Failed to load public sales reps:", error);
    return withPublicCors(NextResponse.json(
      { error: error.message || "Failed to load public sales reps" },
      { status: 500 },
    ), ["GET", "OPTIONS"]);
  }
}

export function OPTIONS() {
  return buildPublicOptionsResponse(["GET", "OPTIONS"]);
}
