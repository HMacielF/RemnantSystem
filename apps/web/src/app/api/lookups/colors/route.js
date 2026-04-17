import { NextResponse } from "next/server";
import { createColorLookupRow } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { MANAGERS } from "@/server/roles";

export const POST = withAuth(MANAGERS, async (request, authed) => {
  const body = await request.json();
  const row = await createColorLookupRow(authed.client, body?.name);
  return NextResponse.json(row, { status: 201 });
});
