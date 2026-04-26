function ManageScreen({ remnants }) {
  return (
    <div style={{ padding: "20px 24px", maxWidth: 1680, margin: "0 auto" }}>
      <section style={{
        borderRadius: 28,
        border: "1px solid var(--brand-line)",
        background: "linear-gradient(135deg, rgba(255,255,255,0.99), rgba(242,242,242,0.96))",
        boxShadow: "var(--shadow-panel)",
        padding: "20px 24px",
        marginBottom: 16,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      }}>
        <div style={{ minWidth: 0 }}>
          <p style={{
            margin: 0,
            fontSize: 11, fontWeight: 600,
            textTransform: "uppercase", letterSpacing: "0.18em",
            color: "var(--brand-orange)",
            whiteSpace: "nowrap",
          }}>Management Workspace</p>
          <h1 style={{
            fontFamily: "var(--font-display)",
            margin: "6px 0 0",
            fontSize: 28, fontWeight: 600,
            color: "var(--brand-ink)",
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
          }}>Live remnants</h1>
        </div>
        <button style={{
          height: 44, padding: "0 22px",
          border: "1px solid var(--brand-orange)",
          background: "linear-gradient(135deg, var(--brand-orange) 0%, var(--brand-orange-deep) 100%)",
          color: "#fff",
          borderRadius: 16,
          fontFamily: "inherit", fontSize: 12, fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.14em",
          boxShadow: "var(--shadow-btn-orange)",
          cursor: "pointer",
          whiteSpace: "nowrap", flexShrink: 0,
        }}>+ Add remnant</button>
      </section>

      <section style={{
        borderRadius: 28,
        border: "1px solid var(--brand-line)",
        background: "rgba(255,255,255,0.96)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}>
        <table style={{
          width: "100%", borderCollapse: "collapse",
          fontSize: 13, color: "var(--brand-ink)",
        }}>
          <thead>
            <tr style={{ background: "var(--brand-shell)" }}>
              {["ID / Status", "Stone", "Material", "Size", "Finish"].map(h => (
                <th key={h} style={{
                  textAlign: "left",
                  padding: "12px 16px",
                  fontSize: 10, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.18em",
                  color: "var(--brand-orange)",
                  borderBottom: "1px solid var(--brand-line)",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {remnants.map(r => (
              <tr key={r.id}>
                <td style={td}><StatusIdChip id={r.id} status={r.status} /></td>
                <td style={{ ...td, fontFamily: "var(--font-display)", fontWeight: 600 }}>{r.brand} {r.name}</td>
                <td style={td}>{r.material}</td>
                <td style={td}>{r.width}″ × {r.height}″</td>
                <td style={td}>{r.finish}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const td = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--brand-line)",
};

window.ManageScreen = ManageScreen;
