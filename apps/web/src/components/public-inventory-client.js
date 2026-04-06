/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function imageSrc(remnant) {
  return remnant.image || remnant.source_image_url || "";
}

function displayRemnantId(remnant) {
  return remnant.display_id || remnant.moraware_remnant_id || remnant.id;
}

function normalizeMaterialName(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueMaterialOptions(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter((value) => {
    const normalized = normalizeMaterialName(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function internalRemnantId(remnant) {
  return remnant.internal_remnant_id || remnant.id || null;
}

function sizeText(remnant) {
  if (remnant.l_shape) {
    return `${remnant.width} x ${remnant.height} + ${remnant.l_width} x ${remnant.l_height}`;
  }
  return `${remnant.width} x ${remnant.height}`;
}

function cardSizeText(remnant) {
  if (remnant.l_shape) {
    return `${remnant.width}" x ${remnant.height}" + ${remnant.l_width}" x ${remnant.l_height}"`;
  }
  return `${remnant.width}" x ${remnant.height}"`;
}

function cardTitleText(remnant) {
  const material = String(remnant.material_name || remnant.material || "").trim();
  const stone = String(remnant.name || "").trim();
  if (material && stone) return `${material} | ${stone}`;
  return material || stone || "Unnamed";
}

function statusText(remnant) {
  const normalized = String(remnant?.status || "").trim().toLowerCase();
  if (!normalized || normalized === "available") return "Available";
  if (normalized === "hold" || normalized === "on hold") return "On Hold";
  if (normalized === "sold") return "Sold";
  return remnant?.status || "Available";
}

function statusBadgeClass(status) {
  const lc = String(status || "").toLowerCase();
  if (lc === "sold") return "bg-rose-100 text-rose-800 ring-1 ring-rose-300";
  if (lc === "hold" || lc === "on hold") return "bg-amber-100 text-amber-900 ring-1 ring-amber-300";
  return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300";
}

function currentFiltersFromSearch(searchParams) {
  return {
    materials: searchParams.getAll("material"),
    stone: searchParams.get("stone") || "",
    minWidth: searchParams.get("min-width") || "",
    minHeight: searchParams.get("min-height") || "",
    status: searchParams.get("status") || "",
  };
}

async function apiFetch(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let message = "Request failed";
    try {
      const payload = await res.json();
      message = payload?.details ? `${payload.error}: ${payload.details}` : payload?.error || message;
    } catch (_error) {
      message = await res.text().catch(() => message);
    }
    throw new Error(message);
  }
  return res.json();
}

function buildSearchQuery(filters) {
  const params = new URLSearchParams();
  filters.materials.forEach((material) => {
    if (material) params.append("material", material);
  });
  if (filters.stone.trim()) params.set("stone", filters.stone.trim());
  if (filters.minWidth.trim()) params.set("min-width", filters.minWidth.trim());
  if (filters.minHeight.trim()) params.set("min-height", filters.minHeight.trim());
  if (filters.status.trim()) params.set("status", filters.status.trim());
  return params;
}

export default function PublicInventoryClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const initialFilters = useMemo(
    () => currentFiltersFromSearch(new URLSearchParams(searchKey)),
    [searchKey],
  );
  const [filters, setFilters] = useState(initialFilters);
  const [remnants, setRemnants] = useState([]);
  const [salesReps, setSalesReps] = useState([]);
  const [materialOptions, setMaterialOptions] = useState([]);
  const [lookupsLoaded, setLookupsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedImageIndex, setSelectedImageIndex] = useState(null);
  const [holdRemnant, setHoldRemnant] = useState(null);
  const [holdForm, setHoldForm] = useState({
    requester_name: "",
    requester_email: "",
    sales_rep_user_id: "",
    notes: "",
  });
  const [holdSubmitting, setHoldSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [holdFormMessage, setHoldFormMessage] = useState("");
  const abortRef = useRef(null);
  const enrichmentRef = useRef(null);
  const lastPathnameRef = useRef(pathname);

  useEffect(() => {
    setFilters(currentFiltersFromSearch(new URLSearchParams(searchKey)));
  }, [searchKey]);

  useEffect(() => {
    if (!notice || notice.type !== "success") return undefined;

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 4500);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    const params = buildSearchQuery(filters);
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    const currentUrl = searchKey ? `${pathname}?${searchKey}` : pathname;
    if (lastPathnameRef.current !== pathname) {
      lastPathnameRef.current = pathname;
      return;
    }
    if (nextUrl === currentUrl) return;
    router.replace(nextUrl, { scroll: false });
  }, [filters, pathname, router, searchKey]);

  useEffect(() => {
    let mounted = true;

    async function loadBootData() {
      try {
        const lookupPayload = await apiFetch("/api/public/lookups");
        if (!mounted) return;
        setMaterialOptions(
          uniqueMaterialOptions(
            Array.isArray(lookupPayload?.materials)
              ? lookupPayload.materials.map((row) => row.name).filter(Boolean)
              : [],
          ),
        );
        setLookupsLoaded(true);
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError.message);
      }
    }

    loadBootData();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!lookupsLoaded) return;

    if (abortRef.current) abortRef.current.abort();
    if (enrichmentRef.current) enrichmentRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    async function loadRows() {
      try {
        setLoading(true);
        setError("");
        const params = buildSearchQuery(filters);
        params.set("enrich", "0");
        const rows = await apiFetch(`/api/public/remnants?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!Array.isArray(rows)) {
          throw new Error("Unexpected remnant payload");
        }
        setRemnants(rows.map((row) => ({ ...row, __detailsPending: rows.length > 0 })));
        setLoading(false);

        const ids = [...new Set(rows.map((row) => Number(internalRemnantId(row))).filter(Boolean))];
        if (!ids.length) return;

        const enrichmentController = new AbortController();
        enrichmentRef.current = enrichmentController;
        const enrichmentRows = await apiFetch("/api/public/remnants/enrichment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
          signal: enrichmentController.signal,
        });

        if (!Array.isArray(enrichmentRows)) return;
        const enrichmentMap = new Map(
          enrichmentRows.map((row) => [Number(row.remnant_id), row]),
        );

        setRemnants((currentRows) =>
          currentRows.map((row) => {
            const enrichment = enrichmentMap.get(Number(internalRemnantId(row)));
            return enrichment
              ? { ...row, ...enrichment, __detailsPending: false }
              : { ...row, __detailsPending: false };
          }),
        );
      } catch (loadError) {
        if (loadError.name === "AbortError") return;
        setLoading(false);
        setError(loadError.message);
      }
    }

    loadRows();

    return () => {
      controller.abort();
    };
  }, [filters, lookupsLoaded]);

  function toggleMaterialFilter(material) {
    setFilters((current) => {
      const isSelected = current.materials.includes(material);
      return {
        ...current,
        materials: isSelected
          ? current.materials.filter((value) => value !== material)
          : [...current.materials, material],
      };
    });
  }

  async function ensureSalesRepsLoaded(remnant) {
    const params = new URLSearchParams();
    const remnantId = internalRemnantId(remnant);
    const externalRemnantId = displayRemnantId(remnant);
    if (remnantId) params.set("remnant_id", String(remnantId));
    if (externalRemnantId) params.set("external_remnant_id", String(externalRemnantId));
    const rows = await apiFetch(`/api/public/sales-reps?${params.toString()}`);
    setSalesReps(Array.isArray(rows) ? rows : []);
  }

  async function openHoldRequest(remnant) {
    setNotice(null);
    setHoldFormMessage("");
    setHoldRemnant(remnant);
    await ensureSalesRepsLoaded(remnant);
  }

  async function submitHoldRequest(event) {
    event.preventDefault();
    if (!holdRemnant) return;

    try {
      setHoldSubmitting(true);
      setHoldFormMessage("");
      setNotice(null);
      await apiFetch("/api/public/hold-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remnant_id: internalRemnantId(holdRemnant),
          external_remnant_id: displayRemnantId(holdRemnant),
          ...holdForm,
        }),
      });
      setHoldSubmitting(false);
      setHoldRemnant(null);
      setHoldForm({
        requester_name: "",
        requester_email: "",
        sales_rep_user_id: "",
        notes: "",
      });
      setNotice({
        type: "success",
        message: "Hold request sent. Our team will review it and follow up soon.",
      });
    } catch (submitError) {
      setHoldSubmitting(false);
      setHoldFormMessage(submitError.message);
      setNotice({
        type: "error",
        message: submitError.message,
      });
    }
  }

  const cards = useMemo(() => {
    if (!filters.materials.length) return remnants;

    const allowedMaterials = new Set(
      filters.materials.map((material) => normalizeMaterialName(material)),
    );

    return remnants.filter((remnant) =>
      allowedMaterials.has(
        normalizeMaterialName(remnant.material_name || remnant.material?.name || remnant.material),
      ),
    );
  }, [filters.materials, remnants]);

  const modalImageItems = useMemo(
    () => cards.filter((remnant) => Boolean(imageSrc(remnant))),
    [cards],
  );

  const selectedImageRemnant =
    selectedImageIndex !== null && selectedImageIndex >= 0 && selectedImageIndex < modalImageItems.length
      ? modalImageItems[selectedImageIndex]
      : null;

  function openImageViewer(remnant) {
    const nextIndex = modalImageItems.findIndex(
      (item) => Number(internalRemnantId(item) || item.id) === Number(internalRemnantId(remnant) || remnant.id),
    );
    if (nextIndex >= 0) setSelectedImageIndex(nextIndex);
  }

  function closeImageViewer() {
    setSelectedImageIndex(null);
  }

  function showPreviousImage() {
    setSelectedImageIndex((current) => {
      if (current === null || !modalImageItems.length) return current;
      return current === 0 ? modalImageItems.length - 1 : current - 1;
    });
  }

  function showNextImage() {
    setSelectedImageIndex((current) => {
      if (current === null || !modalImageItems.length) return current;
      return current === modalImageItems.length - 1 ? 0 : current + 1;
    });
  }

  useEffect(() => {
    if (selectedImageIndex === null) return;
    if (!modalImageItems.length) {
      setSelectedImageIndex(null);
      return;
    }
    if (selectedImageIndex >= modalImageItems.length) {
      setSelectedImageIndex(modalImageItems.length - 1);
    }
  }, [modalImageItems, selectedImageIndex]);

  useEffect(() => {
    if (selectedImageIndex === null) return undefined;

    function handleKeydown(event) {
      if (event.key === "Escape") {
        closeImageViewer();
      } else if (event.key === "ArrowLeft") {
        setSelectedImageIndex((current) => {
          if (current === null || !modalImageItems.length) return current;
          return current === 0 ? modalImageItems.length - 1 : current - 1;
        });
      } else if (event.key === "ArrowRight") {
        setSelectedImageIndex((current) => {
          if (current === null || !modalImageItems.length) return current;
          return current === modalImageItems.length - 1 ? 0 : current + 1;
        });
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [modalImageItems.length, selectedImageIndex]);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8f1ea_0%,#f4ede6_26%,#efe7de_100%)] text-[#2d2623]">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[440px] bg-[radial-gradient(circle_at_top_left,rgba(231,139,75,0.22),transparent_36%),radial-gradient(circle_at_top_right,rgba(93,129,118,0.16),transparent_32%)]" />
        <div className="pointer-events-none absolute left-[-120px] top-[120px] h-[260px] w-[260px] rounded-full bg-[#e7c3a9]/20 blur-3xl" />
        <div className="pointer-events-none absolute right-[-60px] top-[40px] h-[220px] w-[220px] rounded-full bg-[#b7d1c6]/20 blur-3xl" />

        <div className="relative mx-auto max-w-[1680px] px-3 py-3 md:px-6 md:py-5">
          <section className="mb-4 overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,250,246,0.96),rgba(248,240,233,0.88))] px-4 py-5 shadow-[0_24px_70px_rgba(44,29,18,0.10)] backdrop-blur sm:rounded-[32px] sm:px-6">
            <div className="flex justify-center">
              <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
                <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[#9d6f4c] md:text-[15px]">
                  Remnant Inventory System
                </p>
                <h1 className="mt-2 font-sans text-[1.9rem] font-semibold leading-tight text-[#2c211c] md:text-[2.35rem] lg:whitespace-nowrap lg:text-[2.55rem]">
                  Find your remnant before someone else does.
                </h1>
              </div>
            </div>
          </section>

          <section
            id="filter_menu"
            className="mb-4 rounded-[28px] border border-[#ead9cb] bg-[linear-gradient(135deg,rgba(255,250,245,0.98),rgba(249,242,234,0.94))] p-4 shadow-[0_24px_70px_rgba(44,29,18,0.10)] backdrop-blur sm:rounded-[30px] sm:p-5"
          >
            <div className="grid grid-cols-3 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px_110px_140px] xl:grid-cols-[max-content_minmax(340px,1fr)_110px_110px_140px] xl:items-end">
              <div className="col-span-3 min-w-0 lg:col-span-1 xl:max-w-[44rem]">
                <p className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                  Material Types
                </p>
                <div className="flex h-12 snap-x snap-mandatory items-center gap-2 overflow-x-auto whitespace-nowrap rounded-2xl border border-[#d8c7b8] bg-white px-3 py-2 text-sm text-[#2d2623] shadow-sm [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
                  {materialOptions.map((material) => {
                    const checked = filters.materials.includes(material);
                    return (
                      <button
                        key={material}
                        type="button"
                        aria-pressed={checked}
                        onClick={() => toggleMaterialFilter(material)}
                        className={`inline-flex shrink-0 snap-start items-center rounded-xl border px-3 py-2 text-[13px] font-medium transition-all ${
                          checked
                            ? "border-[#d89462] bg-[#fff1e3] text-[#8c4c1c] shadow-sm"
                            : "border-[#efe2d6] bg-[#fffdfb] text-gray-700 hover:border-[#ead8ca] hover:bg-[#fff7f1]"
                        }`}
                      >
                        {material}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="col-span-3 block min-w-0 lg:col-span-1 xl:col-span-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                Stone / ID #
                <input
                  type="text"
                  value={filters.stone}
                  onChange={(event) => setFilters((current) => ({ ...current, stone: event.target.value }))}
                  placeholder="Search by stone name or #741"
                  className="mt-2 h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-medium normal-case tracking-normal text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
                />
              </label>

              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                Min Width
                <input
                  type="number"
                  value={filters.minWidth}
                  onChange={(event) => setFilters((current) => ({ ...current, minWidth: event.target.value }))}
                  placeholder="W"
                  className="mt-2 h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-3 text-sm font-medium text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
                />
              </label>

              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                Min Height
                <input
                  type="number"
                  value={filters.minHeight}
                  onChange={(event) => setFilters((current) => ({ ...current, minHeight: event.target.value }))}
                  placeholder="H"
                  className="mt-2 h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-3 text-sm font-medium text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
                />
              </label>

              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                Status
                <select
                  value={filters.status}
                  onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                  className="mt-2 h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white px-3 text-sm font-medium text-[#2d2623] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
                >
                  <option value="">All</option>
                  <option value="available">Available</option>
                  <option value="hold">On Hold</option>
                  <option value="sold">Sold</option>
                </select>
              </label>
            </div>
          </section>

          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-[24px] border border-white/80 bg-white/70 shadow-[0_18px_40px_rgba(58,37,22,0.07)] sm:rounded-[26px]">
                  <div className="h-48 animate-pulse bg-[linear-gradient(90deg,#f3ebe4,#ece1d7,#f3ebe4)] sm:h-52" />
                  <div className="space-y-3 p-4">
                    <div className="h-4 w-24 animate-pulse rounded-full bg-[#efe2d7]" />
                    <div className="h-4 w-3/4 animate-pulse rounded-full bg-[#f4e9df]" />
                    <div className="h-4 w-2/3 animate-pulse rounded-full bg-[#f4e9df]" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-[28px] border border-rose-200 bg-white/80 px-6 py-10 text-center text-rose-700 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-500">Load Failed</p>
              <h3 className="mt-2 text-xl font-semibold text-rose-800">We couldn&apos;t load the remnants right now.</h3>
              <p className="mt-2 text-sm">{error}</p>
            </div>
          ) : cards.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-[#d7c4b6] bg-white/75 px-6 py-12 text-center text-[#6d584b] shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9c7355]">No Matches</p>
              <h3 className="mt-2 text-2xl font-semibold text-[#2d2623]">No remnants match these filters.</h3>
              <p className="mt-2 text-sm">Try changing the stone name, ID, material, or size filters to widen the search.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {cards.map((remnant, index) => {
                const image = imageSrc(remnant);
                const status = statusText(remnant);
                return (
                  <article
                    key={`${displayRemnantId(remnant)}-${index}`}
                    className="group relative overflow-hidden rounded-[24px] border border-white/80 bg-white/92 shadow-[0_20px_45px_rgba(58,37,22,0.08)] backdrop-blur transition-transform hover:-translate-y-1 sm:rounded-[26px]"
                  >
                    <div className="relative">
                      {String(remnant.status || "").toLowerCase() === "available" ? (
                        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 opacity-100 transition-all duration-200 md:translate-y-1 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100">
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() =>
                                openHoldRequest(remnant).catch((requestError) =>
                                  setNotice({
                                    type: "error",
                                    message: requestError.message,
                                  }),
                                )
                              }
                              className="peer inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/94 text-[#8f4c1a] shadow-lg ring-1 ring-white/80 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:bg-[#fff8f1] active:scale-95 sm:h-11 sm:w-11"
                              aria-label={`Request hold for remnant ${displayRemnantId(remnant)}`}
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="h-5 w-5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.9"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M10.9 4.75H6.75A2 2 0 0 0 4.75 6.75v4.15l7.34 7.35a1.8 1.8 0 0 0 2.55 0l3.62-3.62a1.8 1.8 0 0 0 0-2.55L10.9 4.75Z" />
                                <circle cx="7.75" cy="7.75" r="1.05" />
                                <path d="m9.9 13.95 4.2-4.2" />
                                <circle cx="10.85" cy="10.95" r=".72" />
                                <circle cx="13.2" cy="13.3" r=".72" />
                              </svg>
                            </button>
                            <div className="pointer-events-none absolute bottom-full left-0 mb-2 hidden h-9 translate-y-1 items-center whitespace-nowrap rounded-full bg-[#2c211c]/92 px-3 text-[11px] font-semibold text-white opacity-0 shadow-lg backdrop-blur-sm transition-all peer-hover:translate-y-0 peer-hover:opacity-100 peer-focus-visible:translate-y-0 peer-focus-visible:opacity-100 md:inline-flex">
                              Request a hold
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <button
                        type="button"
                        className="block w-full overflow-hidden text-left"
                        onClick={() => image && openImageViewer(remnant)}
                      >
                        <div className="relative overflow-hidden bg-[linear-gradient(180deg,#f7efe6_0%,#efe4d7_100%)]">
                          <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-24 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.45),transparent_72%)]" />
                          <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex items-start justify-between gap-2 p-3">
                            <span className="inline-flex items-center rounded-full border border-white/70 bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8c6040] shadow-sm backdrop-blur">
                              ID #{displayRemnantId(remnant)}
                          </span>
                          <span
                            className={`inline-flex max-w-[72%] items-center justify-end rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-sm backdrop-blur ${statusBadgeClass(status)}`}
                          >
                            {status}
                          </span>
                        </div>
                        {image ? (
                          <img
                            src={image}
                            alt={`Remnant ${displayRemnantId(remnant)}`}
                            className="h-44 w-full object-cover transition-transform duration-300 motion-safe:md:group-hover:scale-[1.03] sm:h-48"
                            loading={index < 8 ? "eager" : "lazy"}
                          />
                        ) : (
                          <div className="flex h-44 w-full items-center justify-center bg-[#f4ece4] text-sm font-semibold uppercase tracking-[0.16em] text-[#9c7355] sm:h-48">
                            No Image
                          </div>
                        )}
                        </div>
                      </button>
                    </div>

                    <div className="space-y-2.5 p-3.5 text-sm text-[#232323] sm:p-4">
                      <div className="space-y-2 rounded-[22px] bg-[#fbf8f4] px-3 py-3 text-[#4d3d34]">
                        <h3 className="text-[15px] font-semibold leading-snug text-[#2d2623]">
                          {cardTitleText(remnant)}
                        </h3>
                        <p className="text-[13px] font-medium text-[#5f4c42]">
                          Size: {cardSizeText(remnant)}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <footer className="px-3 pb-10 pt-2 md:px-6">
        <div className="mx-auto max-w-[1680px] rounded-[24px] border border-white/70 bg-white/55 px-4 py-5 text-center shadow-sm backdrop-blur sm:rounded-[28px] sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9c7355]">Remnant Inventory System</p>
          <p className="mt-2 text-sm text-[#6d584b]">Live remnant availability with simple hold requests.</p>
        </div>
      </footer>

      {selectedImageRemnant ? (
        <div
          className="fixed inset-0 z-[70] bg-black/75 px-4 py-6"
          onClick={closeImageViewer}
        >
          <div className="mx-auto flex h-full max-w-6xl flex-col">
            <div
              className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-[28px] border border-white/15 bg-white/10 px-4 py-4 text-white backdrop-blur"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85">
                    ID #{displayRemnantId(selectedImageRemnant)}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                    {selectedImageIndex + 1} / {modalImageItems.length}
                  </span>
                </div>
                <h2 className="mt-3 text-xl font-semibold text-white sm:text-2xl">
                  {selectedImageRemnant.name || "Unnamed"}
                </h2>
                <p className="mt-1 text-sm text-white/75">
                  {selectedImageRemnant.material_name || selectedImageRemnant.material || "Unknown"} · {sizeText(selectedImageRemnant)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {modalImageItems.length > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={showPreviousImage}
                      className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/18"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={showNextImage}
                      className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/18"
                    >
                      Next
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={closeImageViewer}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-2xl text-white transition-colors hover:bg-white/20"
                  aria-label="Close image preview"
                >
                  {"\u00D7"}
                </button>
              </div>
            </div>
            <div
              className="flex min-h-0 flex-1 items-center justify-center"
              onClick={(event) => event.stopPropagation()}
            >
              <img
                src={imageSrc(selectedImageRemnant)}
                alt={`Remnant ${displayRemnantId(selectedImageRemnant)}`}
                className="max-h-full max-w-full rounded-[28px] border border-white/15 bg-white/5 object-contain shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
              />
            </div>
          </div>
        </div>
      ) : null}

      {holdRemnant ? (
        <div className="fixed inset-0 z-[72] overflow-y-auto bg-black/50 px-3 py-4 sm:px-4 sm:py-8">
          <div className="mx-auto max-w-2xl overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_24px_70px_rgba(44,29,18,0.10)] sm:rounded-[32px]">
            <div className="flex items-start justify-between gap-4 border-b border-[#eadfd7] bg-[linear-gradient(135deg,#fffaf6_0%,#f7efe8_100%)] px-4 py-5 sm:px-6">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[#8a6a54]">Hold Request</p>
                <h2 className="text-xl font-semibold text-[#2c211c] sm:text-2xl">Request a hold</h2>
                <p className="mt-1 text-sm text-[#7d6759]">
                  Submit a request for remnant #{displayRemnantId(holdRemnant)}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHoldRemnant(null)}
                className="h-10 w-10 rounded-full border border-gray-300 text-xl transition-colors active:bg-gray-200"
                aria-label="Close hold request form"
              >
                {"\u00D7"}
              </button>
            </div>
            <form onSubmit={submitHoldRequest} className="grid gap-4 p-4 sm:p-6">
              {holdFormMessage ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {holdFormMessage}
                </div>
              ) : null}
              <label className="block text-sm font-medium text-gray-700">
                Name
                <input
                  required
                  value={holdForm.requester_name}
                  onChange={(event) => setHoldForm((current) => ({ ...current, requester_name: event.target.value }))}
                  className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Email
                <input
                  required
                  type="email"
                  value={holdForm.requester_email}
                  onChange={(event) => setHoldForm((current) => ({ ...current, requester_email: event.target.value }))}
                  className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Sales Rep
                <select
                  value={holdForm.sales_rep_user_id}
                  onChange={(event) => setHoldForm((current) => ({ ...current, sales_rep_user_id: event.target.value }))}
                  className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                >
                  <option value="">Select sales rep</option>
                  {salesReps.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.display_name || row.full_name || row.email || "User"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Notes
                <textarea
                  rows="3"
                  value={holdForm.notes}
                  onChange={(event) => setHoldForm((current) => ({ ...current, notes: event.target.value }))}
                  className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                  placeholder="Anything the sales rep should know"
                />
              </label>
              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-[#6d584b]">A sales rep will review this request before any hold is approved.</p>
                <button
                  type="submit"
                  disabled={holdSubmitting}
                  className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#232323] px-6 text-sm font-semibold uppercase tracking-[0.16em] text-white shadow-lg shadow-[#232323]/15 transition-all hover:-translate-y-0.5 hover:bg-[#E78B4B] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                >
                  {holdSubmitting ? "Sending..." : "Send Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="pointer-events-none fixed inset-x-3 bottom-4 z-[80] flex justify-center sm:inset-x-auto sm:right-4 sm:justify-end">
          <div
            className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-[22px] border px-4 py-3 shadow-[0_18px_50px_rgba(44,29,18,0.18)] backdrop-blur sm:w-auto ${
              notice.type === "error"
                ? "border-rose-200 bg-white text-rose-700"
                : "border-emerald-200 bg-white text-[#245a42]"
            }`}
            role="status"
            aria-live="polite"
          >
            <div
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                notice.type === "error"
                  ? "bg-rose-100 text-rose-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {notice.type === "error" ? "!" : "\u2713"}
            </div>
            <p className="min-w-0 flex-1 text-sm font-medium">{notice.message}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none text-current/70 transition hover:bg-black/5 hover:text-current"
              aria-label="Dismiss notification"
            >
              {"\u00D7"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
