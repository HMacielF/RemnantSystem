import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, updateHoldRequest } from "@/server/private-api";

export async function PATCH(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    const body = await request.json();
    const requestId = Number(resolvedParams.id);
    return applyAuthCookies(
      NextResponse.json(await updateHoldRequest(authed.client, authed.profile, requestId, body)),
      authed,
    );
  } catch (error) {
    console.error("Failed to update hold request:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to update hold request" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
