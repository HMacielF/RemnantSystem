function HeroSection({ count }) {
  return (
    <section style={{
      position: "relative",
      padding: "44px 8px 28px",
      marginBottom: 20,
      display: "grid",
      gridTemplateColumns: "minmax(0, 1.4fr) auto",
      alignItems: "end",
      gap: 32,
      borderBottom: "1px solid var(--brand-line)",
    }}>
      <div>
        <p style={{
          margin: 0,
          fontSize: 11, fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.24em",
          color: "var(--brand-orange)",
          display: "inline-flex", alignItems: "center", gap: 10,
          whiteSpace: "nowrap",
        }}>
          <span style={{
            display: "inline-block", width: 6, height: 6,
            borderRadius: "50%", background: "var(--brand-orange)",
            boxShadow: "0 0 0 4px rgba(247,134,57,0.18)",
          }} />
          Live Remnant Inventory
        </p>
        <h1 style={{
          fontFamily: "var(--font-display)",
          margin: "14px 0 0",
          fontSize: "clamp(2rem, 3.6vw, 2.8rem)",
          lineHeight: 1.04,
          fontWeight: 600,
          color: "var(--brand-ink)",
          letterSpacing: "-0.025em",
          maxWidth: 820,
        }}>
          Find your remnant <span style={{ color: "rgba(35,35,35,0.4)", fontWeight: 500 }}>before someone else does.</span>
        </h1>
      </div>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 12,
        paddingBottom: 6, whiteSpace: "nowrap",
      }}>
        <div style={{
          fontFamily: "var(--font-display)",
          fontSize: 40, fontWeight: 600,
          color: "var(--brand-ink)",
          lineHeight: 1, letterSpacing: "-0.025em",
          fontFeatureSettings: "'tnum'",
        }}>{count}</div>
        <div style={{
          fontSize: 11, fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.18em",
          color: "rgba(35,35,35,0.5)",
        }}>Remnants<br />in stock</div>
      </div>
    </section>
  );
}

window.HeroSection = HeroSection;
