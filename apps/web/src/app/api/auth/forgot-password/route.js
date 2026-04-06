import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function POST(request) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim();

  if (!email) {
    return NextResponse.redirect(new URL("/error?msg=Email%20is%20required", request.url));
  }

  try {
    const supabase = createSupabase();
    const origin = new URL(request.url).origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/set-password`,
    });

    if (error) {
      return NextResponse.redirect(
        new URL(`/error?msg=${encodeURIComponent(error.message)}`, request.url),
      );
    }

    return NextResponse.redirect(new URL("/password-reset-sent", request.url));
  } catch (error) {
    console.error("Forgot password failed:", error);
    return NextResponse.redirect(
      new URL(`/error?msg=${encodeURIComponent(error?.message || "Password reset failed")}`, request.url),
    );
  }
}
