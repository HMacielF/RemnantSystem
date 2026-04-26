"use client";

import { useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AuthShell, {
  AUTH_INPUT_CLASS,
  AUTH_INPUT_STYLE,
  AUTH_LABEL_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_PRIMARY_BUTTON_STYLE,
} from "@/components/auth-shell";

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
      ? "text-[color:var(--qc-status-sold-fg)]"
      : status.tone === "success"
        ? "text-[color:var(--qc-status-available-fg)]"
        : "text-[color:var(--qc-ink-2)]";

  const statusAccent =
    status.tone === "error"
      ? "var(--qc-status-sold-dot)"
      : status.tone === "success"
        ? "var(--qc-status-available-dot)"
        : "var(--qc-line-strong)";

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
        eyebrow="Secure access"
        title={
          <>
            Set your password and get{" "}
            <span className="font-italic-accent text-[color:var(--qc-ink-2)]">
              back to work.
            </span>
          </>
        }
        description="This secure page finishes your invite or password reset so you can return to live remnant management without waiting on manual setup."
        cardEyebrow="Password setup"
        cardTitle="Choose a password"
      >
        <p
          className={`px-4 py-3 text-[13px] leading-[1.5] ${statusColor}`}
          style={{
            border: "1px solid var(--qc-line)",
            borderLeft: `2px solid ${statusAccent}`,
            borderRadius: "var(--qc-radius-sharp)",
          }}
        >
          {status.message}
        </p>

        {ready ? (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="set-password-new" className={AUTH_LABEL_CLASS}>
                New password
              </label>
              <div className="mt-2">
                <input
                  id="set-password-new"
                  type="password"
                  name="password"
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                  className={AUTH_INPUT_CLASS}
                  style={AUTH_INPUT_STYLE}
                />
              </div>
            </div>

            <div>
              <label htmlFor="set-password-confirm" className={AUTH_LABEL_CLASS}>
                Confirm password
              </label>
              <div className="mt-2">
                <input
                  id="set-password-confirm"
                  type="password"
                  name="confirmPassword"
                  placeholder="Re-enter your password"
                  minLength={8}
                  required
                  className={AUTH_INPUT_CLASS}
                  style={AUTH_INPUT_STYLE}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={AUTH_PRIMARY_BUTTON_CLASS}
              style={AUTH_PRIMARY_BUTTON_STYLE}
            >
              {loading ? "Saving…" : "Save password"}
            </button>
          </form>
        ) : null}

        <div
          className="mt-7 pt-5 text-[12px]"
          style={{ borderTop: "1px solid var(--qc-line)" }}
        >
          <Link
            href="/portal"
            className="text-[color:var(--qc-ink-2)] hover:text-[color:var(--qc-ink-1)]"
            style={{
              textDecoration: "underline",
              textDecorationColor: "var(--qc-line-strong)",
              textUnderlineOffset: 4,
            }}
          >
            ← Back to sign in
          </Link>
        </div>
      </AuthShell>
    </>
  );
}
