function RemnantCard({ remnant, onHold }) {
  const [hover, setHover] = React.useState(false);
  const isL = remnant.shape === "l" && remnant.width2 && remnant.height2;
  const sizeText = isL
    ? `${remnant.width}″ × ${remnant.height}″ + ${remnant.width2}″ × ${remnant.height2}″`
    : `${remnant.width}″ × ${remnant.height}″`;
  const eyebrow = remnant.brand
    ? `${remnant.brand} · ${remnant.material}`
    : remnant.material;
  const colorMap = (window.COLORS || []).reduce((m, c) => (m[c.id] = c, m), {});
  return (
    <article
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "#fff",
        borderRadius: 8,
        boxShadow: hover
          ? "0 1px 0 rgba(35,35,35,0.06), 0 24px 48px -20px rgba(35,35,35,0.22)"
          : "0 1px 0 rgba(35,35,35,0.06), 0 12px 28px -22px rgba(35,35,35,0.18)",
        overflow: "hidden",
        transform: hover ? "translateY(-3px)" : "translateY(0)",
        transition: "transform 220ms cubic-bezier(0.22,0.61,0.36,1), box-shadow 220ms ease",
        display: "flex", flexDirection: "column",
      }}
    >
      {/* Visual */}
      <div style={{
        position: "relative",
        aspectRatio: "5 / 4",
        background: remnant.tone,
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(120% 80% at 30% 0%, rgba(255,255,255,0.42), transparent 60%)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(180deg, rgba(20,18,16,0) 55%, rgba(20,18,16,0.32) 100%)",
          pointerEvents: "none",
        }} />

        {/* Top row — single chip = ID + status */}
        <div style={{
          position: "absolute", top: 12, left: 12, right: 12,
          display: "flex", justifyContent: "space-between", gap: 8,
        }}>
          <StatusIdChip id={remnant.id} status={remnant.status} />
        </div>

        {/* Hold CTA — pinned to corner, becomes pill on hover */}
        {remnant.status === "available" ? (
          <button
            onClick={() => onHold(remnant)}
            style={{
              position: "absolute", left: 12, bottom: 12,
              height: 36,
              padding: hover ? "0 14px 0 12px" : "0",
              width: hover ? "auto" : 36,
              border: 0, cursor: "pointer",
              background: "var(--brand-ink)",
              color: "#fff",
              borderRadius: 9999,
              fontFamily: "inherit", fontSize: 12, fontWeight: 500,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              gap: 8,
              boxShadow: "0 10px 24px rgba(20,18,16,0.32)",
              transition: "width 220ms ease, padding 220ms ease",
              overflow: "hidden",
            }}
            aria-label="Request a hold"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.9 4.75H6.75A2 2 0 0 0 4.75 6.75v4.15l7.34 7.35a1.8 1.8 0 0 0 2.55 0l3.62-3.62a1.8 1.8 0 0 0 0-2.55L10.9 4.75Z" />
              <circle cx="7.75" cy="7.75" r="1.05" />
            </svg>
            {hover ? <span style={{ whiteSpace: "nowrap" }}>Request hold</span> : null}
          </button>
        ) : null}
      </div>

      {/* Content */}
      <div style={{
        padding: "16px 18px 18px",
        display: "flex", flexDirection: "column", gap: 12,
        flex: 1,
      }}>
        <div>
          <p style={{
            margin: 0,
            fontSize: 10.5, fontWeight: 600,
            textTransform: "uppercase", letterSpacing: "0.16em",
            color: "var(--brand-orange)",
          }}>{eyebrow}</p>
          <h3 style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-display)",
            fontSize: 18, fontWeight: 600,
            color: "var(--brand-ink)",
            lineHeight: 1.2,
            letterSpacing: "-0.015em",
          }}>{remnant.name}</h3>
          {remnant.colors && remnant.colors.length ? (
            <div style={{
              marginTop: 10,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              {remnant.colors.map(cid => {
                const c = colorMap[cid];
                if (!c) return null;
                const isLight = ["white", "cream", "beige", "gold", "gray"].includes(cid);
                return (
                  <span key={cid}
                    title={c.label}
                    style={{
                      width: 14, height: 14, borderRadius: "50%",
                      background: c.swatch,
                      boxShadow: `inset 0 0 0 1px ${isLight ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.18)"}`,
                      display: "inline-block",
                    }}
                  />
                );
              })}
              <span style={{
                fontSize: 11,
                color: "rgba(35,35,35,0.5)",
                marginLeft: 2,
              }}>
                {remnant.colors.map(cid => colorMap[cid]?.label).filter(Boolean).join(" · ")}
              </span>
            </div>
          ) : null}
        </div>

        <div style={{
          marginTop: "auto",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          paddingTop: 12,
          borderTop: "1px solid var(--brand-line)",
        }}>
          <div style={{ minWidth: 0, flex: 1, paddingRight: 12 }}>
            <div style={{
              fontSize: 9.5, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.16em",
              color: "rgba(35,35,35,0.45)",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span>Size · Thickness</span>
              {isL ? (
                <span style={{
                  fontSize: 9, padding: "1px 5px",
                  border: "1px solid rgba(35,35,35,0.18)",
                  letterSpacing: "0.12em",
                  color: "rgba(35,35,35,0.6)",
                }}>L</span>
              ) : null}
            </div>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: isL ? 13 : 15, fontWeight: 600,
              color: "var(--brand-ink)",
              lineHeight: 1.2,
              fontFeatureSettings: "'tnum'",
              letterSpacing: "-0.01em",
              marginTop: 3,
            }}>
              <span style={{ whiteSpace: "nowrap" }}>{sizeText}</span>
              {remnant.thickness ? (
                <span style={{
                  display: "block",
                  marginTop: 2,
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: "rgba(35,35,35,0.55)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  letterSpacing: "0.04em",
                }}>{remnant.thickness}</span>
              ) : null}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{
              fontSize: 9.5, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.16em",
              color: "rgba(35,35,35,0.45)",
            }}>Finish</div>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: 15, fontWeight: 600,
              color: "var(--brand-ink)",
              lineHeight: 1.1,
              letterSpacing: "-0.01em",
              marginTop: 3,
            }}>{remnant.finish}</div>
          </div>
        </div>
      </div>
    </article>
  );
}

window.RemnantCard = RemnantCard;
