import { NextResponse } from "next/server";
import {
  applyAuthCookies,
  bulkInventoryHold,
  createRequiredAuthedContext,
  fetchInventoryCheckSession,
  fetchInventoryHoldCount,
  lookupInventoryCheckRemnant,
  recordInventoryCheck,
} from "@/server/private-api";

export async function GET(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const searchParams = new URL(request.url).searchParams;
    const number = String(searchParams.get("number") || "").trim();
    const sessionId = String(searchParams.get("session_id") || "").trim();

    if (number) {
      return applyAuthCookies(
        NextResponse.json(await lookupInventoryCheckRemnant(authed.client, number, authed, sessionId)),
        authed,
      );
    }

    const holdCount = searchParams.get("hold_count");
    if (holdCount === "1") {
      return applyAuthCookies(
        NextResponse.json(await fetchInventoryHoldCount(authed.client)),
        authed,
      );
    }

    return applyAuthCookies(
      NextResponse.json(await fetchInventoryCheckSession(authed.client, authed, sessionId)),
      authed,
    );
  } catch (error) {
    console.error("Failed to load remnant checks:", error);
    return applyAuthCookies(
      NextResponse.json(
        { error: error.message || "Failed to load remnant checks" },
        { status: error.statusCode || 500 },
      ),
      authed,
    );
  }
}

export async function POST(request) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const body = await request.json();
    if (body?.action === "bulk_inventory_hold") {
      return applyAuthCookies(
        NextResponse.json(await bulkInventoryHold(authed.client, authed)),
        authed,
      );
    }
    return applyAuthCookies(
      NextResponse.json(await recordInventoryCheck(authed.client, authed, body)),
      authed,
    );
  } catch (error) {
    console.error("Failed to save remnant check:", error);
    return applyAuthCookies(
      NextResponse.json(
        { error: error.message || "Failed to save remnant check" },
        { status: error.statusCode || 500 },
      ),
      authed,
    );
  }
}
