function PortalScreen({ onSignIn }) {
  const ink = "#0f0f0f";
  const ink2 = "#4a4a4a";
  const ink3 = "#8a8a8a";
  const line = "rgba(0,0,0,0.10)";

  return (
    <main style={{
      position: "relative",
      minHeight: "100vh",
      background: "#fafaf9",
      color: ink,
    }}>
      {/* faint warm wash, top-left — matches the inventory hero feel */}
      <div style={{
        pointerEvents: "none",
        position: "absolute", left: "-8%", top: -120,
        width: 480, height: 480, borderRadius: "50%",
        background: "rgba(247,134,57,0.06)", filter: "blur(120px)",
        zIndex: 0,
      }} />

      <div style={{
        position: "relative", maxWidth: 1240, margin: "0 auto",
        padding: "72px 32px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.1fr) minmax(380px, 440px)",
        gap: 64, alignItems: "center",
        zIndex: 1,
      }}>
        {/* LEFT — editorial pitch */}
        <section style={{ maxWidth: 640 }}>
          <p style={{
            margin: 0,
            fontSize: 10.5, fontWeight: 500,
            textTransform: "uppercase", letterSpacing: "0.24em",
            color: ink3,
            display: "inline-flex", alignItems: "center", gap: 10,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "var(--brand-orange)",
              boxShadow: "0 0 0 4px rgba(247,134,57,0.18)",
            }} />
            Management portal
          </p>
          <h1 style={{
            fontFamily: "var(--font-display)",
            margin: "20px 0 0",
            fontSize: "clamp(2.4rem, 4.4vw, 3.4rem)",
            lineHeight: 1.05,
            fontWeight: 500,
            color: ink,
            letterSpacing: "-0.02em",
            textWrap: "pretty",
          }}>
            Keep the yard{" "}
            <em style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontStyle: "italic",
              fontWeight: 400,
              color: ink2,
            }}>online.</em>
          </h1>
          <p style={{
            margin: "18px 0 0",
            fontSize: 14.5,
            lineHeight: 1.6,
            color: ink2,
            maxWidth: 520,
          }}>
            Add remnants, update status, swap photos. Changes go live the moment you save — customers see the same inventory you do.
          </p>

          {/* Live status, same vocabulary as the public hero / footer */}
          <div style={{
            marginTop: 36,
            display: "inline-flex", alignItems: "center", gap: 10,
            fontSize: 11.5, color: ink2,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.04em",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#16a34a",
              boxShadow: "0 0 0 3px rgba(22,163,74,0.18)",
              animation: "qcPulse 1.8s ease-in-out infinite",
            }} />
            <span>Inventory live · 47 slabs · updated 2m ago</span>
          </div>
        </section>

        {/* RIGHT — sign-in card, sharp corners, hairline border */}
        <section style={{
          width: "100%", maxWidth: 440,
          background: "#fff",
          border: `1px solid ${line}`,
          padding: 32,
        }}>
          <p style={{
            margin: 0,
            fontSize: 10, fontWeight: 500,
            textTransform: "uppercase", letterSpacing: "0.22em",
            color: ink3,
          }}>Sign in</p>
          <h2 style={{
            fontFamily: "var(--font-display)",
            margin: "8px 0 0",
            fontSize: 22, fontWeight: 500,
            letterSpacing: "-0.015em",
            color: ink,
          }}>Welcome back.</h2>

          <form onSubmit={e => { e.preventDefault(); onSignIn(); }} style={{ marginTop: 24 }}>
            <PortalField label="Email" type="email" placeholder="you@quickcountertop.com" />
            <PortalField label="Password" type="password" placeholder="••••••••" />

            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginTop: 14,
              fontSize: 12,
            }}>
              <label style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                color: ink2, cursor: "pointer",
              }}>
                <input type="checkbox" defaultChecked style={{
                  width: 14, height: 14, margin: 0,
                  accentColor: ink,
                }} />
                <span style={{ whiteSpace: "nowrap" }}>Stay signed in</span>
              </label>
              <a href="#" style={{
                color: ink, textDecoration: "none",
                borderBottom: `1px solid ${line}`,
                paddingBottom: 1,
              }}>
                Forgot password?
              </a>
            </div>

            <button type="submit" style={{
              marginTop: 20,
              width: "100%", height: 44,
              border: 0, cursor: "pointer",
              borderRadius: 2,
              background: ink, color: "#fff",
              fontFamily: "inherit", fontSize: 13, fontWeight: 500,
              letterSpacing: "0.02em",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              gap: 10,
              whiteSpace: "nowrap",
              transition: "background 150ms ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#232323"; }}
            onMouseLeave={e => { e.currentTarget.style.background = ink; }}
            >
              <span>Enter workspace</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </button>
          </form>

          {/* Divider + back link */}
          <div style={{
            marginTop: 24, paddingTop: 18,
            borderTop: `1px solid ${line}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            fontSize: 12, color: ink3,
          }}>
            <span style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: "0.04em",
            }}>
              Staff access only
            </span>
            <a
              href="#"
              onClick={e => { e.preventDefault(); onSignIn("public"); }}
              style={{ color: ink2, textDecoration: "none" }}
              onMouseEnter={e => { e.currentTarget.style.color = ink; }}
              onMouseLeave={e => { e.currentTarget.style.color = ink2; }}
            >
              ← Back to inventory
            </a>
          </div>
        </section>
      </div>

      <style>{`
        @keyframes qcPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
    </main>
  );
}

function PortalField({ label, ...rest }) {
  const [focused, setFocused] = React.useState(false);
  const ink = "#0f0f0f";
  const ink3 = "#8a8a8a";
  return (
    <label style={{ display: "block", marginTop: 14 }}>
      <span style={{
        display: "block",
        fontSize: 10, fontWeight: 500,
        textTransform: "uppercase", letterSpacing: "0.20em",
        color: ink3,
      }}>{label}</span>
      <input
        {...rest}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          marginTop: 6,
          width: "100%", height: 42, boxSizing: "border-box",
          borderRadius: 2,
          border: "1px solid",
          borderColor: focused ? ink : "rgba(0,0,0,0.14)",
          background: "#fff",
          padding: "0 14px",
          fontFamily: "inherit", fontSize: 14,
          color: ink,
          outline: "none",
          transition: "border-color 120ms ease",
        }}
      />
    </label>
  );
}

window.PortalScreen = PortalScreen;
