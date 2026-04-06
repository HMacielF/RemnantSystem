import { NextResponse } from "next/server";
import { fetchPublicLookupRows } from "@/server/public-api";

export async function GET() {
  try {
    return NextResponse.json(await fetchPublicLookupRows());
  } catch (error) {
    console.error("Failed to load public lookups:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load public lookups" },
      { status: 500 },
    );
  }
}
