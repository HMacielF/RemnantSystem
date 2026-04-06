import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, updateRemnantImage } from "@/server/private-api";

export async function PATCH(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    const body = await request.json();
    return applyAuthCookies(
      NextResponse.json(await updateRemnantImage(authed.client, authed, Number(resolvedParams.id), body)),
      authed,
    );
  } catch (error) {
    console.error("Failed to update remnant image:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to update remnant image" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
