import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, processHoldExpirations } from "@/server/private-api";

export async function POST(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    return applyAuthCookies(
      NextResponse.json(await processHoldExpirations(authed.client, authed)),
      authed,
    );
  } catch (error) {
    console.error("Failed to process hold expirations:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to process hold expirations" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
