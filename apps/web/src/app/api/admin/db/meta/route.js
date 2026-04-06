import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, fetchAdminMeta } from "@/server/private-api";

export async function GET(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    return applyAuthCookies(NextResponse.json(fetchAdminMeta()), authed);
  } catch (error) {
    console.error("Failed to load admin metadata:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load admin metadata" },
      { status: 500 },
    ), authed);
  }
}
