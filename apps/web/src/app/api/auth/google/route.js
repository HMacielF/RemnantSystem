import { NextResponse } from "next/server";
import { createPublicAuthClient, errorRedirect, sanitizeNextPath } from "@/server/auth-utils";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const next = sanitizeNextPath(url.searchParams.get("next"), "/manage");
    const origin = (process.env.NEXT_PUBLIC_SITE_URL || url.origin).replace(/\/$/, "");
    const supabase = createPublicAuthClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error || !data?.url) {
      return errorRedirect(request, "oauth_start_failed", error?.message || "Google sign-in is unavailable.");
    }

    return NextResponse.redirect(data.url, { status: 303 });
  } catch (error) {
    console.error("Google sign-in start failed:", error);
    return errorRedirect(request, "oauth_start_failed", error?.message || "Google sign-in is unavailable.");
  }
}
