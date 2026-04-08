import { NextResponse } from "next/server";
import { setSessionCookies } from "@/server/private-api";
import { createPublicAuthClient, errorRedirect, isInactiveProfile } from "@/server/auth-utils";

export async function POST(request) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return errorRedirect(request, "missing_credentials", "Email and password are required.");
  }

  try {
    const supabase = createPublicAuthClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data?.session?.access_token) {
      const errorMessage = String(error?.message || "Login failed");
      if (errorMessage.toLowerCase().includes("invalid login credentials")) {
        return errorRedirect(request, "invalid_login");
      }
      return errorRedirect(request, "login_failed", errorMessage);
    }

    if (await isInactiveProfile(data?.user?.id)) {
      return errorRedirect(request, "account_inactive");
    }

    const response = NextResponse.redirect(new URL("/manage", request.url), { status: 303 });
    return setSessionCookies(response, data.session);
  } catch (error) {
    console.error("Login failed:", error);
    return errorRedirect(request, "login_failed", error?.message || "Login failed");
  }
}
