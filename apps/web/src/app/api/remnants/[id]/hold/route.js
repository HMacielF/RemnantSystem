import { NextResponse } from "next/server";
import { fetchRemnantHold, saveHold } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { STAFF } from "@/server/roles";

export const GET = withAuth(STAFF, async (request, authed, { params }) => {
  const { id } = await params;
  return NextResponse.json(await fetchRemnantHold(authed.client, Number(id)));
});

export const POST = withAuth(STAFF, async (request, authed, { params }) => {
  const { id } = await params;
  const body = await request.json();
  return NextResponse.json(
    await saveHold(authed.client, authed, Number(id), body),
  );
});
