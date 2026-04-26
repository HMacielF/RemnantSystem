function RemnantGrid({ items, onHold }) {
  if (!items.length) {
    return (
      <div style={{
        borderRadius: 28,
        border: "1px dashed var(--brand-line)",
        background: "rgba(255,255,255,0.88)",
        padding: "48px 26px",
        textAlign: "center",
      }}>
        <p style={{
          margin: 0,
          fontSize: 11, fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.24em",
          color: "var(--brand-orange)",
        }}>No matches</p>
        <h3 style={{
          fontFamily: "var(--font-display)",
          margin: "8px 0 0",
          fontSize: 24, fontWeight: 600,
          color: "var(--brand-ink)",
        }}>No remnants match these filters.</h3>
        <p style={{
          margin: "8px 0 0",
          fontSize: 13,
          color: "rgba(35,35,35,0.68)",
        }}>Try changing the stone, brand, color, finish, ID, material, or size filters to widen the search.</p>
      </div>
    );
  }
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      gap: 20,
    }}>
      {items.map(r => <RemnantCard key={r.id} remnant={r} onHold={onHold} />)}
    </div>
  );
}

window.RemnantGrid = RemnantGrid;
