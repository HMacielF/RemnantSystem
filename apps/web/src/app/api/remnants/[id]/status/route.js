import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, updateRemnantStatus } from "@/server/private-api";

export async function POST(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    const body = await request.json();
    return applyAuthCookies(
      NextResponse.json(await updateRemnantStatus(authed.client, authed, Number(resolvedParams.id), body)),
      authed,
    );
  } catch (error) {
    console.error("Failed to update remnant status:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to update remnant status" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
