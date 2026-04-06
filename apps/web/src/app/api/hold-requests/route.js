import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, fetchHoldRequests } from "@/server/private-api";

export async function GET(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const searchParams = new URL(request.url).searchParams;
    return applyAuthCookies(
      NextResponse.json(await fetchHoldRequests(authed.client, authed.profile, searchParams)),
      authed,
    );
  } catch (error) {
    console.error("Failed to load hold requests:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load hold requests" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
