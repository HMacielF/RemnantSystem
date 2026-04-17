import { NextResponse } from "next/server";
import { fetchRemnantEnrichment } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { STAFF } from "@/server/roles";

export const POST = withAuth(STAFF, async (request, authed) => {
  const body = await request.json();
  return NextResponse.json(
    await fetchRemnantEnrichment(request, body?.ids, authed),
  );
});
