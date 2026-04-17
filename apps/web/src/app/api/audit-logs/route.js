import { NextResponse } from "next/server";
import { fetchAuditLogs } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { SUPER_ADMIN } from "@/server/roles";

export const GET = withAuth(SUPER_ADMIN, async (request, authed) => {
  return NextResponse.json(
    await fetchAuditLogs(authed.client, request.nextUrl.searchParams),
  );
});
