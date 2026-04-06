import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, releaseHold } from "@/server/private-api";

export async function POST(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    return applyAuthCookies(
      NextResponse.json(await releaseHold(authed.client, authed, Number(resolvedParams.id))),
      authed,
    );
  } catch (error) {
    console.error("Failed to release hold:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to release hold" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
