import { NextResponse } from "next/server";
import { releaseHold } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { STAFF } from "@/server/roles";

export const POST = withAuth(STAFF, async (request, authed, { params }) => {
  const { id } = await params;
  return NextResponse.json(
    await releaseHold(authed.client, authed, Number(id)),
  );
});
