import { NextResponse } from "next/server";
import {
  bulkInventoryHold,
  endInventoryPass,
  fetchActiveInventorySession,
  fetchInventoryCheckSession,
  fetchInventoryHoldCount,
  lookupInventoryCheckRemnant,
  recordInventoryCheck,
} from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { SUPER_ADMIN } from "@/server/roles";

export const GET = withAuth(SUPER_ADMIN, async (request, authed) => {
  const { searchParams } = request.nextUrl;
  const number = String(searchParams.get("number") || "").trim();
  const sessionId = String(searchParams.get("session_id") || "").trim();

  if (number) {
    return NextResponse.json(
      await lookupInventoryCheckRemnant(authed.client, number, authed, sessionId),
    );
  }

  if (searchParams.get("hold_count") === "1") {
    return NextResponse.json(await fetchInventoryHoldCount(authed.client));
  }

  if (searchParams.get("active") === "1") {
    return NextResponse.json(await fetchActiveInventorySession(authed.client));
  }

  return NextResponse.json(
    await fetchInventoryCheckSession(authed.client, authed, sessionId),
  );
});

export const POST = withAuth(SUPER_ADMIN, async (request, authed) => {
  const body = await request.json();
  if (body?.action === "bulk_inventory_hold") {
    return NextResponse.json(
      await bulkInventoryHold(authed.client, authed, body?.session_id),
    );
  }
  if (body?.action === "end_pass") {
    return NextResponse.json(
      await endInventoryPass(authed.client, authed, body?.session_id),
    );
  }
  return NextResponse.json(
    await recordInventoryCheck(authed.client, authed, body),
  );
});
