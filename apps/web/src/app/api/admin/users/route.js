import { NextResponse } from "next/server";
import { createAdminUser } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { SUPER_ADMIN } from "@/server/roles";

export const POST = withAuth(SUPER_ADMIN, async (request, authed) => {
  const body = await request.json();
  const origin = new URL(request.url).origin;
  return NextResponse.json(
    await createAdminUser(authed.client, body?.values || {}, { origin }),
    { status: 201 },
  );
});
