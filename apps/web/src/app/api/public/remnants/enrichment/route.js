import { NextResponse } from "next/server";
import { fetchPublicRemnantEnrichment } from "@/server/public-api";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const rows = await fetchPublicRemnantEnrichment(ids);
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Failed to load public remnant enrichment:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load public remnant enrichment" },
      { status: 500 },
    );
  }
}
