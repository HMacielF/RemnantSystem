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
};

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "sold") return "sold";
  if (value === "hold" || value === "on hold") return "hold";
  return "available";
}

export default function StatusPill({ status, label, className = "" }) {
  const key = normalizeStatus(status);
  const tokens = STATUS_TOKENS[key];
  return (
    <span
      className={`font-inter inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium ${className}`}
      style={{
        color: tokens.fg,
        backgroundColor: tokens.bg,
        borderRadius: "var(--qc-radius-sharp)",
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: tokens.dot }}
      />
      {label}
    </span>
  );
}
