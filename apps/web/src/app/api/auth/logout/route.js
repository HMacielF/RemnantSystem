import { NextResponse } from "next/server";
import { clearAuthCookies } from "@/server/private-api";

function buildResponse(request) {
  const response = NextResponse.redirect(new URL("/portal", request.url));
  return clearAuthCookies(response);
}

export async function GET(request) {
  return buildResponse(request);
}

export async function POST(request) {
  return buildResponse(request);
}
