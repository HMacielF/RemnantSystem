import { NextResponse } from "next/server";
import { fetchHoldRequests } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { STAFF } from "@/server/roles";

export const GET = withAuth(STAFF, async (request, authed) => {
  return NextResponse.json(
    await fetchHoldRequests(
      authed.client,
      authed.profile,
      request.nextUrl.searchParams,
    ),
  );
});
