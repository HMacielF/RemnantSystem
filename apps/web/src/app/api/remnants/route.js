import { NextResponse } from "next/server";
import { createRemnant, fetchPrivateRemnants } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { MANAGERS, STAFF } from "@/server/roles";

export const GET = withAuth(STAFF, async (request, authed) => {
  return NextResponse.json(await fetchPrivateRemnants(request, authed));
});

export const POST = withAuth(MANAGERS, async (request, authed) => {
  const body = await request.json();
  return NextResponse.json(await createRemnant(authed.client, authed, body), {
    status: 201,
  });
});
