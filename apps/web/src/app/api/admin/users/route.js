import { NextResponse } from "next/server";
import { applyAuthCookies, createAdminUser, createRequiredAuthedContext } from "@/server/private-api";

export async function POST(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const body = await request.json();
    const origin = new URL(request.url).origin;

    return applyAuthCookies(
      NextResponse.json(
        await createAdminUser(authed.client, body?.values || {}, { origin }),
        { status: 201 },
      ),
      authed,
    );
  } catch (error) {
    console.error("Failed to create admin user:", error);
    return applyAuthCookies(
      NextResponse.json(
        { error: error.message || "Failed to create user" },
        { status: 500 },
      ),
      authed,
    );
  }
}
