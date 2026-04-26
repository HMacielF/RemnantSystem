function FilterPanel({ filters, materials, colors = [], onChange, resultCount }) {
  function setMaterial(m) {
    const has = filters.materials.includes(m);
    onChange({
      ...filters,
      materials: has ? filters.materials.filter(x => x !== m) : [...filters.materials, m],
    });
  }
  function setColor(c) {
    const has = filters.colors.includes(c);
    onChange({
      ...filters,
      colors: has ? filters.colors.filter(x => x !== c) : [...filters.colors, c],
    });
  }
  function setStatus(s) {
    onChange({ ...filters, status: filters.status === s ? "" : s });
  }
  const inputBase = {
    height: 38, boxSizing: "border-box",
    borderRadius: 8,
    border: "1px solid transparent",
    background: "#fff",
    padding: "0 12px",
    fontFamily: "inherit", fontSize: 13.5,
    color: "var(--brand-ink)",
    boxShadow: "inset 0 0 0 1px var(--brand-line)",
    outline: "none",
    transition: "box-shadow 150ms ease",
  };

  const totalActive = filters.materials.length + filters.colors.length
    + (filters.stone ? 1 : 0) + (filters.minWidth ? 1 : 0)
    + (filters.minHeight ? 1 : 0) + (filters.status ? 1 : 0);

  return (
    <section style={{
      position: "sticky", top: 0, zIndex: 30,
      background: "rgba(250,250,249,0.92)",
      backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      borderBottom: "1px solid var(--brand-line)",
      margin: "0 -32px",
      padding: "14px 32px 12px",
      marginBottom: 20,
    }}>
      {/* Row 1 — Search + dimensions + status legend pills + clear */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(280px, 1fr) 84px 84px auto auto",
        gap: 8,
        alignItems: "center",
      }}>
        <div style={{ position: "relative" }}>
          <svg
            width="15" height="15" viewBox="0 0 24 24"
            fill="none" stroke="rgba(35,35,35,0.45)"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            style={{ ...inputBase, paddingLeft: 34, width: "100%" }}
            placeholder="Search stone, brand, finish, or ID #741"
            value={filters.stone}
            onChange={e => onChange({ ...filters, stone: e.target.value })}
          />
        </div>
        <NumField placeholder='Min W"' value={filters.minWidth}
          onChange={v => onChange({ ...filters, minWidth: v })} style={inputBase} />
        <NumField placeholder='Min H"' value={filters.minHeight}
          onChange={v => onChange({ ...filters, minHeight: v })} style={inputBase} />

        {/* Status legend = doubles as filter */}
        <div style={{
          display: "inline-flex", alignItems: "center",
          height: 38, padding: "0 4px 0 6px",
          borderRadius: 8,
          boxShadow: "inset 0 0 0 1px var(--brand-line)",
          background: "#fff",
          gap: 2,
        }}>
          {["available", "hold", "sold"].map(s => {
            const meta = window.STATUS_META[s];
            const on = filters.status === s;
            return (
              <button key={s}
                onClick={() => setStatus(s)}
                title={`Filter: ${meta.label}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  height: 30, padding: "0 9px",
                  border: 0, cursor: "pointer",
                  borderRadius: 6,
                  background: on ? meta.tint : "transparent",
                  color: on ? meta.fg : "rgba(35,35,35,0.7)",
                  fontFamily: "inherit", fontSize: 12, fontWeight: 500,
                  whiteSpace: "nowrap",
                  transition: "background 140ms ease",
                }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: meta.dot,
                  boxShadow: on ? `0 0 0 2px rgba(255,255,255,0.7)` : "none",
                }} />
                {meta.label}
              </button>
            );
          })}
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          fontSize: 12.5, color: "rgba(35,35,35,0.6)",
          paddingLeft: 4, whiteSpace: "nowrap",
        }}>
          <span>
            <span style={{ color: "var(--brand-ink)", fontWeight: 600 }}>{resultCount}</span>
            {" "}results
          </span>
          {totalActive > 0 ? (
            <button style={{
              background: "none", border: 0, padding: 0, cursor: "pointer",
              fontFamily: "inherit", fontSize: 12.5, fontWeight: 500,
              color: "var(--brand-orange-deep)",
            }} onClick={() => onChange({ materials: [], colors: [], stone: "", minWidth: "", minHeight: "", status: "" })}>
              Clear ({totalActive})
            </button>
          ) : null}
        </div>
      </div>

      {/* Row 2 — Material chips + Color swatches inline */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        marginTop: 10, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Chip active={filters.materials.length === 0} onClick={() => onChange({ ...filters, materials: [] })}>
            All materials
          </Chip>
          {materials.map(m => (
            <Chip key={m} active={filters.materials.includes(m)} onClick={() => setMaterial(m)}>{m}</Chip>
          ))}
        </div>
        <div style={{
          width: 1, height: 18, background: "var(--brand-line)",
        }} />
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          {colors.map(c => {
            const on = filters.colors.includes(c.id);
            const isLight = ["white", "cream", "beige", "gold", "gray"].includes(c.id);
            return (
              <button key={c.id} onClick={() => setColor(c.id)}
                title={c.label}
                style={{
                  position: "relative",
                  border: 0, padding: 0, cursor: "pointer",
                  width: 24, height: 24, borderRadius: "50%",
                  background: c.swatch,
                  boxShadow: on
                    ? `0 0 0 2px var(--brand-ink), 0 0 0 4px #fafaf9 inset`
                    : `inset 0 0 0 1px ${isLight ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.18)"}`,
                  transform: on ? "scale(1.08)" : "scale(1)",
                  transition: "transform 150ms ease, box-shadow 150ms ease",
                }}>
                {on ? (
                  <span style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <path d="m3.5 8.5 3 3 6-7" stroke={isLight ? "#23211f" : "#fff"} strokeWidth="2.2"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      border: 0, cursor: "pointer",
      borderRadius: 8,
      padding: "5px 11px",
      fontFamily: "inherit", fontSize: 12.5, fontWeight: 500,
      background: active ? "var(--brand-ink)" : "rgba(35,35,35,0.05)",
      color: active ? "#fff" : "rgba(35,35,35,0.78)",
      transition: "background 150ms ease, color 150ms ease",
    }}>{children}</button>
  );
}

function NumField({ placeholder, value, onChange, style }) {
  return (
    <input style={style} placeholder={placeholder} inputMode="numeric"
      value={value} onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ""))} />
  );
}

window.FilterPanel = FilterPanel;
