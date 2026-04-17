import { NextResponse } from "next/server";
import { fetchSlabs } from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { SUPER_ADMIN } from "@/server/roles";

export const GET = withAuth(SUPER_ADMIN, async (request, authed) => {
  const { searchParams } = request.nextUrl;
  return NextResponse.json(
    await fetchSlabs(authed.client, {
      search: searchParams.get("search") || "",
      brand: searchParams.get("brand") || "",
      supplier: searchParams.get("supplier") || "",
      material: searchParams.get("material") || "",
      finish: searchParams.get("finish") || "",
      thickness: searchParams.get("thickness") || "",
      priceSort: searchParams.get("priceSort") || "default",
      page: searchParams.get("page") || "1",
      pageSize: searchParams.get("pageSize") || "24",
    }),
  );
});
