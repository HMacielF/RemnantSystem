import { NextResponse } from "next/server";
import { fetchNextStoneId } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { MANAGERS } from "@/server/roles";

export const GET = withAuth(MANAGERS, async (request, authed) => {
  return NextResponse.json({
    nextStoneId: await fetchNextStoneId(authed.client),
  });
});
