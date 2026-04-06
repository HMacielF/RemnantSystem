import { NextResponse } from "next/server";

export async function GET() {
  const payload = `window.__SUPABASE_CONFIG__ = ${JSON.stringify({
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || "",
  })};`;

  return new NextResponse(payload, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
