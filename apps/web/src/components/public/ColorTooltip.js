"use client";

export default function ColorTooltip({ name, children, className = "" }) {
  const label = String(name || "").trim();
  if (!label) return children;
  return (
    <span className={`group/swatch relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className="font-inter pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap bg-[color:var(--qc-bg-surface)] px-2 py-1 text-[11px] font-medium capitalize text-[color:var(--qc-ink-1)] opacity-0 transition-opacity duration-150 group-hover/swatch:opacity-100"
        style={{
          border: "1px solid var(--qc-line-strong)",
          borderRadius: "var(--qc-radius-sharp)",
        }}
      >
        {label}
      </span>
    </span>
  );
}
