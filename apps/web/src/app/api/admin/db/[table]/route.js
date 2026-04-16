/**
 * Hardened admin DB route
 * -----------------------
 * Changes vs original:
 *   1. Explicit allowlist check on `tableName` BEFORE touching the database.
 *      An unknown/injected name returns 404 immediately.
 *   2. Uses withAuth() so auth + cookie refresh are handled consistently.
 *   3. Tightens DELETE — requires valid JSON body with an `identifier` key.
 *   4. Tightens PATCH — requires an `identifier` key.
 */

import { NextResponse } from "next/server";
import {
  createAdminRow,
  deleteAdminRow,
  fetchAdminTableRows,
  updateAdminRow,
} from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { getAdminTableConfig } from "@/server/adminDbConfig";

const SUPER_ADMIN = ["super_admin"];

/** Resolve + validate table name, throw 404 if unknown. */
async function resolveTable(params) {
  const resolved = typeof params?.then === "function" ? await params : params;
  const tableName = String(resolved?.table ?? "").trim();

  if (!getAdminTableConfig(tableName)) {
    const err = new Error(`Unknown table: "${tableName}"`);
    err.statusCode = 404;
    throw err;
  }

  return tableName;
}

export const GET = withAuth(SUPER_ADMIN, async (request, authed, { params }) => {
  const tableName = await resolveTable(params);
  const result = await fetchAdminTableRows(authed.client, tableName, request.nextUrl.searchParams);
  return NextResponse.json(result);
});

export const POST = withAuth(SUPER_ADMIN, async (request, authed, { params }) => {
  const tableName = await resolveTable(params);
  const body = await request.json();
  const result = await createAdminRow(authed.client, tableName, body?.values ?? {});
  return NextResponse.json(result, { status: 201 });
});

export const PATCH = withAuth(SUPER_ADMIN, async (request, authed, { params }) => {
  const tableName = await resolveTable(params);
  const body = await request.json();

  if (!body?.identifier) {
    const err = new Error("identifier is required");
    err.statusCode = 400;
    throw err;
  }

  const result = await updateAdminRow(authed.client, tableName, body.identifier, body?.values ?? {});
  return NextResponse.json(result);
});

export const DELETE = withAuth(SUPER_ADMIN, async (request, authed, { params }) => {
  const tableName = await resolveTable(params);

  let body;
  try {
    body = await request.json();
  } catch {
    const err = new Error("Request body must be valid JSON with an identifier field");
    err.statusCode = 400;
    throw err;
  }

  if (!body?.identifier) {
    const err = new Error("identifier is required");
    err.statusCode = 400;
    throw err;
  }

  const result = await deleteAdminRow(authed.client, tableName, body.identifier);
  return NextResponse.json(result);
});
