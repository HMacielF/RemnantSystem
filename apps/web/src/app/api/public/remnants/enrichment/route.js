import { NextResponse } from "next/server";
import { fetchPublicRemnantEnrichment } from "@/server/public-api";
import { buildPublicOptionsResponse, withPublicCors } from "@/server/public-route";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const rows = await fetchPublicRemnantEnrichment(ids);
    return withPublicCors(NextResponse.json(rows), ["POST", "OPTIONS"]);
  } catch (error) {
    console.error("Failed to load public remnant enrichment:", error);
    return withPublicCors(NextResponse.json(
      { error: error.message || "Failed to load public remnant enrichment" },
      { status: 500 },
    ), ["POST", "OPTIONS"]);
  }
}

export function OPTIONS() {
  return buildPublicOptionsResponse(["POST", "OPTIONS"]);
}
