import { NextResponse } from "next/server";
import {
  applyAuthCookies,
  createRequiredAuthedContext,
  createAdminRow,
  deleteAdminRow,
  fetchAdminTableRows,
  updateAdminRow,
} from "@/server/private-api";

function errorStatus(message) {
  if (/Unknown admin table/i.test(message)) return 404;
  if (/Missing identifier field|No editable fields provided|Invalid /i.test(message)) return 400;
  return 500;
}

export async function GET(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    const searchParams = new URL(request.url).searchParams;
    return applyAuthCookies(
      NextResponse.json(await fetchAdminTableRows(authed.client, resolvedParams.table, searchParams)),
      authed,
    );
  } catch (error) {
    console.error("Failed to load admin table rows:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to load admin table rows" },
      { status: errorStatus(error.message || "") },
    ), authed);
  }
}

export async function POST(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    const body = await request.json();
    return applyAuthCookies(NextResponse.json(
      await createAdminRow(authed.client, resolvedParams.table, body?.values || {}),
      { status: 201 },
    ), authed);
  } catch (error) {
    console.error("Failed to create admin row:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to create row" },
      { status: errorStatus(error.message || "") },
    ), authed);
  }
}

export async function PATCH(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    const body = await request.json();
    return applyAuthCookies(NextResponse.json(
      await updateAdminRow(authed.client, resolvedParams.table, body?.identifier || {}, body?.values || {}),
    ), authed);
  } catch (error) {
    console.error("Failed to update admin row:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to update row" },
      { status: errorStatus(error.message || "") },
    ), authed);
  }
}

export async function DELETE(request, { params }) {
  const authed = await createRequiredAuthedContext(request, ["super_admin"]);
  if (authed?.errorResponse) return authed.errorResponse;

  try {
    const resolvedParams = await params;
    const body = await request.json();
    return applyAuthCookies(NextResponse.json(
      await deleteAdminRow(authed.client, resolvedParams.table, body?.identifier || {}),
    ), authed);
  } catch (error) {
    console.error("Failed to delete admin row:", error);
    return applyAuthCookies(NextResponse.json(
      { error: error.message || "Failed to delete row" },
      { status: errorStatus(error.message || "") },
    ), authed);
  }
}
