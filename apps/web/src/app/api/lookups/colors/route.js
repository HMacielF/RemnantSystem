import { NextResponse } from "next/server";
import { applyAuthCookies, createColorLookupRow, createRequiredAuthedContext } from "@/server/private-api";

export async function POST(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const body = await request.json();
    const row = await createColorLookupRow(authed.client, body?.name);
    return applyAuthCookies(NextResponse.json(row, { status: 201 }), authed);
  } catch (error) {
    console.error("Failed to create color:", error);
    return applyAuthCookies(
      NextResponse.json(
        { error: error.message || "Failed to create color" },
        { status: error.statusCode || 500 },
      ),
      authed,
    );
  }
}
