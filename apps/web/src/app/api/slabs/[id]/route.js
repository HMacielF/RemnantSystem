import { NextResponse } from "next/server";
import { applyAuthCookies, createRequiredAuthedContext, fetchSlabById, updateSlab } from "@/server/private-api";

export async function GET(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    return applyAuthCookies(
      NextResponse.json(await fetchSlabById(authed.client, Number(resolvedParams.id))),
      authed,
    );
  } catch (error) {
    console.error("Failed to fetch slab:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to fetch slab" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}

export async function PATCH(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    const body = await request.json();
    return applyAuthCookies(
      NextResponse.json(await updateSlab(authed.client, authed, Number(resolvedParams.id), body)),
      authed,
    );
  } catch (error) {
    console.error("Failed to update slab:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to update slab" },
      { status: error.statusCode || 500 },
    ), authed);
  }
}
