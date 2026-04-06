import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, fetchMyHolds } from "@/server/private-api";

export async function GET(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    return applyAuthCookies(
      NextResponse.json(await fetchMyHolds(authed.client, authed.profile)),
      authed,
    );
  } catch (error) {
    console.error("Failed to load my holds:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load my holds" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
