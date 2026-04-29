"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function deriveInitials(profile) {
  const name = String(profile?.full_name || "").trim();
  if (name) {
    const parts = name.split(/\s+/).slice(0, 2);
    return parts.map((part) => part[0]).join("").toUpperCase();
  }
  const email = String(profile?.email || "").trim();
  return email ? email[0].toUpperCase() : "?";
}

function deriveDisplayName(profile) {
  return (
    String(profile?.full_name || "").trim() ||
    String(profile?.email || "").trim() ||
    "Account"
  );
}

export default function PublicHeader({ initialProfile = null } = {}) {
  const [profile, setProfile] = useState(initialProfile);

  useEffect(() => {
    let cancelled = false;

    async function probeSession() {
      try {
        const res = await fetch("/api/me", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          setProfile(null);
          return;
        }
        const payload = await res.json().catch(() => ({}));
        setProfile(payload?.profile || null);
      } catch {
        if (cancelled) return;
        setProfile(null);
      }
    }

    probeSession();

    function handleFocus() {
      probeSession();
    }
    function handlePageShow(event) {
      if (event.persisted) probeSession();
    }
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  const isAuthed = Boolean(profile);

  return (
    <header
      className="font-inter w-full bg-[color:var(--qc-bg-page)]"
      style={{ borderBottom: "1px solid var(--qc-line)" }}
    >
      <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between px-8 py-5">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[color:var(--qc-ink-1)]"
          aria-label="Quick Countertop home"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center text-[15px] font-semibold text-white"
            style={{ backgroundColor: "var(--qc-orange)", borderRadius: "var(--qc-radius-sharp)" }}
          >
            Q
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold tracking-[-0.01em]">Quick Countertop</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
              & Cabinets
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-7 text-[14px]">
          <Link
            href="/"
            className="group inline-grid"
            aria-current="page"
          >
            <span aria-hidden="true" className="col-start-1 row-start-1 invisible font-semibold">
              Inventory
            </span>
            <span className="col-start-1 row-start-1 font-semibold text-[color:var(--qc-ink-1)] transition-colors group-hover:text-[color:var(--qc-orange)]">
              Inventory
            </span>
          </Link>
          {isAuthed ? (
            <Link href="/manage" className="group inline-grid">
              <span aria-hidden="true" className="col-start-1 row-start-1 invisible font-semibold">
                Manage
              </span>
              <span className="col-start-1 row-start-1 font-normal text-[color:var(--qc-ink-2)] transition-colors group-hover:font-semibold group-hover:text-[color:var(--qc-ink-1)]">
                Manage
              </span>
            </Link>
          ) : null}
          {isAuthed ? (
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-[color:var(--qc-ink-2)]">
                <span
                  aria-hidden="true"
                  className="inline-flex h-7 w-7 items-center justify-center text-[11px] font-semibold text-white"
                  style={{
                    backgroundColor: "var(--qc-ink-1)",
                    borderRadius: "var(--qc-radius-sharp)",
                  }}
                >
                  {deriveInitials(profile)}
                </span>
                <span className="hidden text-[13px] sm:inline">{deriveDisplayName(profile)}</span>
              </span>
              <a
                href="/api/auth/logout"
                className="text-[13px] text-[color:var(--qc-ink-2)] hover:text-[color:var(--qc-ink-1)]"
                style={{
                  textDecoration: "underline",
                  textDecorationColor: "var(--qc-line-strong)",
                  textUnderlineOffset: 4,
                }}
              >
                Sign out
              </a>
            </span>
          ) : (
            <Link
              href="/portal"
              className="inline-flex items-center px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#232323]"
              style={{
                backgroundColor: "var(--qc-ink-1)",
                borderRadius: "var(--qc-radius-sharp)",
              }}
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
