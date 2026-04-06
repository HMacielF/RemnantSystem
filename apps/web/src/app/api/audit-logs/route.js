import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, fetchAuditLogs } from "@/server/private-api";

export async function GET(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const searchParams = new URL(request.url).searchParams;
    return applyAuthCookies(
      NextResponse.json(await fetchAuditLogs(authed.client, searchParams)),
      authed,
    );
  } catch (error) {
    console.error("Failed to load audit logs:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load audit logs" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
