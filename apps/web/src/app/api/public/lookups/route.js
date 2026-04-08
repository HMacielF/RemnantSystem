import { NextResponse } from "next/server";
import { fetchPublicLookupRows } from "@/server/public-api";
import { buildPublicOptionsResponse, withPublicCors } from "@/server/public-route";

export async function GET() {
  try {
    return withPublicCors(NextResponse.json(await fetchPublicLookupRows()), ["GET", "OPTIONS"]);
  } catch (error) {
    console.error("Failed to load public lookups:", error);
    return withPublicCors(NextResponse.json(
      { error: error.message || "Failed to load public lookups" },
      { status: 500 },
    ), ["GET", "OPTIONS"]);
  }
}

export function OPTIONS() {
  return buildPublicOptionsResponse(["GET", "OPTIONS"]);
}
