import { NextResponse } from "next/server";

function corsHeaders(methods = ["GET", "OPTIONS"]) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods.join(", "),
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function withPublicCors(response, methods) {
  const headers = corsHeaders(methods);
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export function buildPublicOptionsResponse(methods) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(methods),
  });
}
