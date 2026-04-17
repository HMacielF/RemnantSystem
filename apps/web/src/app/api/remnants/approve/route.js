import { NextResponse } from "next/server";
import { approveRemnant, fetchPendingApprovals } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { SUPER_ADMIN } from "@/server/roles";

export const GET = withAuth(SUPER_ADMIN, async (request, authed) => {
  return NextResponse.json(await fetchPendingApprovals(authed.client));
});

export const POST = withAuth(SUPER_ADMIN, async (request, authed) => {
  const { remnant_id } = await request.json();
  return NextResponse.json(
    await approveRemnant(authed.client, authed, Number(remnant_id)),
  );
});
