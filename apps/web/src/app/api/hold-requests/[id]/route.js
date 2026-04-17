import { NextResponse } from "next/server";
import { updateHoldRequest } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { STAFF } from "@/server/roles";

export const PATCH = withAuth(STAFF, async (request, authed, { params }) => {
  const { id } = await params;
  const body = await request.json();
  return NextResponse.json(
    await updateHoldRequest(authed.client, authed.profile, Number(id), body),
  );
});
