import { NextResponse } from "next/server";
import { fetchInventorySummary } from "@/server/public-api";

export async function GET() {
  try {
    return NextResponse.json(await fetchInventorySummary());
  } catch (error) {
    console.error("Failed to load public summary:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load public summary" },
      { status: 500 },
    );
  }
}
