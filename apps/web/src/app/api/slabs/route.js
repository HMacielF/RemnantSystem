import { NextResponse } from "next/server";
import {
  applyAuthCookies,
  createRequiredAuthedContext,
  fetchSlabs,
} from "@/server/private-api";

export async function GET(request) {
  const authContext = await createRequiredAuthedContext(request, [
    "super_admin",
  ]);

  if (authContext?.errorResponse) {
    return authContext.errorResponse;
  }

  try {
    const { searchParams } = new URL(request.url);
    const response = NextResponse.json(await fetchSlabs(authContext.client, {
      search: searchParams.get("search") || "",
      brand: searchParams.get("brand") || "",
      supplier: searchParams.get("supplier") || "",
      material: searchParams.get("material") || "",
      finish: searchParams.get("finish") || "",
      thickness: searchParams.get("thickness") || "",
      priceSort: searchParams.get("priceSort") || "default",
      page: searchParams.get("page") || "1",
      pageSize: searchParams.get("pageSize") || "24",
    }));
    return applyAuthCookies(response, authContext);
  } catch (error) {
    console.error("Failed to fetch slab catalog:", error);
    const response = NextResponse.json(
      { error: "Failed to fetch slab catalog" },
      { status: 500 },
    );
    return applyAuthCookies(response, authContext);
  }
}
