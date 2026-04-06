import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, fetchRemnantEnrichment } from "@/server/private-api";

export async function POST(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const body = await request.json();
    return applyAuthCookies(
      NextResponse.json(await fetchRemnantEnrichment(request, body?.ids, authed)),
      authed,
    );
  } catch (error) {
    console.error("Failed to load remnant enrichment:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load remnant enrichment" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
