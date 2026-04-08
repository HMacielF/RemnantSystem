import { NextResponse } from "next/server";
import { clearAuthCookies, setSessionCookies } from "@/server/private-api";
import { createPublicAuthClient, isInactiveProfile, sanitizeNextPath } from "@/server/auth-utils";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const accessToken = String(body?.access_token || "").trim();
    const refreshToken = String(body?.refresh_token || "").trim();
    const expiresIn = Number(body?.expires_in) || 3600;

    if (!accessToken || !refreshToken) {
      return NextResponse.json({ error: "Missing session tokens." }, { status: 400 });
    }

    const supabase = createPublicAuthClient();
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user?.id) {
      const response = NextResponse.json({ error: "Invalid session." }, { status: 401 });
      return clearAuthCookies(response);
    }

    if (await isInactiveProfile(data.user.id)) {
      const response = NextResponse.json({ error: "Your account is inactive." }, { status: 403 });
      return clearAuthCookies(response);
    }

    const response = NextResponse.json({ ok: true, next: sanitizeNextPath(body?.next, "/manage") });
    return setSessionCookies(response, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
    });
  } catch (error) {
    console.error("Session bootstrap failed:", error);
    return NextResponse.json(
      { error: error?.message || "Unable to create the portal session." },
      { status: 500 },
    );
  }
}
