import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { setSessionCookies } from "@/server/private-api";

function createSupabase() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY/SUPABASE_KEY are required");
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createServiceSupabase() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function isInactiveProfile(userId) {
  const serviceClient = createServiceSupabase();
  if (!serviceClient || !userId) return false;

  const { data, error } = await serviceClient
    .from("profiles")
    .select("active")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Login profile lookup failed:", error);
    return false;
  }

  return data?.active === false;
}

function errorRedirect(request, reason, message) {
  const url = new URL("/error", request.url);
  if (reason) {
    url.searchParams.set("reason", reason);
  }
  if (message) {
    url.searchParams.set("msg", message);
  }
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return errorRedirect(request, "missing_credentials", "Email and password are required.");
  }

  try {
    const supabase = createSupabase();
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
