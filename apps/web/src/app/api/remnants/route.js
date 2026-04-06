import { NextResponse } from "next/server";
import { applyAuthCookies, createRemnant, createRequiredAuthedContext, fetchPrivateRemnants } from "@/server/private-api";

export async function GET(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    return applyAuthCookies(NextResponse.json(await fetchPrivateRemnants(request, authed)), authed);
  } catch (error) {
    console.error("Failed to filter remnants:", error);
    return applyAuthCookies(NextResponse.json(
      {
        error: "Failed to filter remnants",
        details: error?.message || String(error),
      },
      { status: error.statusCode || 500 },
    ), authed);
  }
}

export async function POST(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const body = await request.json();
    return applyAuthCookies(
      NextResponse.json(await createRemnant(authed.client, authed, body), { status: 201 }),
      authed,
    );
  } catch (error) {
    console.error("Failed to create remnant:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to create remnant" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
