import { NextResponse } from "next/server";
import { fetchInventorySummary } from "@/server/public-api";
import { buildPublicOptionsResponse, withPublicCors } from "@/server/public-route";

export async function GET() {
  try {
    return withPublicCors(NextResponse.json(await fetchInventorySummary()), ["GET", "OPTIONS"]);
  } catch (error) {
    console.error("Failed to load public summary:", error);
    return withPublicCors(NextResponse.json(
      { error: error.message || "Failed to load public summary" },
      { status: 500 },
    ), ["GET", "OPTIONS"]);
  }
}

export function OPTIONS() {
  return buildPublicOptionsResponse(["GET", "OPTIONS"]);
}
