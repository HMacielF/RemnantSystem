import { NextResponse } from "next/server";
import { fetchInventorySummary } from "@/server/private-api";

export async function GET() {
  try {
    return NextResponse.json(await fetchInventorySummary());
  } catch (error) {
    console.error("Failed to load remnant summary:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load remnant summary" },
      { status: 500 },
    );
  }
}
