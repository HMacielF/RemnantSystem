import { NextResponse } from "next/server";
import { proxyImage } from "@/server/private-api";
import { withPublic } from "@/server/withApiHandler";

export const GET = withPublic(async (request) => {
  const target = request.nextUrl.searchParams.get("url") || "";
  const payload = await proxyImage(target);
  return new NextResponse(payload.buffer, {
    status: 200,
    headers: {
      "Content-Type": payload.contentType,
      "Cache-Control": "public, max-age=300",
    },
  });
});
