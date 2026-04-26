"use client";

export default function PublicHero({ slabCount }) {
  const count = Number.isFinite(slabCount) ? slabCount : 0;
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 -top-24 h-[480px] w-[480px]"
        style={{
          background:
            "radial-gradient(closest-side, var(--qc-orange-wash), transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <div className="relative mx-auto flex w-full max-w-[1680px] flex-col items-start gap-10 px-8 py-16 md:flex-row md:items-end md:justify-between md:py-20">
        <div className="max-w-[680px]">
          <p className="font-inter mb-5 inline-flex items-center gap-2 text-[10.5px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
            <span
              aria-hidden="true"
              className="qc-pulse inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--qc-orange)" }}
            />
            Live Remnant Inventory
          </p>
          <h1 className="font-inter text-[clamp(2.4rem,5vw,3.6rem)] font-medium leading-[1.05] tracking-[-0.02em] text-[color:var(--qc-ink-1)]">
            Find your remnant{" "}
            <span className="text-[color:var(--qc-ink-3)]">
              before someone else does.
            </span>
          </h1>
        </div>

        <div className="flex flex-col items-start md:items-end">
          <span className="font-inter text-[clamp(3rem,5vw,4.4rem)] font-medium leading-none tracking-[-0.04em] text-[color:var(--qc-ink-1)]">
            {count}
          </span>
          <span className="font-inter mt-2 text-[10.5px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
            Remnants in stock
          </span>
        </div>
      </div>
    </section>
  );
}
