import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, fetchMySold } from "@/server/private-api";

export async function GET(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    return applyAuthCookies(
      NextResponse.json(await fetchMySold(authed.client, authed.profile)),
      authed,
    );
  } catch (error) {
    console.error("Failed to load my sold:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load my sold" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
