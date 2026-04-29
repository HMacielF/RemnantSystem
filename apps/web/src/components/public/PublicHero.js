"use client";

import { useMemo } from "react";

const MATERIAL_TOP_N = 5;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function materialName(remnant) {
  return String(remnant?.material_name || remnant?.material || "").trim();
}

function computeBreakdown(remnants) {
  const list = Array.isArray(remnants) ? remnants : [];
  const now = Date.now();
  const weekAgoMs = now - ONE_WEEK_MS;

  let available = 0;
  let newThisWeek = 0;
  const materialCounts = new Map();

  for (const remnant of list) {
    if (normalizeStatus(remnant?.status) === "available") {
      available += 1;
      const material = materialName(remnant);
      if (material) {
        materialCounts.set(material, (materialCounts.get(material) || 0) + 1);
      }
    }
    const createdAt = remnant?.created_at ? Date.parse(remnant.created_at) : NaN;
    if (Number.isFinite(createdAt) && createdAt >= weekAgoMs) {
      newThisWeek += 1;
    }
  }

  const materials = [...materialCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, MATERIAL_TOP_N);

  return { available, newThisWeek, materials };
}

export default function PublicHero({ remnants }) {
  const breakdown = useMemo(() => computeBreakdown(remnants), [remnants]);
  const maxCount = breakdown.materials[0]?.count || 0;

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
      <div className="relative mx-auto grid w-full max-w-[1680px] gap-8 px-8 py-8 md:grid-cols-[minmax(0,2fr)_minmax(260px,320px)] md:items-center md:py-10">
        <div className="max-w-[860px]">
          <p className="font-inter mb-5 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
            <span
              aria-hidden="true"
              className="qc-pulse inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--qc-orange)" }}
            />
            Live Remnant Inventory
          </p>
          <h1 className="font-inter text-[clamp(2.6rem,5.6vw,4.2rem)] font-medium leading-[1.04] tracking-[-0.02em] text-[color:var(--qc-ink-1)]">
            Find your remnant{" "}
            <span className="text-[color:var(--qc-ink-3)]">
              before someone else does.
            </span>
          </h1>
        </div>

        <aside
          className="bg-[color:var(--qc-bg-surface)] p-5"
          style={{
            border: "1px solid var(--qc-line)",
            borderRadius: "var(--qc-radius-sharp)",
          }}
        >
          <div
            className="flex items-end justify-between pb-4"
            style={{ borderBottom: "1px solid var(--qc-line)" }}
          >
            <div>
              <p className="font-inter text-[11px] uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
                Available now
              </p>
              <p className="mt-2 font-inter text-[44px] font-medium leading-none tracking-[-0.03em] text-[color:var(--qc-ink-1)]">
                {breakdown.available}
              </p>
            </div>
            {breakdown.newThisWeek > 0 ? (
              <p className="font-inter text-[12px] text-[color:var(--qc-ink-2)]">
                <span className="text-[color:var(--qc-orange)]">+{breakdown.newThisWeek}</span>{" "}
                new this week
              </p>
            ) : null}
          </div>

          {breakdown.materials.length ? (
            <ul className="mt-4 space-y-2">
              {breakdown.materials.map((row) => {
                const pct = maxCount ? Math.max(6, Math.round((row.count / maxCount) * 100)) : 0;
                return (
                  <li key={row.name} className="font-inter text-[13px] text-[color:var(--qc-ink-1)]">
                    <div className="flex items-baseline justify-between gap-3">
                      <span>{row.name}</span>
                      <span
                        className="text-[color:var(--qc-ink-2)]"
                        style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
                      >
                        {row.count}
                      </span>
                    </div>
                    <div
                      aria-hidden="true"
                      className="mt-1 h-[2px] w-full"
                      style={{ backgroundColor: "var(--qc-line)" }}
                    >
                      <div
                        className="h-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: "var(--qc-ink-1)",
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
