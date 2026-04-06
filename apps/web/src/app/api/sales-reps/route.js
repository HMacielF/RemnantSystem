import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, fetchSalesRepRows, getWriteClient } from "@/server/private-api";

export async function GET(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    return applyAuthCookies(
      NextResponse.json(await fetchSalesRepRows(getWriteClient(authed.client))),
      authed,
    );
  } catch (error) {
    console.error("Failed to load sales reps:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load sales reps" },
      { status: 500 },
    ), authed);
  }
}
