"use client";

import Link from "next/link";

const APP_VERSION = "v 2.4";

export default function PrivateFooter() {
  const year = new Date().getFullYear();

  return (
    <footer
      className="font-inter w-full bg-[color:var(--qc-bg-page)]"
      style={{ borderTop: "1px solid var(--qc-line)" }}
    >
      <div className="mx-auto w-full max-w-[1680px] px-8 py-14">
        <div>
          <p className="font-italic-accent text-[22px] leading-snug text-[color:var(--qc-ink-2)]">
            Built to keep remnant inventory clear.
          </p>
          <p className="mt-3 max-w-[20ch] text-[28px] font-medium leading-tight tracking-[-0.015em] text-[color:var(--qc-ink-1)]">
            Quick Countertop &amp; Cabinets
          </p>
          <p className="mt-4 text-[10.5px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
            Internal Workspace
          </p>
        </div>

        <div
          className="mt-12 flex flex-col items-start justify-between gap-3 pt-6 text-[12px] text-[color:var(--qc-ink-3)] sm:flex-row sm:items-center"
          style={{ borderTop: "1px solid var(--qc-line)" }}
        >
          <span>© {year} Quick Countertop &amp; Cabinets</span>
          <span className="flex flex-wrap items-center gap-2">
            <span>Designed &amp; ideated by</span>
            <Link
              href="https://github.com/HMacielF"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[color:var(--qc-ink-2)] underline decoration-[color:var(--qc-line-strong)] underline-offset-4 transition-colors hover:text-[color:var(--qc-orange)] hover:decoration-[color:var(--qc-orange)]"
            >
              EndoM14
            </Link>
            <span aria-hidden="true">·</span>
            <span style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>
              {APP_VERSION}
            </span>
          </span>
        </div>
      </div>
    </footer>
  );
}
