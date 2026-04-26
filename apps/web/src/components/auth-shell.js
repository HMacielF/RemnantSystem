import Link from "next/link";

export const AUTH_INPUT_CLASS =
  "font-inter h-[42px] w-full bg-white px-3.5 text-[14px] font-normal normal-case tracking-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors focus:border-[color:var(--qc-ink-1)]";

export const AUTH_INPUT_STYLE = {
  border: "1px solid var(--qc-line)",
  borderRadius: "var(--qc-radius-sharp)",
};

export const AUTH_LABEL_CLASS =
  "font-inter block text-[10px] font-medium uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]";

export const AUTH_PRIMARY_BUTTON_CLASS =
  "font-inter inline-flex h-11 w-full items-center justify-center gap-2 px-5 text-[13px] font-medium text-white transition-colors hover:bg-[#232323] disabled:cursor-not-allowed disabled:opacity-60";

export const AUTH_PRIMARY_BUTTON_STYLE = {
  backgroundColor: "var(--qc-ink-1)",
  borderRadius: "var(--qc-radius-sharp)",
};

export const AUTH_SECONDARY_BUTTON_CLASS =
  "font-inter inline-flex h-11 w-full items-center justify-center gap-2 bg-white px-5 text-[13px] font-medium text-[color:var(--qc-ink-1)] transition-colors hover:border-[color:var(--qc-ink-1)]";

export const AUTH_SECONDARY_BUTTON_STYLE = {
  border: "1px solid var(--qc-line)",
  borderRadius: "var(--qc-radius-sharp)",
};

export default function AuthShell({
  eyebrow,
  title,
  description,
  liveStatus,
  cardEyebrow,
  cardTitle,
  cardDescription,
  children,
}) {
  return (
    <main className="font-inter relative min-h-screen bg-[color:var(--qc-bg-page)] text-[color:var(--qc-ink-1)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 -top-24 h-[480px] w-[480px]"
        style={{
          background:
            "radial-gradient(closest-side, var(--qc-orange-wash), transparent 70%)",
          filter: "blur(40px)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1240px] items-center px-8 py-[72px]">
        <div className="grid w-full gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(380px,440px)] lg:items-center">
          <section className="max-w-[640px]">
            {eyebrow ? (
              <p className="inline-flex items-center gap-2 text-[10.5px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: "var(--qc-orange)" }}
                />
                {eyebrow}
              </p>
            ) : null}
            <h1 className="mt-5 text-[clamp(2.4rem,4.4vw,3.4rem)] font-medium leading-[1.05] tracking-[-0.02em] text-[color:var(--qc-ink-1)]">
              {title}
            </h1>
            {description ? (
              <p className="mt-5 max-w-[520px] text-[14.5px] leading-[1.6] text-[color:var(--qc-ink-2)]">
                {description}
              </p>
            ) : null}
            {liveStatus ? (
              <div className="mt-7 inline-flex items-center gap-2 text-[11.5px] text-[color:var(--qc-ink-2)]">
                <span
                  aria-hidden="true"
                  className="qc-pulse inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: "var(--qc-status-available-dot)" }}
                />
                <span style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}>
                  {liveStatus}
                </span>
              </div>
            ) : null}
          </section>

          <section
            className="w-full bg-[color:var(--qc-bg-surface)] p-8 lg:ml-auto"
            style={{
              border: "1px solid var(--qc-line)",
              borderRadius: "var(--qc-radius-sharp)",
            }}
          >
            {cardEyebrow ? (
              <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[color:var(--qc-ink-3)]">
                {cardEyebrow}
              </p>
            ) : null}
            {cardTitle ? (
              <h2 className="mt-3 text-[22px] font-medium leading-tight tracking-[-0.015em] text-[color:var(--qc-ink-1)]">
                {cardTitle}
              </h2>
            ) : null}
            {cardDescription ? (
              <p className="mt-2 text-[13px] leading-[1.6] text-[color:var(--qc-ink-2)]">
                {cardDescription}
              </p>
            ) : null}

            <div className={cardEyebrow || cardTitle || cardDescription ? "mt-6" : ""}>
              {children}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export function AuthActions({ primary, secondary }) {
  return (
    <div
      className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-5 text-[12px]"
      style={{ borderTop: "1px solid var(--qc-line)" }}
    >
      {primary ? (
        <Link
          href={primary.href}
          className="text-[color:var(--qc-ink-2)] hover:text-[color:var(--qc-ink-1)]"
          style={{
            textDecoration: "underline",
            textDecorationColor: "var(--qc-line-strong)",
            textUnderlineOffset: 4,
          }}
        >
          {primary.label}
        </Link>
      ) : (
        <span />
      )}
      {secondary ? (
        <Link
          href={secondary.href}
          className="text-[color:var(--qc-ink-3)] hover:text-[color:var(--qc-ink-1)]"
        >
          {secondary.label}
        </Link>
      ) : null}
    </div>
  );
}
