import { NextResponse } from "next/server";
import { fetchAdminMeta } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { SUPER_ADMIN } from "@/server/roles";

export const GET = withAuth(SUPER_ADMIN, async () => {
  return NextResponse.json(fetchAdminMeta());
});
