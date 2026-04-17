import { NextResponse } from "next/server";
import {
  applyAuthCookies,
  approveRemnant,
  createRequiredAuthedContext,
  fetchPendingApprovals,
} from "@/server/private-api";

export async function GET(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    return applyAuthCookies(
      NextResponse.json(await fetchPendingApprovals(authed.client)),
      authed,
    );
  } catch (error) {
    console.error("Failed to fetch pending approvals:", error);
    return applyAuthCookies(
      NextResponse.json({ error: error.message || "Failed to fetch pending approvals" }, { status: 500 }),
      authed,
    );
  }
}

export async function POST(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const { remnant_id } = await request.json();
    return applyAuthCookies(
      NextResponse.json(await approveRemnant(authed.client, authed, Number(remnant_id))),
      authed,
    );
  } catch (error) {
    console.error("Failed to approve remnant:", error);
    return applyAuthCookies(
      NextResponse.json({ error: error.message || "Failed to approve remnant" }, { status: error.statusCode || 500 }),
      authed,
    );
  }
}
