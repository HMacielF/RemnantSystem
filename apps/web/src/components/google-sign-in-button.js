"use client";

import { useState } from "react";
import Script from "next/script";

export default function GoogleSignInButton() {
  const [scriptsReady, setScriptsReady] = useState({
    supabase: false,
    config: false,
  });
  const [loading, setLoading] = useState(false);

  function handleScriptReady(scriptKey) {
    setScriptsReady((current) => ({ ...current, [scriptKey]: true }));
  }

  async function handleGoogleSignIn() {
    if (loading) return;

    const config = window.__SUPABASE_CONFIG__ || {};
    if (!config.url || !config.anonKey || !window.supabase?.createClient) {
      window.location.href = "/error?reason=oauth_start_failed&msg=Supabase%20client%20config%20is%20missing.";
      return;
    }

    setLoading(true);
    try {
      const supabase = window.supabase.createClient(config.url, config.anonKey);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/manage`,
        },
      });

      if (error) {
        window.location.href = `/error?reason=oauth_start_failed&msg=${encodeURIComponent(error.message || "Google sign-in is unavailable.")}`;
      }
    } catch (error) {
      window.location.href = `/error?reason=oauth_start_failed&msg=${encodeURIComponent(error?.message || "Google sign-in is unavailable.")}`;
    } finally {
      setLoading(false);
    }
  }

  const disabled = !scriptsReady.supabase || !scriptsReady.config || loading;

  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
        strategy="afterInteractive"
        onLoad={() => handleScriptReady("supabase")}
      />
      <Script
        src="/api/auth/config"
        strategy="afterInteractive"
        onLoad={() => handleScriptReady("config")}
      />

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={disabled}
        className="mt-4 inline-flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-[#d8c7b8] bg-white px-6 text-sm font-semibold uppercase tracking-[0.12em] text-[#2d2623] shadow-sm transition hover:-translate-y-0.5 hover:border-[#E78B4B] hover:text-[#241c18] disabled:cursor-not-allowed disabled:opacity-70"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
          <path fill="#EA4335" d="M12 10.2v3.95h5.49c-.24 1.27-.96 2.34-2.04 3.06l3.3 2.56c1.92-1.77 3.03-4.38 3.03-7.48 0-.72-.06-1.42-.19-2.09z" />
          <path fill="#4285F4" d="M12 22c2.75 0 5.05-.91 6.73-2.47l-3.3-2.56c-.91.61-2.08.98-3.43.98-2.64 0-4.88-1.78-5.68-4.18H2.9v2.64A10 10 0 0 0 12 22z" />
          <path fill="#FBBC05" d="M6.32 13.77A5.99 5.99 0 0 1 6 12c0-.62.11-1.23.32-1.77V7.59H2.9A10 10 0 0 0 2 12c0 1.61.39 3.13 1.09 4.41z" />
          <path fill="#34A853" d="M12 6.05c1.49 0 2.82.51 3.87 1.5l2.9-2.9C17.04 3.03 14.75 2 12 2A10 10 0 0 0 2.9 7.59l3.42 2.64c.8-2.4 3.04-4.18 5.68-4.18z" />
        </svg>
        {loading ? "Connecting..." : "Continue With Google"}
      </button>
    </>
  );
}
