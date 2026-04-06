import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext } from "@/server/private-api";

export async function GET(request) {
  const authed = await createRequiredAuthedContext(request);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    return applyAuthCookies(NextResponse.json({ profile: authed.profile }), authed);
  } catch (error) {
    console.error("Failed to load profile:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load profile" },
      { status: 500 },
    ), authed);
  }
}
