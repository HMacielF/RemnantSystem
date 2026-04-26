/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useBodyScrollLock from "@/components/use-body-scroll-lock";
import PublicHeader from "@/components/public/PublicHeader";
import PublicHero from "@/components/public/PublicHero";
import PublicFooter from "@/components/public/PublicFooter";
import StatusPill from "@/components/public/StatusPill";

function useDebouncedValue(value, delayMs = 250) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debouncedValue;
}

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

function CardSizeValue({ remnant }) {
  if (remnant.l_shape) {
    return (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="whitespace-nowrap">{`${remnant.width}" x ${remnant.height}"`}</span>
        <span aria-hidden="true" className="text-[var(--brand-orange)]">+</span>
        <span className="whitespace-nowrap">{`${remnant.l_width}" x ${remnant.l_height}"`}</span>
      </span>
    );
  }

  return <span className="whitespace-nowrap">{`${remnant.width}" x ${remnant.height}"`}</span>;
}

function publicCardMetricLayout(remnant) {
  const hasThickness = Boolean(thicknessText(remnant));
  const hasFinish = Boolean(finishText(remnant));
  if (hasThickness && hasFinish) {
    return {
      grid: "grid-cols-2 md:grid-cols-3",
      sizeTile: "col-span-2 md:col-span-1",
    };
  }
  if (hasThickness || hasFinish) {
    return {
      grid: "grid-cols-2",
      sizeTile: "",
    };
  }
  return {
    grid: "grid-cols-1",
    sizeTile: "",
  };
}

function cardTitleText(remnant) {
  const material = String(remnant.material_name || remnant.material || "").trim();
  const stone = String(remnant.name || "").trim();
  if (material && stone) return `${material} | ${stone}`;
  return material || stone || "Unnamed";
}

function stoneNameText(remnant) {
  return String(remnant?.name || "").trim();
}

function brandText(remnant) {
  return String(remnant?.brand_name || "").trim();
}

function thicknessText(remnant) {
  const value = String(remnant?.thickness_name || remnant?.thickness || "").trim();
  if (!value) return "";
  const normalized = value.toLowerCase();
  if (normalized === "unknown" || normalized === "n/a" || normalized === "na") return "";
  return value;
}

function companyText(remnant) {
  return String(remnant?.company_name || remnant?.company || "").trim();
}

function finishText(remnant) {
  return String(remnant?.finish_name || "").trim();
}

function remnantMetricEntries(remnant) {
  return [
    { label: "Size", value: cardSizeText(remnant) },
    ...(thicknessText(remnant) ? [{ label: "Thick", value: thicknessText(remnant), title: "Thickness" }] : []),
    ...(finishText(remnant) ? [{ label: "Finish", value: finishText(remnant) }] : []),
  ];
}

function publicCardHeading(remnant) {
  const brand = brandText(remnant);
  const stone = stoneNameText(remnant);
  if (brand && stone) {
    const normalizedBrand = normalizeStoneLookupName(brand);
    const normalizedStone = normalizeStoneLookupName(stone);
    const brandLead = normalizedBrand.split(/\s+/)[0] || "";
    if (brandLead && normalizedStone.startsWith(`${brandLead} `)) {
      return stone;
    }
    return `${brand} ${stone}`;
  }
  return stone || cardTitleText(remnant);
}

function publicCardSubheading(remnant) {
  const material = String(remnant?.material_name || remnant?.material || "").trim();
  const company = companyText(remnant);
  return [material, company].filter(Boolean).join(" · ");
}

function normalizeStoneLookupName(value) {
  return String(value || "").trim().toLowerCase();
}

function remnantColors(remnant) {
  return Array.isArray(remnant?.colors) ? remnant.colors.filter(Boolean) : [];
}

