import { NextResponse } from "next/server";
import { processHoldExpirations } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { MANAGERS } from "@/server/roles";

export const POST = withAuth(MANAGERS, async (request, authed) => {
  return NextResponse.json(
    await processHoldExpirations(authed.client, authed),
  );
});
