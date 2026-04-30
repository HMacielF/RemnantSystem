import { NextResponse } from "next/server";
import {
  bulkInventoryHold,
  canRunInventoryCheck,
  endInventoryPass,
  fetchActiveInventorySession,
  fetchInventoryCheckSession,
  fetchInventoryHoldCount,
  lookupInventoryCheckRemnant,
  recordInventoryCheck,
  resolveNotInDbEntry,
} from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";

function denyIfNoInventoryCheckAccess(authed) {
  if (canRunInventoryCheck(authed?.profile)) return null;
  return NextResponse.json(
    { error: "You don't have access to inventory check." },
    { status: 403 },
  );
}

export const GET = withAuth([], async (request, authed) => {
  const denied = denyIfNoInventoryCheckAccess(authed);
  if (denied) return denied;

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

export const POST = withAuth([], async (request, authed) => {
  const denied = denyIfNoInventoryCheckAccess(authed);
  if (denied) return denied;

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
  if (body?.action === "resolve_not_in_db") {
    return NextResponse.json(
      await resolveNotInDbEntry(authed.client, authed, body),
    );
  }
  return NextResponse.json(
    await recordInventoryCheck(authed.client, authed, body),
  );
});
