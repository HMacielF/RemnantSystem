// Status key — used by both RemnantCard and FilterPanel legend
window.STATUS_META = {
  available: { label: "Available", dot: "#10b981", tint: "rgba(16,185,129,0.14)", ring: "rgba(16,185,129,0.36)", fg: "#065f46" },
  hold:      { label: "On Hold",   dot: "#f59e0b", tint: "rgba(245,158,11,0.16)", ring: "rgba(245,158,11,0.42)", fg: "#78350f" },
  sold:      { label: "Sold",      dot: "#dc2626", tint: "rgba(220,38,38,0.10)",  ring: "rgba(220,38,38,0.38)",  fg: "#7f1d1d" },
};

function StatusIdChip({ id, status, size = "md" }) {
  const s = window.STATUS_META[status] || window.STATUS_META.available;
  const big = size === "md";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      borderRadius: 9999,
      padding: big ? "5px 11px 5px 9px" : "3px 9px 3px 7px",
      fontSize: big ? 11 : 10.5, fontWeight: 600,
      fontFeatureSettings: "'tnum'",
      letterSpacing: "0.01em",
      whiteSpace: "nowrap",
      background: s.tint,
      color: s.fg,
      boxShadow: `inset 0 0 0 1px ${s.ring}`,
      backdropFilter: "blur(6px)",
      WebkitBackdropFilter: "blur(6px)",
    }} title={s.label}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: s.dot,
        boxShadow: `0 0 0 2px rgba(255,255,255,0.7)`,
      }} />
      #{id}
    </span>
  );
}

window.StatusIdChip = StatusIdChip;
