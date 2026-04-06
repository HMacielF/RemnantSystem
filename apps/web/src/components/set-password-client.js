"use client";

import { useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AuthShell from "@/components/auth-shell";

function readAuthParams(searchParams) {
  const hash =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.hash.replace(/^#/, ""));

  return {
    access_token:
      hash.get("access_token") || searchParams.get("access_token") || "",
    refresh_token:
      hash.get("refresh_token") || searchParams.get("refresh_token") || "",
    type: hash.get("type") || searchParams.get("type") || "",
  };
}

export default function SetPasswordClient() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState({
    tone: "neutral",
    message: "Validating your secure link...",
  });
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scriptsReady, setScriptsReady] = useState({
    supabase: false,
    config: false,
  });

  async function handleScriptReady(scriptKey) {
    setScriptsReady((current) => {
      const nextState = { ...current, [scriptKey]: true };

      if (
        nextState.supabase &&
        nextState.config &&
        !ready &&
        status.message === "Validating your secure link..."
      ) {
        window.setTimeout(() => {
          handleReady();
        }, 0);
      }

      return nextState;
    });
  }

  async function handleReady() {
    const config = window.__SUPABASE_CONFIG__ || {};
    if (!config.url || !config.anonKey || !window.supabase?.createClient) {
      setStatus({
        tone: "error",
        message: "Supabase client config is missing.",
      });
      return;
    }

    const params = readAuthParams(searchParams);
    if (!params.access_token || !params.refresh_token) {
      setStatus({
        tone: "error",
        message: "This invite or reset link is invalid or has already been used.",
      });
      return;
    }

    const supabase = window.supabase.createClient(config.url, config.anonKey);
    const { error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });

    if (error) {
      setStatus({
        tone: "error",
        message: error.message || "Unable to validate this link.",
      });
      return;
    }

    setReady(true);
    setStatus({
      tone: "neutral",
      message:
        params.type === "invite"
          ? "Invite accepted. Choose a password to activate your account."
          : "Choose a new password for your account.",
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    const password = event.currentTarget.password.value;
    const confirmPassword = event.currentTarget.confirmPassword.value;

    if (password.length < 8) {
      setStatus({
        tone: "error",
        message: "Password must be at least 8 characters.",
      });
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setStatus({
        tone: "error",
        message: "Passwords do not match.",
      });
      setLoading(false);
      return;
    }

    const config = window.__SUPABASE_CONFIG__ || {};
    const supabase = window.supabase?.createClient?.(config.url, config.anonKey);
    if (!supabase) {
      setStatus({
        tone: "error",
        message: "Unable to save password right now.",
      });
      setLoading(false);
      return;
    }

    setStatus({
      tone: "neutral",
      message: "Saving your password...",
    });

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setStatus({
        tone: "error",
        message: error.message || "Unable to save password.",
      });
      setLoading(false);
      return;
    }

    setReady(false);
    setStatus({
      tone: "success",
      message: "Password saved. You can log in now.",
    });

    window.setTimeout(() => {
      window.location.href = "/portal";
    }, 1200);
  }

  const statusColor =
    status.tone === "error"
      ? "text-[#b42318]"
      : status.tone === "success"
        ? "text-[#067647]"
        : "text-[#6d584b]";

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

      <AuthShell
        eyebrow="Secure Access"
        title="Set your password and get back into the workspace."
        description="This secure page finishes your invite or password reset so you can return to live remnant management without waiting on manual setup."
        cardEyebrow="Password Setup"
        cardTitle="Choose a password"
      >
        <p className={`rounded-2xl border border-[#f0e0d4] bg-[#fff9f4] px-4 py-4 text-sm leading-6 ${statusColor}`}>
          {status.message}
        </p>

        {ready ? (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
              New Password
              <input
                type="password"
                name="password"
                placeholder="At least 8 characters"
                minLength={8}
                required
                className="mt-2 h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-medium normal-case tracking-normal text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
              />
            </label>

            <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
              Confirm Password
              <input
                type="password"
                name="confirmPassword"
                placeholder="Re-enter your password"
                minLength={8}
                required
                className="mt-2 h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-medium normal-case tracking-normal text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#232323] px-6 text-sm font-semibold uppercase tracking-[0.16em] text-white shadow-lg shadow-[#232323]/15 transition-all hover:-translate-y-0.5 hover:bg-[#E78B4B] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Saving..." : "Save Password"}
            </button>
          </form>
        ) : null}

        <div className="mt-5 text-sm">
          <Link
            href="/portal"
            className="font-medium text-[#b85b1b] transition hover:text-[#8f4517]"
          >
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    </>
  );
}