function colorSwatchStyle(colorName) {
  const normalized = normalizeStoneLookupName(colorName);
  const palette = {
    beige: { backgroundColor: "#d7b98c" },
    black: { backgroundColor: "#1f1d1b" },
    blonde: { backgroundColor: "#e7c98b" },
    blue: { backgroundColor: "#5b88d6" },
    brown: { backgroundColor: "#8b5a2b" },
    cream: { backgroundColor: "#f4ead2" },
    gold: { backgroundColor: "#d4af37" },
    gray: { backgroundColor: "#8b9098" },
    "gray-dark": { backgroundColor: "#5a5f68" },
    "gray-light": { backgroundColor: "#cfd4dc" },
    grey: { backgroundColor: "#8b9098" },
    green: { backgroundColor: "#6f956f" },
    navy: { backgroundColor: "#284a7a" },
    red: { backgroundColor: "#ff3b30" },
    taupe: { backgroundColor: "#8f7762" },
    white: { backgroundColor: "#ffffff" },
  };
  return palette[normalized] || { backgroundColor: "#d6ccc2" };
}

function SelectField({ wrapperClassName = "relative mt-2", className = "", children, ...props }) {
  return (
    <div className={wrapperClassName}>
      <select
        {...props}
        className={`font-inter h-11 w-full appearance-none border bg-white px-3 pr-9 text-[14px] font-normal text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[color:var(--qc-ink-1)] ${className}`}
        style={{ borderColor: "var(--qc-line)", borderRadius: "var(--qc-radius-sharp)" }}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--qc-ink-3)]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 7.5 5 5 5-5" />
      </svg>
    </div>
  );
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

