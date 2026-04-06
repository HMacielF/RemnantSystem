import { NextResponse } from "next/server";
import { proxyImage } from "@/server/private-api";

export async function GET(request) {
  try {
    const target = new URL(request.url).searchParams.get("url") || "";
    const payload = await proxyImage(target);
    return new NextResponse(payload.buffer, {
      status: 200,
      headers: {
        "Content-Type": payload.contentType,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("Failed to proxy image:", error);
    return NextResponse.json(
      { error: error.message || "Failed to proxy image" },
      { status: error.statusCode || 500 },
    );
  }
}
