import { NextResponse } from "next/server";
import { fetchInventorySummary } from "@/server/private-api";
import { withPublic } from "@/server/withApiHandler";

export const GET = withPublic(async () => {
  return NextResponse.json(await fetchInventorySummary());
});
