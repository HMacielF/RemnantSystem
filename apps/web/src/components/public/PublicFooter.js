"use client";

import Link from "next/link";

const ADDRESS_LINES = ["18860 Woodfield Rd, Unit J", "Gaithersburg, MD 20878"];
const GET_DIRECTIONS_URL =
  "https://www.google.com/maps/dir/?api=1&destination=" +
  encodeURIComponent("18860 Woodfield Rd, Unit J, Gaithersburg, MD 20878");
const PHONE_DISPLAY = "301-321-8626";
const PHONE_HREF = "tel:+13013218626";
const EMAIL = "sales@quickcountertop.com";
const INSTAGRAM_HANDLE = "@quickcountertop";
const INSTAGRAM_URL = "https://www.instagram.com/quickcountertop/";
const TIKTOK_HANDLE = "@quickcountertop";
const TIKTOK_URL = "https://www.tiktok.com/@quickcountertop";
const APP_VERSION = "v 2.4";

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
            <p
              className="mt-6 text-[12px] text-[color:var(--qc-ink-2)]"
              style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
            >
              {count} {count === 1 ? "slab" : "slabs"}
            </p>
          </div>

          <div>
            <p className="text-[10.5px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
              Visit
            </p>
            <address className="mt-4 not-italic text-[14px] leading-relaxed text-[color:var(--qc-ink-2)]">
              {ADDRESS_LINES.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </address>
            <p className="mt-3">
              <a
                href={GET_DIRECTIONS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[14px] text-[color:var(--qc-ink-1)]"
                style={{
                  textDecoration: "underline",
                  textDecorationColor: "var(--qc-line-strong)",
                  textUnderlineOffset: 4,
                }}
              >
                Get directions →
              </a>
            </p>
            <ul
              className="mt-5 space-y-1 text-[13px] text-[color:var(--qc-ink-2)]"
              style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
            >
              <li>MON–FRI · 9–17</li>
              <li>SAT · By appointment</li>
              <li>SUN · Closed</li>
            </ul>
          </div>

          <div>
            <p className="text-[10.5px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
              Contact
            </p>
            <ul className="mt-4 space-y-2 text-[14px] text-[color:var(--qc-ink-2)]">
              <li>
                <a
                  href={PHONE_HREF}
                  className="text-[color:var(--qc-ink-1)] hover:underline"
                >
                  {PHONE_DISPLAY}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${EMAIL}`}
                  className="text-[color:var(--qc-ink-1)] hover:underline"
                >
                  {EMAIL}
                </a>
              </li>
            </ul>
            <ul className="mt-5 space-y-2 text-[13px] text-[color:var(--qc-ink-2)]">
              <li>
                <a
                  href={INSTAGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[color:var(--qc-ink-1)]"
                >
                  <span className="text-[color:var(--qc-ink-3)]">Instagram</span>
                  <span className="mx-2 text-[color:var(--qc-ink-3)]">·</span>
                  <span className="text-[color:var(--qc-ink-1)]">{INSTAGRAM_HANDLE}</span>
                </a>
              </li>
              <li>
                <a
                  href={TIKTOK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[color:var(--qc-ink-1)]"
                >
                  <span className="text-[color:var(--qc-ink-3)]">TikTok</span>
                  <span className="mx-2 text-[color:var(--qc-ink-3)]">·</span>
                  <span className="text-[color:var(--qc-ink-1)]">{TIKTOK_HANDLE}</span>
                </a>
              </li>
            </ul>
          </div>
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
              className="text-[color:var(--qc-ink-2)] hover:text-[color:var(--qc-ink-1)]"
              style={{
                textDecoration: "underline",
                textDecorationColor: "var(--qc-line-strong)",
                textUnderlineOffset: 4,
              }}
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
