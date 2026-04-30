import { NextResponse } from "next/server";
import {
  deleteRemnantImage,
  unlinkRemnantImage,
  updateRemnantImage,
} from "@/server/private-api";
import { withAuth } from "@/server/withApiHandler";
import { MANAGERS } from "@/server/roles";
import { parseRemnantRequestBody } from "@/server/parseRemnantRequestBody";

export const PATCH = withAuth(MANAGERS, async (request, authed, { params }) => {
  const { id } = await params;
  const body = await parseRemnantRequestBody(request);
  return NextResponse.json(
    await updateRemnantImage(authed.client, authed, Number(id), body),
  );
});

export const DELETE = withAuth(MANAGERS, async (request, authed, { params }) => {
  const { id } = await params;
  let body = {};
  try {
    body = await request.json();
  } catch (_err) {
    /* allow empty body — defaults to unlink */
  }
  const removeFromStorage = body?.removeFromStorage === true;
  const handler = removeFromStorage ? deleteRemnantImage : unlinkRemnantImage;
  return NextResponse.json(
    await handler(authed.client, authed, Number(id)),
  );
});
