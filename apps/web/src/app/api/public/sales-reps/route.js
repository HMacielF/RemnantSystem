import { NextResponse } from "next/server";
import { fetchPublicSalesRepRows } from "@/server/public-api";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    return NextResponse.json(
      await fetchPublicSalesRepRows({
        internalRemnantId: searchParams.get("remnant_id"),
        externalRemnantId: searchParams.get("external_remnant_id"),
      }),
    );
  } catch (error) {
    console.error("Failed to load public sales reps:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load public sales reps" },
      { status: 500 },
    );
  }
}
