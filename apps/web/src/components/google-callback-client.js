"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { useSearchParams } from "next/navigation";
import AuthShell from "@/components/auth-shell";

export default function GoogleCallbackClient() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Preparing Google sign-in...");
  const [scriptsReady, setScriptsReady] = useState({
    supabase: false,
    config: false,
  });

  function readHashParams() {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.hash.replace(/^#/, ""));
  }

  useEffect(() => {
    if (!scriptsReady.supabase || !scriptsReady.config) return;

    let active = true;

    async function completeSignIn() {
      try {
        const config = window.__SUPABASE_CONFIG__ || {};
        if (!config.url || !config.anonKey || !window.supabase?.createClient) {
          throw new Error("Supabase client config is missing.");
        }

        const code = searchParams.get("code");
        const next = searchParams.get("next") || "/manage";
        const hashParams = readHashParams();
        let accessToken = hashParams.get("access_token") || "";
        let refreshToken = hashParams.get("refresh_token") || "";
        let expiresIn = Number(hashParams.get("expires_in")) || 3600;

        if (!accessToken || !refreshToken) {
          if (!code) {
            throw new Error("Missing Google sign-in session.");
          }

          const supabase = window.supabase.createClient(config.url, config.anonKey, {
            auth: {
              flowType: "pkce",
            },
          });

          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error || !data?.session?.access_token || !data?.session?.refresh_token) {
            throw new Error(error?.message || "Unable to finish Google sign-in.");
          }

          accessToken = data.session.access_token;
          refreshToken = data.session.refresh_token;
          expiresIn = Number(data.session.expires_in) || 3600;
        }

        if (!active) return;
        setStatus("Finishing sign-in...");

        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: expiresIn,
            next,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || "Unable to create the portal session.");
        }

        window.location.href = next.startsWith("/") ? next : "/manage";
      } catch (error) {
        const message = encodeURIComponent(error?.message || "Unable to finish Google sign-in.");
        window.location.href = `/error?reason=oauth_callback_failed&msg=${message}`;
      }
    }

    completeSignIn();

    return () => {
      active = false;
    };
  }, [scriptsReady, searchParams]);

  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
        strategy="afterInteractive"
        onLoad={() => setScriptsReady((current) => ({ ...current, supabase: true }))}
      />
      <Script
        src="/api/auth/config"
        strategy="afterInteractive"
        onLoad={() => setScriptsReady((current) => ({ ...current, config: true }))}
      />

      <AuthShell
        eyebrow="Google Sign-In"
        title="Finishing your sign-in."
        description="We are validating your Google account and connecting it to the management workspace."
        cardEyebrow="Secure Login"
        cardTitle="Please wait"
      >
        <p className="rounded-2xl border border-[#f0e0d4] bg-[#fff9f4] px-4 py-4 text-sm leading-6 text-[#6d584b]">
          {status}
        </p>
      </AuthShell>
    </>
  );
}
