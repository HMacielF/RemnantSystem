function App() {
  const [surface, setSurface] = React.useState("public");
  const [filters, setFilters] = React.useState({
    materials: [], colors: [], stone: "", minWidth: "", minHeight: "", status: "",
  });
  const [toast, setToast] = React.useState(null);

  const items = React.useMemo(() => {
    return window.REMNANT_DATA.filter(r => {
      if (filters.materials.length && !filters.materials.includes(r.material)) return false;
      if (filters.colors.length && !filters.colors.some(c => r.colors?.includes(c))) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.stone) {
        const q = filters.stone.toLowerCase();
        const hay = `${r.name} ${r.brand} ${r.material} ${r.id}`.toLowerCase();
        if (!hay.includes(q.replace(/^#/, ""))) return false;
      }
      if (filters.minWidth && Number(r.width) < Number(filters.minWidth)) return false;
      if (filters.minHeight && Number(r.height) < Number(filters.minHeight)) return false;
      return true;
    });
  }, [filters]);

  function handleHold(remnant) {
    setToast(`Hold request sent for #${remnant.id}. Our team will review it and follow up soon.`);
    setTimeout(() => setToast(null), 4000);
  }

  return (
    <div style={{ minHeight: "100vh", color: "var(--brand-ink)" }}>
      <Header surface={surface} onNavigate={s => setSurface(s)} />

      {surface === "portal" ? (
        <PortalScreen onSignIn={(target) => setSurface(target === "public" ? "public" : "manage")} />
      ) : surface === "manage" ? (
        <ManageScreen remnants={window.REMNANT_DATA} />
      ) : (
        <main style={{ position: "relative" }}>
          <div style={{
            pointerEvents: "none",
            position: "absolute", left: "10%", top: 80,
            width: 380, height: 380, borderRadius: "50%",
            background: "rgba(247,134,57,0.08)", filter: "blur(110px)",
            zIndex: 0,
          }} />
          <div style={{ position: "relative", maxWidth: 1440, margin: "0 auto", padding: "8px 32px 40px" }}>
            <HeroSection count={window.REMNANT_DATA.length} />
            <FilterPanel
              filters={filters}
              materials={window.MATERIALS}
              colors={window.COLORS}
              onChange={setFilters}
              resultCount={items.length}
            />
            <RemnantGrid items={items} onHold={handleHold} />
          </div>
          <Footer />
        </main>
      )}

      {toast ? (
        <div style={{
          position: "fixed", left: "50%", bottom: 32,
          transform: "translateX(-50%)",
          maxWidth: 480, padding: "14px 20px",
          borderRadius: 16,
          background: "var(--brand-ink)", color: "#fff",
          boxShadow: "var(--shadow-toast)",
          fontSize: 13,
        }}>{toast}</div>
      ) : null}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
