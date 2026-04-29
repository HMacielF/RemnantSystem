"use client";

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

export default function PrivateHeader({ profile }) {
  const isSuperAdmin = profile?.system_role === "super_admin";

  return (
    <header
      className="font-inter w-full bg-[color:var(--qc-bg-page)]"
      style={{ borderBottom: "1px solid var(--qc-line)" }}
    >
      <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-4 px-8 py-5">
        <Link
          href="/manage"
          className="inline-flex items-center gap-2 text-[color:var(--qc-ink-1)]"
          aria-label="Quick Countertop manage workspace"
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
              Manage Workspace
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-7 text-[14px]">
          <Link
            href="/"
            className="font-normal text-[color:var(--qc-ink-2)] transition-all hover:font-semibold hover:text-[color:var(--qc-ink-1)]"
          >
            Inventory
          </Link>
          <Link
            href="/manage"
            className="font-semibold text-[color:var(--qc-ink-1)] transition-all hover:text-[color:var(--qc-orange)]"
          >
            Manage
          </Link>
          {isSuperAdmin ? (
            <>
              <Link
                href="/slabs"
                className="hidden font-normal text-[color:var(--qc-ink-2)] transition-all hover:font-semibold hover:text-[color:var(--qc-ink-1)] md:inline"
              >
                Slabs
              </Link>
              <Link
                href="/admin"
                className="hidden font-normal text-[color:var(--qc-ink-2)] transition-all hover:font-semibold hover:text-[color:var(--qc-ink-1)] md:inline"
              >
                Admin
              </Link>
              <Link
                href="/manage/confirm"
                className="hidden font-normal text-[color:var(--qc-ink-2)] transition-all hover:font-semibold hover:text-[color:var(--qc-ink-1)] lg:inline"
              >
                Inventory Check
              </Link>
            </>
          ) : null}

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
              className="text-[13px] text-[color:var(--qc-ink-2)] transition-colors hover:text-[color:var(--qc-orange)]"
              style={{
                textDecoration: "underline",
                textDecorationColor: "var(--qc-line-strong)",
                textUnderlineOffset: 4,
              }}
            >
              Log out
            </a>
          </span>
        </nav>
      </div>
    </header>
  );
}