function emptyFilters() {
  return {
    materials: [],
    stone: "",
    minWidth: "",
    minHeight: "",
    status: "",
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

function PublicInventorySkeletonCard() {
  return (
    <div
      className="overflow-hidden bg-white"
      style={{ border: "1px solid var(--qc-line)", borderRadius: "var(--qc-radius-sharp)" }}
    >
      <div className="relative aspect-square overflow-hidden bg-[#f3f1ee]">
        <div className="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,rgba(0,0,0,0.04),rgba(0,0,0,0.08),rgba(0,0,0,0.04))]" />
      </div>
      <div className="space-y-3 p-4">
        <div className="h-3 w-2/5 animate-pulse rounded-sm bg-[rgba(0,0,0,0.06)]" />
        <div className="h-4 w-3/4 animate-pulse rounded-sm bg-[rgba(0,0,0,0.08)]" />
        <div className="mt-4 h-3 w-1/2 animate-pulse rounded-sm bg-[rgba(0,0,0,0.06)]" />
      </div>
    </div>
  );
}

export default function PublicInventoryClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const [filters, setFilters] = useState(() => emptyFilters());
  const debouncedFilters = useDebouncedValue(filters, 250);
  const [remnants, setRemnants] = useState([]);
  const [salesReps, setSalesReps] = useState([]);
  const [materialOptions, setMaterialOptions] = useState([]);
  const [lookupsLoaded, setLookupsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedImageIndex, setSelectedImageIndex] = useState(null);
  const [holdRemnant, setHoldRemnant] = useState(null);
  const [mobileFilterPinned, setMobileFilterPinned] = useState(false);
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
  const materialRailRef = useRef(null);
  const materialRailScrollRef = useRef(0);
  const imageSwipeStartRef = useRef(null);

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
    const params = buildSearchQuery(debouncedFilters);
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    const currentUrl = searchKey ? `${pathname}?${searchKey}` : pathname;
    if (lastPathnameRef.current !== pathname) {
      lastPathnameRef.current = pathname;
      return;
    }
    if (nextUrl === currentUrl) return;
    router.replace(nextUrl, { scroll: false });
  }, [debouncedFilters, pathname, router, searchKey]);

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
        const params = buildSearchQuery(debouncedFilters);
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
  }, [debouncedFilters, lookupsLoaded]);

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
  const isModalOpen = Boolean(selectedImageRemnant || holdRemnant);
  const activeFilterCount =
    filters.materials.length +
    (filters.stone.trim() ? 1 : 0) +
    (filters.minWidth.trim() ? 1 : 0) +
    (filters.minHeight.trim() ? 1 : 0) +
    (filters.status.trim() ? 1 : 0);

  useBodyScrollLock(isModalOpen);

  useEffect(() => {
    const rail = materialRailRef.current;
    if (!rail) return;
    rail.scrollLeft = materialRailScrollRef.current;
  }, [materialOptions, filters.materials]);

  useEffect(() => {
    function syncMobileFilterPinned() {
      const filterMenu = document.getElementById("filter_menu");
      if (!filterMenu) return;
      const rect = filterMenu.getBoundingClientRect();
      setMobileFilterPinned(window.innerWidth < 640 && rect.bottom < 56);
    }

    syncMobileFilterPinned();
    window.addEventListener("scroll", syncMobileFilterPinned, { passive: true });
    window.addEventListener("resize", syncMobileFilterPinned);
    return () => {
      window.removeEventListener("scroll", syncMobileFilterPinned);
      window.removeEventListener("resize", syncMobileFilterPinned);
    };
  }, []);

  function openImageViewer(remnant) {
    const nextIndex = modalImageItems.findIndex(
      (item) => Number(internalRemnantId(item) || item.id) === Number(internalRemnantId(remnant) || remnant.id),
    );
    if (nextIndex >= 0) setSelectedImageIndex(nextIndex);
  }

  function closeImageViewer() {
    setSelectedImageIndex(null);
  }

  function handleImageViewerTouchStart(event) {
    const touch = event.touches?.[0];
    if (!touch) return;
    imageSwipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function handleImageViewerTouchEnd(event) {
    const start = imageSwipeStartRef.current;
    imageSwipeStartRef.current = null;
    if (!start || modalImageItems.length <= 1) return;

    const touch = event.changedTouches?.[0];
    if (!touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY)) return;

    if (deltaX < 0) {
      showNextImage();
    } else {
      showPreviousImage();
    }
  }

  function openFilterMenu() {
    const filterMenu = document.getElementById("filter_menu");
    if (!filterMenu) return;
    filterMenu.scrollIntoView({ behavior: "smooth", block: "start" });
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
    <main className="font-inter min-h-screen bg-[color:var(--qc-bg-page)] text-[color:var(--qc-ink-1)]">
      <PublicHeader />
      <PublicHero slabCount={cards.length} />

      <div className="relative">
        <div className="relative mx-auto w-full max-w-[1680px] px-8 pb-16">

          <section
            id="filter_menu"
            className="mb-8 bg-white p-5"
            style={{ border: "1px solid var(--qc-line)", borderRadius: "var(--qc-radius-sharp)" }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(260px,1fr)_110px_110px_160px] lg:items-end">
              <label className="block text-[10.5px] uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                Search
                <div className="relative mt-2">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--qc-ink-3)]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="text"
                    value={filters.stone}
                    onChange={(event) => setFilters((current) => ({ ...current, stone: event.target.value }))}
                    placeholder="Search stone, brand, finish, or ID #741"
                    className="font-inter h-11 w-full bg-white pl-10 pr-3 text-[14px] font-normal normal-case tracking-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors focus:border-[color:var(--qc-ink-1)]"
                    style={{
                      border: "1px solid var(--qc-line)",
                      borderRadius: "var(--qc-radius-sharp)",
                    }}
                  />
                </div>
              </label>

              <label className="block text-[10.5px] uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                Min W&quot;
                <input
                  type="text"
                  inputMode="decimal"
                  value={filters.minWidth}
                  onChange={(event) => setFilters((current) => ({ ...current, minWidth: event.target.value }))}
                  placeholder="0"
                  className="font-inter mt-2 h-11 w-full bg-white px-3 text-[14px] font-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors focus:border-[color:var(--qc-ink-1)]"
                  style={{ border: "1px solid var(--qc-line)", borderRadius: "var(--qc-radius-sharp)" }}
                />
              </label>

              <label className="block text-[10.5px] uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                Min H&quot;
                <input
                  type="text"
                  inputMode="decimal"
                  value={filters.minHeight}
                  onChange={(event) => setFilters((current) => ({ ...current, minHeight: event.target.value }))}
                  placeholder="0"
                  className="font-inter mt-2 h-11 w-full bg-white px-3 text-[14px] font-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors focus:border-[color:var(--qc-ink-1)]"
                  style={{ border: "1px solid var(--qc-line)", borderRadius: "var(--qc-radius-sharp)" }}
                />
              </label>

              <label className="block text-[10.5px] uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                Status
                <SelectField
                  value={filters.status}
                  onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                  wrapperClassName="relative mt-2"
                  className="px-3"
                >
                  <option value="">All</option>
                  <option value="available">Available</option>
                  <option value="hold">On Hold</option>
                  <option value="sold">Sold</option>
                </SelectField>
              </label>
            </div>

            {materialOptions.length ? (
              <div
                className="mt-5 flex flex-wrap items-center gap-3 pt-5"
                style={{ borderTop: "1px solid var(--qc-line)" }}
              >
                <span className="text-[10.5px] uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                  Material
                </span>
                <button
                  type="button"
                  aria-pressed={filters.materials.length === 0}
                  onClick={() =>
                    setFilters((current) => ({ ...current, materials: [] }))
                  }
                  className="font-inter inline-flex items-center px-3 py-1.5 text-[12px] font-medium transition-colors"
                  style={{
                    border: "1px solid var(--qc-line)",
                    borderRadius: "var(--qc-radius-sharp)",
                    backgroundColor: filters.materials.length === 0 ? "var(--qc-ink-1)" : "transparent",
                    color: filters.materials.length === 0 ? "#fff" : "var(--qc-ink-1)",
                    borderColor: filters.materials.length === 0 ? "var(--qc-ink-1)" : "var(--qc-line)",
                  }}
                >
                  All
                </button>
                <div
                  ref={materialRailRef}
                  onScroll={(event) => {
                    materialRailScrollRef.current = event.currentTarget.scrollLeft;
                  }}
                  className="flex flex-wrap items-center gap-2 text-[12px] text-[color:var(--qc-ink-1)]"
                >
                  {materialOptions.map((material) => {
                    const checked = filters.materials.includes(material);
                    return (
                      <button
                        key={material}
                        type="button"
                        aria-pressed={checked}
                        onClick={() => toggleMaterialFilter(material)}
                        className="font-inter inline-flex shrink-0 items-center px-3 py-1.5 text-[12px] font-medium transition-colors"
                        style={{
                          border: "1px solid",
                          borderRadius: "var(--qc-radius-sharp)",
                          backgroundColor: checked ? "var(--qc-ink-1)" : "transparent",
                          color: checked ? "#fff" : "var(--qc-ink-1)",
                          borderColor: checked ? "var(--qc-ink-1)" : "var(--qc-line)",
                        }}
                      >
                        {material}
                      </button>
                    );
                  })}
                </div>
                <span className="ml-auto text-[12px] text-[color:var(--qc-ink-3)]">
                  {cards.length} {cards.length === 1 ? "result" : "results"}
                </span>
              </div>
            ) : null}
          </section>

          {loading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <PublicInventorySkeletonCard key={index} />
              ))}
            </div>
          ) : error ? (
            <div
              className="bg-white px-6 py-12 text-center"
              style={{
                border: "1px solid var(--qc-line)",
                borderRadius: "var(--qc-radius-sharp)",
                borderLeft: "2px solid var(--qc-status-sold-dot)",
              }}
            >
              <p className="font-italic-accent text-[18px] text-[color:var(--qc-status-sold-fg)]">
                Couldn&apos;t load the inventory.
              </p>
              <p className="mt-2 text-[13px] text-[color:var(--qc-ink-2)]">{error}</p>
            </div>
          ) : cards.length === 0 ? (
            <div className="px-6 py-20 text-center">
              <p className="font-italic-accent text-[28px] text-[color:var(--qc-ink-2)]">No matches.</p>
              <button
                type="button"
                onClick={() => {
                  setFilters(emptyFilters());
                  router.replace(pathname, { scroll: false });
                }}
                className="font-inter mt-5 text-[13px] text-[color:var(--qc-ink-1)]"
                style={{
                  textDecoration: "underline",
                  textDecorationColor: "var(--qc-line-strong)",
                  textUnderlineOffset: 4,
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cards.map((remnant, index) => {
                const image = imageSrc(remnant);
                const status = statusText(remnant);
                const isAvailable = String(remnant.status || "").toLowerCase() === "available";
                const eyebrow = publicCardSubheading(remnant);
                const heading = publicCardHeading(remnant);
                const colors = remnantColors(remnant);
                const thick = thicknessText(remnant);
                const finish = finishText(remnant);
                return (
                  <article
                    key={`${displayRemnantId(remnant)}-${index}`}
                    className="group relative flex flex-col overflow-hidden bg-[color:var(--qc-bg-surface)] transition-colors"
                    style={{
                      border: "1px solid var(--qc-line)",
                      borderRadius: "var(--qc-radius-sharp)",
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.borderColor = "var(--qc-line-strong)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.borderColor = "var(--qc-line)";
                    }}
                  >
                    <div className="relative aspect-square overflow-hidden bg-[#f3f1ee]">
                      {image ? (
                        <button
                          type="button"
                          className="absolute inset-0 z-[1] block h-full w-full overflow-hidden text-left"
                          onClick={() => openImageViewer(remnant)}
                          aria-label={`Open image for remnant ${displayRemnantId(remnant)}`}
                        >
                          <img
                            src={image}
                            alt={`Remnant ${displayRemnantId(remnant)}`}
                            className="h-full w-full object-cover"
                            decoding="async"
                            loading={index < 8 ? "eager" : "lazy"}
                          />
                        </button>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[11px] uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
                          No image
                        </div>
                      )}

                      <div className="pointer-events-none absolute left-3 top-3 z-[2]">
                        <StatusPill status={status} label={`#${displayRemnantId(remnant)}`} />
                      </div>

                      {isAvailable ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openHoldRequest(remnant).catch((requestError) =>
                              setNotice({
                                type: "error",
                                message: requestError.message,
                              })
                            );
                          }}
                          className="font-inter absolute bottom-3 right-3 z-[3] inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white"
                          style={{
                            backgroundColor: "var(--qc-ink-1)",
                            borderRadius: "var(--qc-radius-sharp)",
                          }}
                          aria-label="Request a hold"
                          title="Request a hold"
                        >
                          Request hold
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M5 12h14" />
                            <path d="m13 5 7 7-7 7" />
                          </svg>
                        </button>
                      ) : null}
                    </div>

                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <div>
                        {eyebrow ? (
                          <p
                            className="font-inter text-[10px] font-semibold uppercase leading-none tracking-[0.18em]"
                            style={{ color: "var(--qc-orange)" }}
                          >
                            {eyebrow}
                          </p>
                        ) : null}
                        <h3 className="font-inter mt-2 text-[17px] font-medium leading-snug tracking-[-0.01em] text-[color:var(--qc-ink-1)]">
                          {heading}
                        </h3>
                        {colors.length ? (
                          <div className="mt-3 flex items-center gap-2">
                            <div className="flex items-center gap-1.5">
                              {colors.slice(0, 3).map((color) => (
                                <span
                                  key={`${displayRemnantId(remnant)}-${color}`}
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5 rounded-full"
                                  style={{
                                    ...colorSwatchStyle(color),
                                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.10)",
                                  }}
                                  title={color}
                                />
                              ))}
                            </div>
                            <span className="text-[11px] text-[color:var(--qc-ink-3)]">
                              {colors.slice(0, 3).join(" · ")}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      <div
                        className="mt-auto flex items-end justify-between gap-3 pt-3"
                        style={{ borderTop: "1px solid var(--qc-line)" }}
                      >
                        <div className="min-w-0">
                          <p className="font-inter flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
                            <span>Size</span>
                            {remnant.l_shape ? (
                              <span
                                className="px-1 text-[9px] tracking-[0.12em] text-[color:var(--qc-ink-2)]"
                                style={{ border: "1px solid var(--qc-line-strong)" }}
                              >
                                L
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-1 text-[13px] font-medium text-[color:var(--qc-ink-1)]">
                            <CardSizeValue remnant={remnant} />
                          </p>
                          {thick ? (
                            <p
                              className="mt-0.5 text-[11px] text-[color:var(--qc-ink-3)]"
                              style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
                            >
                              {thick}
                            </p>
                          ) : null}
                        </div>
                        {finish ? (
                          <div className="text-right">
                            <p className="font-inter text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
                              Finish
                            </p>
                            <p className="mt-1 text-[13px] font-medium text-[color:var(--qc-ink-1)]">
                              {finish}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <PublicFooter slabCount={cards.length} />

      {selectedImageRemnant ? (
        <div
          className="fixed inset-0 z-[74] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_24%),linear-gradient(180deg,rgba(12,12,12,0.86),rgba(8,8,8,0.92))] px-3 py-4 sm:px-4 sm:py-6"
          onClick={closeImageViewer}
        >
          <div className="mx-auto flex h-full max-w-[1180px] flex-col" onClick={(event) => event.stopPropagation()}>
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <div className="flex h-full w-full flex-col overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(30,30,30,0.82),rgba(16,16,16,0.9))] shadow-[0_32px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-4 py-4 text-white sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85">
                        ID #{displayRemnantId(selectedImageRemnant)}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                        {selectedImageIndex + 1} / {modalImageItems.length}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusBadgeClass(statusText(selectedImageRemnant))}`}>
                        {statusText(selectedImageRemnant)}
                      </span>
                    </div>
                    <h2 className="font-display mt-3 text-xl font-semibold text-white sm:text-[2rem]">
                      {publicCardHeading(selectedImageRemnant)}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/68">
                      {publicCardSubheading(selectedImageRemnant) ? (
                        <span>{publicCardSubheading(selectedImageRemnant)}</span>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {remnantMetricEntries(selectedImageRemnant).map((entry) => (
                        <span
                          key={`${displayRemnantId(selectedImageRemnant)}-${entry.label}`}
                          title={entry.title}
                          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] text-white/88"
                        >
                          <span className="font-semibold uppercase tracking-[0.08em] text-white/60">{entry.label}</span>
                          <span className="whitespace-nowrap font-medium">{entry.value}</span>
                        </span>
                      ))}
                      {remnantColors(selectedImageRemnant).map((color) => (
                        <span
                          key={`${displayRemnantId(selectedImageRemnant)}-viewer-${color}`}
                          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-[11px] font-medium text-white/82"
                        >
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 rounded-full border border-white/20"
                            style={colorSwatchStyle(color)}
                          />
                          {color}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={closeImageViewer}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/8 text-2xl text-white transition-colors hover:border-white/25 hover:bg-white/16"
                      aria-label="Close image preview"
                    >
                      {"\u00D7"}
                    </button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-4">
                  <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_26%),linear-gradient(180deg,#1a1a1a_0%,#111111_100%)] p-2 sm:p-3">
                    {modalImageItems.length > 1 ? (
                      <>
                        <button
                          type="button"
                          onClick={showPreviousImage}
                          className="absolute left-3 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/35 text-2xl text-white shadow-lg backdrop-blur transition-colors hover:bg-black/50"
                          aria-label="Previous image"
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          onClick={showNextImage}
                          className="absolute right-3 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/35 text-2xl text-white shadow-lg backdrop-blur transition-colors hover:bg-black/50"
                          aria-label="Next image"
                        >
                          ›
                        </button>
                      </>
                    ) : null}
                    <img
                      src={imageSrc(selectedImageRemnant)}
                      alt={`Remnant ${displayRemnantId(selectedImageRemnant)}`}
                      className="max-h-full max-w-full rounded-[24px] object-contain shadow-[0_24px_60px_rgba(0,0,0,0.3)]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {holdRemnant ? (
        <div className="fixed inset-0 z-[72] overflow-y-auto bg-black/50 px-3 py-4 sm:px-4 sm:py-8">
          <div className="mx-auto max-w-2xl overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_24px_70px_rgba(44,29,18,0.10)] sm:rounded-[32px]">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,var(--brand-white)_100%)] px-4 py-4 sm:px-6 sm:py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Hold Request</p>
                <h2 className="font-display text-xl font-semibold text-[var(--brand-ink)] sm:text-2xl">Request this remnant</h2>
                <p className="mt-1 text-sm text-[rgba(35,35,35,0.68)]">
                  Send your request and we&apos;ll confirm availability with your sales rep before anything is placed on hold.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHoldRemnant(null)}
                className="h-10 w-10 rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)] active:bg-[rgba(247,134,57,0.08)]"
                aria-label="Close hold request form"
              >
                {"\u00D7"}
              </button>
            </div>
            <form onSubmit={submitHoldRequest} className="grid gap-3 p-4 sm:gap-4 sm:p-6">
              <section className="rounded-[26px] border border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,var(--brand-white)_100%)] p-3.5 shadow-[0_16px_38px_rgba(25,27,28,0.06)] sm:p-4">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_240px] sm:items-start">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-orange)]">
                      Remnant Summary
                    </p>
                    <div className="mt-3">
                      <h3 className="font-display text-lg font-semibold text-[var(--brand-ink)] sm:text-xl">
                        {publicCardHeading(holdRemnant)}
                      </h3>
                      {publicCardSubheading(holdRemnant) ? (
                        <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgba(35,35,35,0.54)]">
                          {publicCardSubheading(holdRemnant)}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full border border-[var(--brand-line)] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-orange-deep)]">
                          ID #{displayRemnantId(holdRemnant)}
                        </span>
                        <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusBadgeClass(statusText(holdRemnant))}`}>
                          {statusText(holdRemnant)}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[20px] border border-[var(--brand-line)] bg-white/92 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                            Material
                          </p>
                          <p className="mt-1 text-sm font-medium text-[var(--brand-ink)]">
                            {holdRemnant.material_name || holdRemnant.material || "Not listed"}
                          </p>
                        </div>
                        {remnantMetricEntries(holdRemnant).map((entry) => (
                          <div
                            key={`${displayRemnantId(holdRemnant)}-hold-${entry.label}`}
                            className="rounded-[20px] border border-[var(--brand-line)] bg-white/92 px-4 py-3"
                          >
                            <p
                              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]"
                              title={entry.title}
                            >
                              {entry.label}
                            </p>
                            <p className="mt-1 text-sm font-medium text-[var(--brand-ink)]">{entry.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="self-start">
                    {imageSrc(holdRemnant) ? (
                      <button
                        type="button"
                        onClick={() => openImageViewer(holdRemnant)}
                        className="overflow-hidden rounded-[22px] border border-white/80 bg-white text-left shadow-[0_12px_24px_rgba(25,27,28,0.08)] transition-transform hover:-translate-y-0.5"
                      >
                        <img
                          src={imageSrc(holdRemnant)}
                          alt={`Remnant ${displayRemnantId(holdRemnant)}`}
                          className="h-36 w-full bg-[var(--brand-white)] p-2 object-contain object-center"
                        />
                      </button>
                    ) : (
                      <div className="flex h-36 items-center justify-center rounded-[22px] border border-dashed border-[var(--brand-line)] bg-white/80 text-center text-sm text-[rgba(35,35,35,0.62)]">
                        No image available
                      </div>
                    )}
                    {remnantColors(holdRemnant).length ? (
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        {remnantColors(holdRemnant).map((color) => (
                          <span
                            key={`${displayRemnantId(holdRemnant)}-hold-color-${color}`}
                            className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-line)] bg-white/92 px-2.5 py-1 text-[11px] font-semibold text-[rgba(25,27,28,0.72)]"
                          >
                            <span
                              aria-hidden="true"
                              className="h-3 w-3 rounded-full border border-black/10 shadow-inner"
                              style={colorSwatchStyle(color)}
                            />
                            {color}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              {holdFormMessage ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {holdFormMessage}
                </div>
              ) : null}

              <section className="rounded-[26px] border border-[var(--brand-line)] bg-white p-3.5 shadow-[0_12px_28px_rgba(25,27,28,0.05)] sm:p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-orange)]">
                  Your Contact
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Name
                    <input
                      required
                      value={holdForm.requester_name}
                      onChange={(event) => setHoldForm((current) => ({ ...current, requester_name: event.target.value }))}
                      className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm text-[var(--brand-ink)] shadow-sm outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.10)]"
                      placeholder="Your full name"
                    />
                  </label>
                  <label className="block text-sm font-medium text-gray-700">
                    Email
                    <input
                      required
                      type="email"
                      value={holdForm.requester_email}
                      onChange={(event) => setHoldForm((current) => ({ ...current, requester_email: event.target.value }))}
                      className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm text-[var(--brand-ink)] shadow-sm outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.10)]"
                      placeholder="you@example.com"
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-[26px] border border-[var(--brand-line)] bg-white p-3.5 shadow-[0_12px_28px_rgba(25,27,28,0.05)] sm:p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-orange)]">
                  Request Details
                </p>
                <div className="mt-4 grid gap-4">
                  <label className="block text-sm font-medium text-gray-700">
                    Sales Rep
                    <SelectField
                      value={holdForm.sales_rep_user_id}
                      onChange={(event) => setHoldForm((current) => ({ ...current, sales_rep_user_id: event.target.value }))}
                      disabled={salesReps.length === 0}
                      wrapperClassName="relative mt-2"
                      className="disabled:bg-[rgba(35,35,35,0.05)] disabled:text-[rgba(35,35,35,0.42)]"
                    >
                      <option value="">
                        {salesReps.length === 0 ? "No active sales reps available" : "Select sales rep"}
                      </option>
                      {salesReps.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.display_name || row.full_name || row.email || "User"}
                        </option>
                      ))}
                    </SelectField>
                  </label>

                  <label className="block text-sm font-medium text-gray-700">
                    Notes
                    <textarea
                      rows="4"
                      value={holdForm.notes}
                      onChange={(event) => setHoldForm((current) => ({ ...current, notes: event.target.value }))}
                      className="mt-2 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-[var(--brand-ink)] shadow-sm outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.10)]"
                      placeholder="Anything the sales rep should know about timing, pickup, or questions"
                    />
                  </label>
                </div>
              </section>

              <div className="flex flex-col gap-3 rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-white)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-6 text-[rgba(35,35,35,0.68)]">
                  {salesReps.length === 0
                    ? "No active sales reps are set up yet. Create one in the admin workspace first."
                    : "This is a request only. Your sales rep will review it and follow up with next steps before any hold is approved."}
                </p>
                <input
                  type="hidden"
                  name="remnant_id"
                  value={internalRemnantId(holdRemnant) || ""}
                />
                <button
                  type="submit"
                  disabled={holdSubmitting || salesReps.length === 0}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,var(--brand-orange)_0%,var(--brand-orange-deep)_100%)] px-6 text-sm font-semibold text-white shadow-btn-orange transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_46px_rgba(247,134,57,0.30)] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                >
                  {holdSubmitting ? "Sending..." : "Send hold request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4">
          <div
            className="font-inter pointer-events-auto flex max-w-md items-center gap-3 px-5 py-3 text-[13px] text-white"
            style={{
              backgroundColor:
                notice.type === "error" ? "var(--qc-status-sold-fg)" : "var(--qc-ink-1)",
              borderRadius: "var(--qc-radius-sharp)",
              boxShadow: "var(--qc-shadow-toast)",
            }}
            role="status"
            aria-live="polite"
          >
            <p className="min-w-0 flex-1">{notice.message}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-[18px] leading-none text-white/70 transition-colors hover:text-white"
              aria-label="Dismiss notification"
            >
              {"\u00D7"}
            </button>
          </div>
        </div>
      ) : null}

      {mobileFilterPinned && !isModalOpen ? (
        <div className="fixed inset-x-4 bottom-4 z-[75] sm:hidden">
          <button
            type="button"
            onClick={openFilterMenu}
            className="font-inter flex h-11 w-full items-center justify-center gap-2 bg-white px-4 text-[13px] font-medium text-[color:var(--qc-ink-1)]"
            style={{
              border: "1px solid var(--qc-line-strong)",
              borderRadius: "var(--qc-radius-sharp)",
              boxShadow: "var(--qc-shadow-toast)",
            }}
          >
            Filters
            {activeFilterCount ? (
              <span
                className="px-1.5 py-0.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: "var(--qc-ink-1)", borderRadius: "var(--qc-radius-sharp)" }}
              >
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        </div>
      ) : null}
    </main>
  );
}
