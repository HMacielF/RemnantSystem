import { NextResponse } from "next/server";
import { fetchSlabById, updateSlab } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { SUPER_ADMIN } from "@/server/roles";

export const GET = withAuth(SUPER_ADMIN, async (request, authed, { params }) => {
  const { id } = await params;
  return NextResponse.json(await fetchSlabById(authed.client, Number(id)));
});

export const PATCH = withAuth(SUPER_ADMIN, async (request, authed, { params }) => {
  const { id } = await params;
  const body = await request.json();
  return NextResponse.json(
    await updateSlab(authed.client, authed, Number(id), body),
  );
});
