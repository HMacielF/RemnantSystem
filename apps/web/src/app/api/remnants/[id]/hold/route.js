import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, fetchRemnantHold, saveHold } from "@/server/private-api";

export async function GET(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    return applyAuthCookies(
      NextResponse.json(await fetchRemnantHold(authed.client, Number(resolvedParams.id))),
      authed,
    );
  } catch (error) {
    console.error("Failed to load remnant hold:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load remnant hold" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}

export async function POST(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    const body = await request.json();
    return applyAuthCookies(
      NextResponse.json(await saveHold(authed.client, authed, Number(resolvedParams.id), body)),
      authed,
    );
  } catch (error) {
    console.error("Failed to save hold:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to save hold" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
