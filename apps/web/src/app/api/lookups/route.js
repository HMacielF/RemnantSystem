import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, fetchLookupPayload } from "@/server/private-api";

export async function GET(request) {
  if (String(new URL(request.url).searchParams.get("public") || "") === "1") {
    try {
      return NextResponse.json(await fetchLookupPayload(request));
    } catch (error) {
      console.error("Failed to load public lookups:", error);
      return NextResponse.json(
        { error: error.message || "Failed to load public lookups" },
        { status: error.statusCode || 500 },
      );
    }
  }

  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    return applyAuthCookies(NextResponse.json(await fetchLookupPayload(request, authed)), authed);
  } catch (error) {
    console.error("Failed to load lookups:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load lookups" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
