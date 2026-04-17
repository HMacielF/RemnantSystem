import { NextResponse } from "next/server";
import { withAuth } from "@/server/withApiHandler";

export const GET = withAuth([], async (request, authed) => {
  return NextResponse.json({ profile: authed.profile });
});
