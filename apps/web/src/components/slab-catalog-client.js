"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useBodyScrollLock from "@/components/use-body-scroll-lock";

const FILTER_LABEL_CLASS =
  "block text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]";
const FILTER_INPUT_CLASS =
  "mt-2 h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-medium normal-case tracking-normal text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10";
const FILTER_SELECT_CLASS =
  "mt-2 h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-3 text-sm font-medium text-[#2d2623] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10";

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function badgeClass(tone = "neutral") {
  const styles = {
    neutral: "border-[#ddcec2] bg-[#fbf7f2] text-[#6d584b]",
    accent: "border-[#eac6af] bg-[#fff2e8] text-[#9d6f4c]",
    green: "border-[#bfd5c9] bg-[#eef6f1] text-[#4e6b61]",
  };

  return styles[tone] || styles.neutral;
}

function SlabBadge({ label, tone = "neutral" }) {
  if (!label) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${badgeClass(tone)}`}
    >
      {label}
    </span>
  );
}

function SlabCatalogSkeletonCard() {
  return (
    <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/92 shadow-[0_12px_28px_rgba(58,37,22,0.07)]">
      <div className="relative aspect-[16/10] overflow-hidden bg-[#f2ebe3]">
        <div className="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,#f3ebe4,#ece1d7,#f3ebe4)]" />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(180deg,transparent,rgba(26,18,13,0.10))]" />
      </div>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2">
          <div className="h-7 w-20 animate-pulse rounded-full bg-[#f1e4d8]" />
          <div className="h-7 w-24 animate-pulse rounded-full bg-[#f6ece4]" />
          <div className="h-7 w-18 animate-pulse rounded-full bg-[#eef4ee]" />
        </div>
        <div>
          <div className="h-5 w-2/3 animate-pulse rounded-full bg-[#eadfd7]" />
          <div className="mt-2 h-4 w-1/3 animate-pulse rounded-full bg-[#f1e7df]" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-[#eadfd7] bg-[#fbf7f2] px-4 py-3">
              <div className="h-3 w-16 animate-pulse rounded-full bg-[#ecdccc]" />
              <div className="mt-2 h-4 w-12 animate-pulse rounded-full bg-[#e8ddd2]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function matchesFilter(row, filters) {
  const haystack = [
    row.name,
    row.supplier,
    row.material,
    row.width,
    row.height,
    row.color_tone,
    ...(row.pricing_codes || []),
    ...(row.primary_colors || []),
    ...(row.accent_colors || []),
    ...(row.finishes || []),
    ...(row.thicknesses || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (filters.search && !haystack.includes(filters.search)) return false;
  if (filters.supplier && row.supplier !== filters.supplier) return false;
  if (filters.material && row.material !== filters.material) return false;
  if (filters.finish && !(row.finishes || []).includes(filters.finish)) {
    return false;
  }
  if (filters.thickness && !(row.thicknesses || []).includes(filters.thickness)) {
    return false;
  }
  return true;
}

export default function SlabCatalogClient() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState(null);
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [material, setMaterial] = useState("");
  const [finish, setFinish] = useState("");
  const [thickness, setThickness] = useState("");

  useBodyScrollLock(Boolean(lightbox));

  useEffect(() => {
    let active = true;

    async function loadSlabs() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch("/api/slabs", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Slab request failed with ${response.status}`);
        }

        const data = await response.json();
        if (!active) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (loadError) {
        console.error(loadError);
        if (!active) return;
        setError("Unable to load the slab catalog right now.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadSlabs();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        setLightbox(null);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  const options = useMemo(
    () => ({
      suppliers: uniqueSorted(rows.map((row) => row.supplier)),
      materials: uniqueSorted(rows.map((row) => row.material)),
      finishes: uniqueSorted(rows.flatMap((row) => row.finishes || [])),
      thicknesses: uniqueSorted(rows.flatMap((row) => row.thicknesses || [])),
    }),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const filters = {
      search: search.trim().toLowerCase(),
      supplier,
      material,
      finish,
      thickness,
    };
    return rows.filter((row) => matchesFilter(row, filters));
  }, [finish, material, rows, search, supplier, thickness]);

  return (
    <>
      <main className="min-h-screen bg-[linear-gradient(180deg,#f8f1ea_0%,#f4ede6_26%,#efe7de_100%)] text-[#2d2623]">
        <div className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[440px] bg-[radial-gradient(circle_at_top_left,rgba(231,139,75,0.22),transparent_36%),radial-gradient(circle_at_top_right,rgba(93,129,118,0.16),transparent_32%)]" />
          <div className="pointer-events-none absolute left-[-120px] top-[120px] h-[260px] w-[260px] rounded-full bg-[#e7c3a9]/20 blur-3xl" />
          <div className="pointer-events-none absolute right-[-60px] top-[40px] h-[220px] w-[220px] rounded-full bg-[#b7d1c6]/20 blur-3xl" />

          <div className="relative mx-auto max-w-[1680px] px-4 py-4 md:px-6 md:py-5">
            <section className="mb-4 overflow-hidden rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,250,246,0.96),rgba(248,240,233,0.88))] px-6 py-5 shadow-[0_24px_70px_rgba(44,29,18,0.10)] backdrop-blur">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#9d6f4c] md:text-[15px]">
                    Internal Slab Catalog
                  </p>
                  <h1 className="mt-2 text-3xl leading-tight text-[#2c211c] md:text-[2.75rem]">
                    Review supplier slabs in one place.
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm text-[#6d584b] md:text-base">
                    Compare current slab options across suppliers without
                    jumping between vendor sites.
                  </p>
                </div>
                <Link
                  href="/manage"
                  className="inline-flex h-12 items-center justify-center rounded-2xl border border-[#d8c7b8] bg-white/80 px-5 text-sm font-semibold uppercase tracking-[0.16em] text-[#2d2623] shadow-sm transition hover:-translate-y-0.5 hover:border-[#E78B4B] hover:text-[#9d6f4c]"
                >
                  Back to Manage
                </Link>
              </div>
            </section>

            <section className="mb-4 rounded-[30px] border border-white/70 bg-white/88 p-5 shadow-[0_24px_70px_rgba(44,29,18,0.10)] backdrop-blur">
              <div className="grid gap-3 xl:grid-cols-[minmax(280px,1.3fr)_220px_220px_220px_220px] xl:items-end">
                <label className={FILTER_LABEL_CLASS}>
                  Search
                  <input
                    type="text"
                    placeholder="Stone, color, size, dimension..."
                    className={FILTER_INPUT_CLASS}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>

                <label className={FILTER_LABEL_CLASS}>
                  Supplier
                  <select
                    className={FILTER_SELECT_CLASS}
                    value={supplier}
                    onChange={(event) => setSupplier(event.target.value)}
                  >
                    <option value="">All suppliers</option>
                    {options.suppliers.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={FILTER_LABEL_CLASS}>
                  Material
                  <select
                    className={FILTER_SELECT_CLASS}
                    value={material}
                    onChange={(event) => setMaterial(event.target.value)}
                  >
                    <option value="">All materials</option>
                    {options.materials.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={FILTER_LABEL_CLASS}>
                  Finish
                  <select
                    className={FILTER_SELECT_CLASS}
                    value={finish}
                    onChange={(event) => setFinish(event.target.value)}
                  >
                    <option value="">All finishes</option>
                    {options.finishes.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={FILTER_LABEL_CLASS}>
                  Thickness
                  <select
                    className={FILTER_SELECT_CLASS}
                    value={thickness}
                    onChange={(event) => setThickness(event.target.value)}
                  >
                    <option value="">All thicknesses</option>
                    {options.thicknesses.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9c7355]">
                  Catalog
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-[#2d2623]">
                  Slabs
                </h2>
              </div>
              <div className="rounded-full border border-[#d8c7b8] bg-white/80 px-4 py-2 text-sm font-semibold text-[#6d584b] shadow-sm">
                {loading ? "Loading..." : error ? "Unavailable" : `${filteredRows.length} slabs`}
              </div>
            </section>

            {error ? (
              <div className="rounded-[28px] border border-[#e0c6b4] bg-[#fff8f2] p-8 text-center text-[#8a5f46] shadow-sm">
                {error}
              </div>
            ) : loading ? (
              <div
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                aria-live="polite"
                aria-busy="true"
              >
                {Array.from({ length: 8 }).map((_, index) => (
                  <SlabCatalogSkeletonCard key={index} />
                ))}
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="rounded-[28px] border border-[#d8c7b8] bg-white/88 p-8 text-center text-[#6d584b] shadow-sm">
                No slabs match the current filters.
              </div>
            ) : (
              <div
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                aria-live="polite"
              >
                {filteredRows.map((row) => {
                  const dimensionsLabel =
                    row.width && row.height
                      ? `${row.width} x ${row.height}`
                      : row.width || row.height || "Supplier slab listing";

                  return (
                    <article
                      key={row.id}
                      className="overflow-hidden rounded-[28px] border border-white/70 bg-white/94 shadow-[0_12px_28px_rgba(58,37,22,0.07)] [contain-intrinsic-size:440px] [content-visibility:auto]"
                    >
                      <div className="aspect-[16/10] bg-[#f2ebe3]">
                        {row.image_url ? (
                          <button
                            type="button"
                            className="group relative block h-full w-full overflow-hidden text-left"
                            onClick={() =>
                              setLightbox({
                                src: row.image_url,
                                alt: row.name || "Slab preview",
                              })
                            }
                            aria-label={`Open image for ${row.name}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={row.image_url}
                              alt={row.name}
                              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                              decoding="async"
                              loading="lazy"
                            />
                            <span className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(26,18,13,0.68))] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                              Open Image
                            </span>
                          </button>
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                            No Image
                          </div>
                        )}
                      </div>
                      <div className="space-y-4 p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <SlabBadge label={row.supplier} tone="accent" />
                          <SlabBadge label={row.material} />
                          <SlabBadge label={row.color_tone} tone="green" />
                        </div>
                        <div>
                          <h3 className="text-xl font-semibold text-[#2c211c]">
                            {row.name}
                          </h3>
                          <p className="mt-1 text-sm text-[#6d584b]">
                            {dimensionsLabel}
                          </p>
                        </div>
                        <div className="grid gap-3 text-sm text-[#6d584b] sm:grid-cols-2">
                          {row.width ? (
                            <div className="rounded-2xl border border-[#eadfd7] bg-[#fbf7f2] px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                                Width
                              </p>
                              <p className="mt-1 font-semibold text-[#2d2623]">
                                {row.width}
                              </p>
                            </div>
                          ) : null}
                          {row.height ? (
                            <div className="rounded-2xl border border-[#eadfd7] bg-[#fbf7f2] px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                                Height
                              </p>
                              <p className="mt-1 font-semibold text-[#2d2623]">
                                {row.height}
                              </p>
                            </div>
                          ) : null}
                        </div>
                        <div className="space-y-3">
                          {row.thicknesses?.length ? (
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                                Thickness
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {row.thicknesses.map((value) => (
                                  <SlabBadge key={`${row.id}-thickness-${value}`} label={value} />
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {row.finishes?.length ? (
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                                Finish
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {row.finishes.map((value) => (
                                  <SlabBadge key={`${row.id}-finish-${value}`} label={value} />
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {row.pricing_codes?.length ? (
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                                Price Tier
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {row.pricing_codes.map((value) => (
                                  <SlabBadge key={`${row.id}-price-${value}`} label={`Tier ${value}`} tone="green" />
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {row.primary_colors?.length ? (
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                                Primary Colors
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {row.primary_colors.map((value) => (
                                  <SlabBadge
                                    key={`${row.id}-primary-${value}`}
                                    label={value}
                                    tone="accent"
                                  />
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {row.accent_colors?.length ? (
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                                Accent Colors
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {row.accent_colors.map((value) => (
                                  <SlabBadge
                                    key={`${row.id}-accent-${value}`}
                                    label={value}
                                    tone="green"
                                  />
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        {row.detail_url ? (
                          <a
                            href={row.detail_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#232323] px-5 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-lg shadow-[#232323]/15 transition hover:-translate-y-0.5 hover:bg-[#E78B4B]"
                          >
                            View Supplier Page
                          </a>
                        ) : (
                          <div className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#ddcec2] bg-[#fbf7f2] px-5 text-xs font-semibold uppercase tracking-[0.16em] text-[#8c7567]">
                            Supplier Page Unavailable
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <footer className="px-4 pb-10 pt-2 md:px-6">
          <div className="mx-auto max-w-[1680px] rounded-[28px] border border-white/70 bg-white/55 px-6 py-5 text-center shadow-sm backdrop-blur">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9c7355]">
              Built by EndoMF14
            </p>
            <p className="mt-2 text-sm text-[#6d584b]">
              Designed to make supplier slab browsing clear, fast, and easy to
              compare.
            </p>
          </div>
        </footer>
      </main>

      {lightbox ? (
        <div
          className="fixed inset-0 z-[70] bg-black/75 px-4 py-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setLightbox(null);
            }
          }}
        >
          <div className="mx-auto flex h-full max-w-6xl flex-col">
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-2xl text-white transition-colors hover:bg-white/20 active:bg-white/30"
                aria-label="Close slab image preview"
                onClick={() => setLightbox(null)}
              >
                ×
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.src}
                alt={lightbox.alt}
                className="max-h-full max-w-full rounded-[28px] border border-white/15 bg-white/5 object-contain shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
