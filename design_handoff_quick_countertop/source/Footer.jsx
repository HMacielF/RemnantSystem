function Footer() {
  const ink = "#0f0f0f";
  const ink2 = "#4a4a4a";
  const ink3 = "#8a8a8a";
  const line = "rgba(0,0,0,0.08)";

  const linkStyle = {
    color: ink2,
    textDecoration: "none",
    transition: "color 120ms ease",
  };
  const linkHover = (e, on) => { e.currentTarget.style.color = on ? ink : ink2; };
  const colTitle = {
    fontSize: 10,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    color: ink3,
    margin: "0 0 12px",
    fontWeight: 500,
  };

  return (
    <footer style={{
      marginTop: 48,
      padding: "0 32px",
      borderTop: `1px solid ${line}`,
    }}>
      <div style={{ maxWidth: 1680, margin: "0 auto", padding: "32px 0 22px" }}>

        <div style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr",
          gap: 56,
          alignItems: "start",
        }}>

          {/* Brand + tagline + web */}
          <div>
            <p style={{
              margin: 0,
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 22,
              lineHeight: 1.2,
              letterSpacing: "-0.005em",
              color: ink2,
            }}>
              Less waste. More kitchens.
            </p>
            <h3 style={{
              fontFamily: "var(--font-display)",
              fontWeight: 500,
              fontSize: 28,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              margin: "10px 0 0",
              color: ink,
              maxWidth: "18ch",
            }}>
              Quick Countertop &amp; Cabinets
            </h3>
            <a
              href="https://quickcountertop.com"
              style={{
                display: "inline-block",
                marginTop: 14,
                fontSize: 15,
                color: ink,
                textDecoration: "none",
                borderBottom: `1px solid ${ink}`,
                paddingBottom: 2,
              }}
            >
              quickcountertop.com →
            </a>

            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              marginTop: 22,
              fontSize: 11, color: ink2,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#16a34a",
                boxShadow: "0 0 0 3px rgba(22,163,74,0.18)",
                animation: "qcPulse 1.8s ease-in-out infinite",
              }} />
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.04em" }}>
                47 slabs · updated 2m ago
              </span>
            </div>
          </div>

          {/* Visit */}
          <div>
            <h4 style={colTitle}>Visit</h4>
            <p style={{ fontSize: 13, color: ink2, lineHeight: 1.55, margin: 0 }}>
              18860 Woodfield Rd, Unit J<br/>
              Gaithersburg, MD 20878
            </p>
            <a
              href="https://maps.google.com/?q=18860+Woodfield+Rd+Unit+J+Gaithersburg+MD+20878"
              target="_blank"
              rel="noopener"
              style={{
                display: "inline-block", marginTop: 8,
                fontSize: 12, color: ink, textDecoration: "none",
                borderBottom: `1px solid ${ink}`, paddingBottom: 1,
              }}
            >
              Get directions →
            </a>
            <p style={{
              fontSize: 11, color: ink3, margin: "14px 0 0",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: "0.04em",
              lineHeight: 1.7,
            }}>
              MON–FRI · 9–17<br/>
              SAT · By appointment<br/>
              SUN · Closed
            </p>
          </div>

          {/* Contact */}
          <div>
            <h4 style={colTitle}>Contact</h4>
            <a
              href="tel:+13013218626"
              style={{
                display: "block", fontSize: 13, padding: "2px 0", ...linkStyle,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                letterSpacing: "0.02em",
              }}
              onMouseEnter={(e)=>linkHover(e,true)}
              onMouseLeave={(e)=>linkHover(e,false)}
            >
              301-321-8626
            </a>
            <a
              href="mailto:sales@quickcountertop.com"
              style={{ display: "block", fontSize: 13, padding: "4px 0 0", ...linkStyle }}
              onMouseEnter={(e)=>linkHover(e,true)}
              onMouseLeave={(e)=>linkHover(e,false)}
            >
              sales@quickcountertop.com
            </a>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              <a
                href="https://instagram.com/quickcountertop"
                target="_blank"
                rel="noopener"
                style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, ...linkStyle }}
                onMouseEnter={(e)=>linkHover(e,true)}
                onMouseLeave={(e)=>linkHover(e,false)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="3" y="3" width="18" height="18" rx="4"/>
                  <circle cx="12" cy="12" r="4"/>
                  <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor"/>
                </svg>
                <span>Instagram &nbsp;·&nbsp; @quickcountertop</span>
              </a>
              <a
                href="https://tiktok.com/@quickcountertop"
                target="_blank"
                rel="noopener"
                style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, ...linkStyle }}
                onMouseEnter={(e)=>linkHover(e,true)}
                onMouseLeave={(e)=>linkHover(e,false)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16.5 3a5.5 5.5 0 0 0 4 4v2.6a8 8 0 0 1-4-1.1v6.4a5.9 5.9 0 1 1-5.9-5.9c.3 0 .6 0 .9.1v2.7a3.2 3.2 0 1 0 2.3 3.1V3h2.7z"/>
                </svg>
                <span>TikTok &nbsp;·&nbsp; @quickcountertop</span>
              </a>
            </div>
          </div>

        </div>

        {/* Legal strip */}
        <div style={{
          marginTop: 36,
          paddingTop: 16,
          borderTop: `1px solid ${line}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 10.5, color: ink3,
          gap: 20,
          flexWrap: "wrap",
        }}>
          <span>© 2026 Quick Countertop &amp; Cabinets</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: ink3 }}>Designed &amp; ideated by</span>
              <a
                href="#"
                style={{
                  color: ink,
                  textDecoration: "none",
                  borderBottom: `1px solid ${ink}`,
                  paddingBottom: 1,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  letterSpacing: "0.02em",
                }}
              >
                EndoM14
              </a>
            </span>
            <span style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: "0.04em",
            }}>
              v 2.4
            </span>
          </span>
        </div>

      </div>

      <style>{`
        @keyframes qcPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
    </footer>
  );
}

window.Footer = Footer;
