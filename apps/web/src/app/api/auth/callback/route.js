import { NextResponse } from "next/server";
import {
  createCookieAuthClient,
  errorRedirect,
  isInactiveProfile,
  sanitizeNextPath,
} from "@/server/auth-utils";
import { clearAuthCookies, setSessionCookies } from "@/server/private-api";

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeNextPath(requestUrl.searchParams.get("next"), "/manage");

  if (!code) {
    return errorRedirect(request, "oauth_callback_failed", "Missing Google sign-in code.");
  }

  try {
    const { supabase, applyCookies } = createCookieAuthClient(request);
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error || !data?.session?.access_token || !data?.user?.id) {
      return errorRedirect(request, "oauth_callback_failed", error?.message || "Unable to finish Google sign-in.");
    }

    if (await isInactiveProfile(data.user.id)) {
      const response = errorRedirect(request, "account_inactive");
      applyCookies(response);
      return clearAuthCookies(response);
    }

    const response = NextResponse.redirect(new URL(next, request.url), { status: 303 });
    applyCookies(response);
    return setSessionCookies(response, data.session);
  } catch (error) {
    console.error("Google sign-in callback failed:", error);
    return errorRedirect(request, "oauth_callback_failed", error?.message || "Unable to finish Google sign-in.");
  }
}
