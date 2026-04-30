"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PrivateHeader from "@/components/private/PrivateHeader";
import PrivateFooter from "@/components/private/PrivateFooter";

const STATUS_TOKENS = {
  available: {
    bg: "var(--qc-status-available-bg)",
    fg: "var(--qc-status-available-fg)",
    dot: "var(--qc-status-available-dot)",
  },
  hold: {
    bg: "var(--qc-status-hold-bg)",
    fg: "var(--qc-status-hold-fg)",
    dot: "var(--qc-status-hold-dot)",
  },
  sold: {
    bg: "var(--qc-status-sold-bg)",
    fg: "var(--qc-status-sold-fg)",
    dot: "var(--qc-status-sold-dot)",
  },
  pending_approval: {
    bg: "var(--qc-status-pending-bg)",
    fg: "var(--qc-status-pending-fg)",
    dot: "var(--qc-status-pending-dot)",
  },
};

function statusLabel(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "hold") return "On Hold";
  if (value === "sold") return "Sold";
  if (value === "pending_approval") return "Pending Approval";
  return "Available";
}

export default function ExternalIdsClient({ profile = null }) {
  const router = useRouter();
  const [summary, setSummary] = useState({ max: 0, used: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all"); // "all" | "used" | "free"
  const [extraSlots, setExtraSlots] = useState(0);
  const [toast, setToast] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/external-ids", { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load"));
        const payload = await res.json();
        if (cancelled) return;
        setSummary({
          max: Number(payload?.max || 0),
          used: Array.isArray(payload?.used) ? payload.used : [],
        });
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || "Failed to load external IDs.");
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const usedById = useMemo(() => {
    const map = new Map();
    for (const row of summary.used) {
      if (Number.isFinite(row.id)) map.set(row.id, row);
    }
    return map;
  }, [summary.used]);

  const tiles = useMemo(() => {
    const max = Math.max(summary.max, 1);
    const upper = max + extraSlots;
    const out = [];
    for (let id = 1; id <= upper; id += 1) {
      const used = usedById.get(id) || null;
      const isUsed = Boolean(used);
      if (filter === "used" && !isUsed) continue;
      if (filter === "free" && isUsed) continue;
      out.push({ id, used });
    }
    return out;
  }, [summary.max, extraSlots, usedById, filter]);

  const usedCount = summary.used.length;
  const freeCount = Math.max(summary.max - usedCount, 0);

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  }

  function handleTileClick(tile) {
    if (tile.used) {
      router.push(`/manage?stone=${encodeURIComponent(tile.id)}`);
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(String(tile.id))
        .then(() => showToast(`#${tile.id} copied`))
        .catch(() => showToast(`#${tile.id}`));
    }
  }

  return (
    <main className="font-inter min-h-screen bg-[color:var(--qc-bg-page)] text-[color:var(--qc-ink-1)]">
      <PrivateHeader profile={profile} />
      <div className="mx-auto w-full max-w-[1680px] px-8 pt-6 pb-16">
        <section className="mb-6">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
            Inventory IDs
          </p>
          <h1 className="mt-3 text-[clamp(2rem,4vw,2.6rem)] font-medium leading-[1.05] tracking-[-0.02em] text-[color:var(--qc-ink-1)]">
            External IDs{" "}
            <span className="text-[color:var(--qc-ink-3)]">at a glance.</span>
          </h1>
          <p className="mt-3 max-w-[60ch] text-[14px] leading-[1.6] text-[color:var(--qc-ink-2)]">
            Every external ID from 1 to the highest assigned. Used tiles carry the
            remnant&apos;s status color and link to the manage view; free tiles copy
            the ID to your clipboard so you can hand it to whoever&apos;s next.
          </p>
        </section>

        <section
          className="mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={{
            backgroundColor: "var(--qc-bg-surface)",
            border: "1px solid var(--qc-line)",
            borderRadius: "var(--qc-radius-sharp)",
          }}
        >
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[color:var(--qc-ink-2)]">
            <span>
              <span className="font-semibold text-[color:var(--qc-ink-1)]">{summary.max}</span> max
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <span className="font-semibold text-[color:var(--qc-ink-1)]">{usedCount}</span> used
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <span className="font-semibold text-[color:var(--qc-ink-1)]">{freeCount}</span> free
              {extraSlots ? ` (+${extraSlots} preview)` : ""}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { value: "all", label: "All" },
              { value: "used", label: "Used" },
              { value: "free", label: "Free" },
            ].map((option) => {
              const active = filter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  aria-pressed={active}
                  className="font-inter inline-flex items-center px-3 py-1.5 text-[12px] font-medium transition-colors"
                  style={{
                    backgroundColor: active ? "var(--qc-ink-1)" : "rgba(0,0,0,0.04)",
                    color: active ? "#fff" : "var(--qc-ink-1)",
                    borderRadius: "var(--qc-radius-sharp)",
                  }}
                >
                  {option.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setExtraSlots((current) => current + 50)}
              className="font-inter inline-flex items-center border border-[color:var(--qc-line)] bg-white px-3 py-1.5 text-[12px] font-medium text-[color:var(--qc-ink-1)] transition-colors hover:border-[color:var(--qc-line-strong)]"
              style={{ borderRadius: "var(--qc-radius-sharp)" }}
            >
              Show next 50 free IDs
            </button>
          </div>
        </section>

        {loading ? (
          <p className="text-[13px] text-[color:var(--qc-ink-3)]">Loading…</p>
        ) : error ? (
          <p
            className="px-4 py-3 text-[13px] text-[color:var(--qc-status-sold-fg)]"
            style={{
              backgroundColor: "var(--qc-status-sold-bg)",
              border: "1px solid var(--qc-line)",
              borderLeft: "2px solid var(--qc-status-sold-dot)",
              borderRadius: "var(--qc-radius-sharp)",
            }}
          >
            {error}
          </p>
        ) : tiles.length === 0 ? (
          <p className="text-[13px] text-[color:var(--qc-ink-3)]">No IDs match the current filter.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1">
            {tiles.map((tile) => {
              const tokens = tile.used ? STATUS_TOKENS[tile.used.status] || STATUS_TOKENS.available : null;
              const tooltip = tile.used
                ? `#${tile.id} — ${tile.used.name || "Unnamed"} · ${statusLabel(tile.used.status)}`
                : `#${tile.id} — Available · click to copy`;
              return (
                <button
                  key={tile.id}
                  type="button"
                  onClick={() => handleTileClick(tile)}
                  title={tooltip}
                  className="font-inter inline-flex h-12 items-center justify-center text-[12px] font-medium transition-colors"
                  style={{
                    backgroundColor: tokens ? tokens.bg : "transparent",
                    color: tokens ? tokens.fg : "var(--qc-ink-3)",
                    border: tokens ? `1px solid ${tokens.dot}` : "1px solid var(--qc-line)",
                    borderRadius: "var(--qc-radius-sharp)",
                    fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                  }}
                >
                  {tile.id}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {toast ? (
        <div
          className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 px-4 py-2 text-[12px] font-medium text-white"
          style={{
            backgroundColor: "var(--qc-ink-1)",
            borderRadius: "var(--qc-radius-sharp)",
            boxShadow: "var(--qc-shadow-toast)",
          }}
        >
          {toast}
        </div>
      ) : null}

      <PrivateFooter />
    </main>
  );
}
