"use client";

import Link from "next/link";

export default function PublicHeader() {
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
            className="text-[color:var(--qc-ink-1)] hover:text-[color:var(--qc-ink-2)]"
          >
            Inventory
          </Link>
          <Link
            href="/manage"
            className="text-[color:var(--qc-ink-2)] hover:text-[color:var(--qc-ink-1)]"
          >
            Manage
          </Link>
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
        </nav>
      </div>
    </header>
  );
}
