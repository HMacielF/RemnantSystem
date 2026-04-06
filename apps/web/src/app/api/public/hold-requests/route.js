import { NextResponse } from "next/server";
import { createPublicHoldRequest } from "@/server/public-api";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await createPublicHoldRequest(body), { status: 201 });
  } catch (error) {
    console.error("Failed to create public hold request:", error);
    return NextResponse.json(
      error.payload || { error: error.message || "Failed to create hold request" },
      { status: error.statusCode || 500 },
    );
  }
}
