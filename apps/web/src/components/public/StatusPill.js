"use client";

const STATUS_TOKENS = {
  available: {
    fg: "var(--qc-status-available-fg)",
    bg: "var(--qc-status-available-bg)",
    dot: "var(--qc-status-available-dot)",
  },
  hold: {
    fg: "var(--qc-status-hold-fg)",
    bg: "var(--qc-status-hold-bg)",
    dot: "var(--qc-status-hold-dot)",
  },
  sold: {
    fg: "var(--qc-status-sold-fg)",
    bg: "var(--qc-status-sold-bg)",
    dot: "var(--qc-status-sold-dot)",
  },
  pending: {
    fg: "var(--qc-status-pending-fg)",
    bg: "var(--qc-status-pending-bg)",
    dot: "var(--qc-status-pending-dot)",
  },
};

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "sold") return "sold";
  if (value === "hold" || value === "on hold") return "hold";
  if (value === "pending_approval" || value === "pending approval" || value === "pending") {
    return "pending";
  }
  return "available";
}

export default function StatusPill({ status, label, location, className = "" }) {
  const key = normalizeStatus(status);
  const tokens = STATUS_TOKENS[key];
  const trimmedLocation = String(location || "").trim();
  return (
    <span
      className={`font-inter inline-flex max-w-full items-center gap-2 px-2 py-1 text-[11px] ${className}`}
      style={{
        color: tokens.fg,
        backgroundColor: tokens.bg,
        borderRadius: "var(--qc-radius-sharp)",
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: tokens.dot }}
      />
      <span className="shrink-0 font-medium">{label}</span>
      {trimmedLocation ? (
        <>
          <span aria-hidden="true" className="shrink-0 opacity-50">·</span>
          <span className="inline-flex min-w-0 shrink items-center gap-1">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-3 w-3 shrink-0 opacity-70"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s7-7.58 7-13a7 7 0 1 0-14 0c0 5.42 7 13 7 13Z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
            <span className="truncate">{trimmedLocation}</span>
          </span>
        </>
      ) : null}
    </span>
  );
}
