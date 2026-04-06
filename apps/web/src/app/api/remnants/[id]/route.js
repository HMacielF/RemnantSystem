import { NextResponse } from "next/server";
import { applyAuthCookies, archiveRemnant, createRequiredAuthedContext, updateRemnant } from "@/server/private-api";

export async function PATCH(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    const body = await request.json();
    return applyAuthCookies(
      NextResponse.json(await updateRemnant(authed.client, authed, Number(resolvedParams.id), body)),
      authed,
    );
  } catch (error) {
    console.error("Failed to update remnant:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to update remnant" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}

export async function DELETE(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    return applyAuthCookies(
      NextResponse.json(await archiveRemnant(authed.client, authed, Number(resolvedParams.id))),
      authed,
    );
  } catch (error) {
    console.error("Failed to archive remnant:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to archive remnant" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
