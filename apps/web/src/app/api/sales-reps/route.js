import { NextResponse } from "next/server";
import { fetchSalesRepRows, getWriteClient } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { STAFF } from "@/server/roles";

export const GET = withAuth(STAFF, async (request, authed) => {
  return NextResponse.json(
    await fetchSalesRepRows(getWriteClient(authed.client)),
  );
});
