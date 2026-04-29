import { NextResponse } from "next/server";
import {
  createCookieAuthClient,
  errorRedirect,
  sanitizeNextPath,
} from "@/server/auth-utils";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const next = sanitizeNextPath(url.searchParams.get("next"), "/manage");

    const canonical = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    if (canonical && url.origin !== canonical) {
      // Make sure the OAuth start runs on the same host the callback will
      // redirect to, otherwise the PKCE verifier cookie is unreachable.
      return NextResponse.redirect(
        `${canonical}${url.pathname}${url.search}`,
        { status: 303 },
      );
    }

    const origin = canonical || url.origin;
    const { supabase, applyCookies } = createCookieAuthClient(request);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error || !data?.url) {
      return errorRedirect(request, "oauth_start_failed", error?.message || "Google sign-in is unavailable.");
    }

    const response = NextResponse.redirect(data.url, { status: 303 });
    return applyCookies(response);
  } catch (error) {
    console.error("Google sign-in start failed:", error);
    return errorRedirect(request, "oauth_start_failed", error?.message || "Google sign-in is unavailable.");
  }
}
