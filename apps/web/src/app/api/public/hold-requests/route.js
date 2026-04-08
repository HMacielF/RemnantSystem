import { NextResponse } from "next/server";
import { createPublicHoldRequest } from "@/server/public-api";
import { buildPublicOptionsResponse, withPublicCors } from "@/server/public-route";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return withPublicCors(NextResponse.json(await createPublicHoldRequest(body), { status: 201 }), ["POST", "OPTIONS"]);
  } catch (error) {
    console.error("Failed to create public hold request:", error);
    return withPublicCors(NextResponse.json(
      error.payload || { error: error.message || "Failed to create hold request" },
      { status: error.statusCode || 500 },
    ), ["POST", "OPTIONS"]);
  }
}

export function OPTIONS() {
  return buildPublicOptionsResponse(["POST", "OPTIONS"]);
}
