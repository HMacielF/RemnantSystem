"use client";

import Link from "next/link";

export default function PublicFooter({ slabCount }) {
  const count = Number.isFinite(slabCount) ? slabCount : 0;
  const year = new Date().getFullYear();

  return (
    <footer
      className="font-inter w-full bg-[color:var(--qc-bg-page)]"
      style={{ borderTop: "1px solid var(--qc-line)" }}
    >
      <div className="mx-auto w-full max-w-[1680px] px-8 py-14">
        <div className="grid gap-12 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <p className="font-italic-accent text-[22px] leading-snug text-[color:var(--qc-ink-2)]">
              Less waste. More kitchens.
            </p>
            <p className="mt-3 max-w-[18ch] text-[28px] font-medium leading-tight tracking-[-0.015em] text-[color:var(--qc-ink-1)]">
              Quick Countertop &amp; Cabinets
            </p>
            <p className="mt-4">
              <a
                href="https://quickcountertop.com"
                className="text-[15px] text-[color:var(--qc-ink-1)]"
                style={{
                  textDecoration: "underline",
                  textDecorationColor: "var(--qc-line-strong)",
                  textUnderlineOffset: 4,
                }}
              >
                quickcountertop.com →
              </a>
            </p>
            <div className="mt-6 inline-flex items-center gap-2 text-[12px] text-[color:var(--qc-ink-2)]">
              <span
                aria-hidden="true"
                className="qc-pulse inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: "var(--qc-status-available-dot)" }}
              />
              <span style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>
                {count} {count === 1 ? "slab" : "slabs"} live
              </span>
            </div>
          </div>

          <div>
            <p className="text-[10.5px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
              Visit
            </p>
            <ul className="mt-4 space-y-2 text-[14px] leading-relaxed text-[color:var(--qc-ink-2)]">
              <li>By appointment only</li>
              <li>Mon–Fri · 8:00am – 5:00pm</li>
              <li>
                <a
                  href="mailto:hello@quickcountertop.com"
                  className="text-[color:var(--qc-ink-1)] hover:underline"
                >
                  hello@quickcountertop.com
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-[10.5px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
              Inventory
            </p>
            <ul className="mt-4 space-y-2 text-[14px] text-[color:var(--qc-ink-2)]">
              <li>
                <Link href="/" className="hover:text-[color:var(--qc-ink-1)]">
                  Browse remnants
                </Link>
              </li>
              <li>
                <Link href="/?status=available" className="hover:text-[color:var(--qc-ink-1)]">
                  Available now
                </Link>
              </li>
              <li>
                <Link href="/?status=sold" className="hover:text-[color:var(--qc-ink-1)]">
                  Sold archive
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div
          className="mt-12 flex flex-col items-start justify-between gap-3 pt-6 text-[12px] text-[color:var(--qc-ink-3)] sm:flex-row sm:items-center"
          style={{ borderTop: "1px solid var(--qc-line)" }}
        >
          <span>© {year} Quick Countertop &amp; Cabinets</span>
          <Link
            href="/portal"
            className="text-[color:var(--qc-ink-2)]"
            style={{
              textDecoration: "underline",
              textDecorationColor: "var(--qc-line-strong)",
              textUnderlineOffset: 4,
            }}
          >
            Staff sign in →
          </Link>
        </div>
      </div>
    </footer>
  );
}
