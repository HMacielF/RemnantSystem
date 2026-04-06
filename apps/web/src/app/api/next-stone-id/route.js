import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, fetchNextStoneId } from "@/server/private-api";

export async function GET(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    return applyAuthCookies(
      NextResponse.json({ nextStoneId: await fetchNextStoneId(authed.client) }),
      authed,
    );
  } catch (error) {
    console.error("Failed to load next stone id:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load next stone id" },
      { status: 500 },
    ), authed);
  }
}
