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
    const response = NextResponse.json(await fetchSlabs());
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
