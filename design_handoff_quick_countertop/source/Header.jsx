function Header({ surface, onNavigate }) {
  return (
    <header style={{
      background: "#fff",
      borderBottom: "1px solid var(--brand-line)",
    }}>
      <div style={{
        maxWidth: 1680, margin: "0 auto",
        padding: "14px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      }}>
        <button
          onClick={() => onNavigate("public")}
          style={{ background: "none", border: 0, padding: 0, cursor: "pointer", display: "inline-flex" }}
          aria-label="Quick Countertop home"
        >
          <img src="../../assets/Quick_Logo.png" alt="Quick Countertop" style={{ height: 26, width: "auto", display: "block" }} />
        </button>
        <nav style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <NavLink active={surface === "public"} onClick={() => onNavigate("public")}>Inventory</NavLink>
          <NavLink active={surface === "manage"} onClick={() => onNavigate("manage")}>Manage</NavLink>
          <button
            onClick={() => onNavigate("portal")}
            style={{
              marginLeft: 12,
              height: 36, padding: "0 18px",
              border: 0, cursor: "pointer",
              background: "var(--brand-ink)", color: "#fff",
              borderRadius: 9999,
              fontFamily: "inherit", fontSize: 13, fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >Sign in</button>
        </nav>
      </div>
    </header>
  );
}

function NavLink({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: 0, cursor: "pointer",
      padding: "8px 14px",
      fontFamily: "inherit", fontSize: 14, fontWeight: 500,
      color: active ? "var(--brand-ink)" : "rgba(35,35,35,0.55)",
      borderRadius: 9999,
      transition: "color 150ms ease, background 150ms ease",
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.color = "var(--brand-ink)"; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.color = "rgba(35,35,35,0.55)"; }}
    >{children}</button>
  );
}

window.Header = Header;
