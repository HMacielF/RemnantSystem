import { NextResponse } from "next/server";
import { updateRemnantImage } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { MANAGERS } from "@/server/roles";
import { parseRemnantRequestBody } from "@/server/parseRemnantRequestBody";

export const PATCH = withAuth(MANAGERS, async (request, authed, { params }) => {
  const { id } = await params;
  const body = await parseRemnantRequestBody(request);
  return NextResponse.json(
    await updateRemnantImage(authed.client, authed, Number(id), body),
  );
});
