import { NextResponse } from "next/server";
import { updateRemnantImage } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { MANAGERS } from "@/server/roles";

export const PATCH = withAuth(MANAGERS, async (request, authed, { params }) => {
  const { id } = await params;
  const body = await request.json();
  return NextResponse.json(
    await updateRemnantImage(authed.client, authed, Number(id), body),
  );
});
