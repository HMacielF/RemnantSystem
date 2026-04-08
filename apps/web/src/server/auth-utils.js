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
    },
  });
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
