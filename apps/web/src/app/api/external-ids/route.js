import { NextResponse } from "next/server";
import { fetchExternalIdsSummary } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { MANAGERS } from "@/server/roles";

export const GET = withAuth(MANAGERS, async (_request, authed) => {
  return NextResponse.json(await fetchExternalIdsSummary(authed.client));
});
