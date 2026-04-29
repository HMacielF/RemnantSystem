import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function requireEnv(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function envConfig() {
  return {
    url: requireEnv(process.env.SUPABASE_URL, "SUPABASE_URL is required"),
    anonKey: requireEnv(
      process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY,
      "SUPABASE_ANON_KEY or SUPABASE_KEY is required",
    ),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

export function createPublicAuthClient() {
  const { url, anonKey } = envConfig();
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
}

/**
 * Variant of the public auth client that persists PKCE state in cookies on
 * the request/response — required for the Google OAuth flow because the
 * code_verifier needs to round-trip between /api/auth/google (start) and
 * /api/auth/callback (exchange) across separate serverless invocations.
 *
 * Returns the client plus an `applyCookies(response)` function that flushes
 * any cookie writes the SDK queued onto the outgoing NextResponse.
 */
export function createCookieAuthClient(request) {
  const { url, anonKey } = envConfig();
  const writes = [];
  const storage = {
    getItem(key) {
      return request.cookies.get(key)?.value || null;
    },
    setItem(key, value) {
      writes.push({ key, value });
    },
    removeItem(key) {
      writes.push({ key, value: null });
    },
  };

  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
      storage,
      storageKey: "sb-pkce",
    },
  });

  function applyCookies(response) {
    if (!response) return response;
    const secure = process.env.NODE_ENV === "production";
    for (const { key, value } of writes) {
      if (value === null || value === undefined) {
        response.cookies.set(key, "", {
          httpOnly: true,
          sameSite: "lax",
          secure,
          path: "/",
          maxAge: 0,
        });
      } else {
        response.cookies.set(key, value, {
          httpOnly: true,
          sameSite: "lax",
          secure,
          path: "/",
          maxAge: 600,
        });
      }
    }
    return response;
  }

  return { supabase, applyCookies };
}

export function createServiceAuthClient() {
  const { url, serviceRoleKey } = envConfig();
  if (!serviceRoleKey) return null;

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function isInactiveProfile(userId) {
  const serviceClient = createServiceAuthClient();
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

export function errorRedirect(request, reason, message) {
  const url = new URL("/error", request.url);
  if (reason) {
    url.searchParams.set("reason", reason);
  }
  if (message) {
    url.searchParams.set("msg", message);
  }
  return NextResponse.redirect(url, { status: 303 });
}

export function sanitizeNextPath(value, fallback = "/manage") {
  const next = String(value || "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
