/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useBodyScrollLock from "@/components/use-body-scroll-lock";

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
        className={`h-12 w-full appearance-none rounded-2xl border border-[var(--brand-line)] bg-white px-4 pr-10 text-sm font-medium text-[var(--brand-ink)] shadow-[0_1px_0_rgba(255,255,255,0.75),0_10px_24px_rgba(25,27,28,0.05)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] ${className}`}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-orange)]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
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
    <div className="overflow-hidden rounded-[24px] border border-white/80 bg-white/92 shadow-[0_14px_30px_rgba(58,37,22,0.07)] sm:rounded-[26px]">
      <div className="relative aspect-[4/3] overflow-hidden bg-[linear-gradient(180deg,var(--brand-white)_0%,rgba(255,255,255,0.92)_100%)]">
        <div className="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,rgba(242,242,242,0.96),rgba(255,255,255,0.88),rgba(242,242,242,0.96))]" />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="h-6 w-20 animate-pulse rounded-full bg-white/75" />
          <div className="h-6 w-24 animate-pulse rounded-full bg-white/70" />
        </div>
      </div>
      <div className="space-y-2.5 p-3.5 sm:p-4">
        <div className="rounded-[22px] bg-[var(--brand-white)] px-3 py-3">
          <div className="h-4 w-3/5 animate-pulse rounded-full bg-[rgba(35,35,35,0.10)]" />
          <div className="mt-3 h-4 w-2/3 animate-pulse rounded-full bg-[rgba(35,35,35,0.08)]" />
        </div>
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
    <main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,var(--brand-white)_52%,rgba(247,134,57,0.08)_100%)] text-[var(--brand-ink)]">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[440px] bg-[radial-gradient(circle_at_top_left,rgba(247,134,57,0.22),transparent_36%),radial-gradient(circle_at_top_right,rgba(25,27,28,0.09),transparent_32%)]" />
        <div className="pointer-events-none absolute left-[-120px] top-[120px] h-[260px] w-[260px] rounded-full bg-[rgba(247,134,57,0.18)] blur-3xl" />
        <div className="pointer-events-none absolute right-[-60px] top-[40px] h-[220px] w-[220px] rounded-full bg-[rgba(25,27,28,0.08)] blur-3xl" />

        <div className="relative mx-auto w-full max-w-[1680px] px-3 py-3 sm:px-4 md:px-6 md:py-5 2xl:px-8">
          <section className="mb-4 overflow-hidden rounded-[28px] border border-[var(--brand-line)] bg-[linear-gradient(135deg,rgba(255,255,255,0.99),rgba(242,242,242,0.96))] px-4 py-5 shadow-[0_24px_70px_rgba(25,27,28,0.10)] backdrop-blur sm:rounded-[32px] sm:px-6 lg:px-8">
            <div className="flex justify-center">
              <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
                <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-orange)] md:text-[15px]">
                  Remnant Inventory System
                </p>
                <h1 className="font-display mt-2 text-[1.9rem] font-semibold leading-tight text-[var(--brand-ink)] md:text-[2.15rem] lg:text-[2.35rem] xl:whitespace-nowrap">
                  Find your remnant before someone else does.
                </h1>
              </div>
            </div>
          </section>

          <section
            id="filter_menu"
            className="mb-4 rounded-[28px] border border-[var(--brand-line)] bg-[linear-gradient(135deg,rgba(255,255,255,0.99),rgba(242,242,242,0.96))] p-4 shadow-[0_24px_70px_rgba(25,27,28,0.08)] backdrop-blur sm:rounded-[30px] sm:p-5"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[fit-content(30rem)_minmax(260px,1fr)_110px_110px_140px] xl:items-end">
              <div className="min-w-0 sm:col-span-2 lg:col-span-1 xl:max-w-[30rem]">
                <p className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                  Material Types
                </p>
                <div className="overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white px-1.5 py-1 shadow-[0_1px_0_rgba(255,255,255,0.8),0_10px_24px_rgba(25,27,28,0.05)]">
                  <div
                    ref={materialRailRef}
                    onScroll={(event) => {
                      materialRailScrollRef.current = event.currentTarget.scrollLeft;
                    }}
                    className="flex min-h-10 w-full max-w-full snap-x snap-mandatory items-center gap-2 overflow-x-auto whitespace-nowrap px-0.5 text-sm text-[var(--brand-ink)] [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
                  >
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
                              ? "border-[var(--brand-orange)] bg-[rgba(247,134,57,0.12)] text-[var(--brand-orange-deep)] shadow-sm"
                              : "border-[var(--brand-line)] bg-white text-[rgba(25,27,28,0.72)] hover:border-[rgba(247,134,57,0.32)] hover:bg-[var(--brand-shell)]"
                          }`}
                        >
                          {material}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <label className="block min-w-0 sm:col-span-2 lg:col-span-1 xl:col-span-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                Stone / Brand / Color / Finish / ID #
                <input
                  type="text"
                  value={filters.stone}
                  onChange={(event) => setFilters((current) => ({ ...current, stone: event.target.value }))}
                  placeholder="Search by stone, brand, color, finish or #741"
                  className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-medium normal-case tracking-normal text-[var(--brand-ink)] placeholder:text-[rgba(25,27,28,0.45)] shadow-[0_1px_0_rgba(255,255,255,0.75),0_10px_24px_rgba(25,27,28,0.05)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                />
              </label>

              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                Min Width
                <input
                  type="text"
                  inputMode="decimal"
                  value={filters.minWidth}
                  onChange={(event) => setFilters((current) => ({ ...current, minWidth: event.target.value }))}
                  placeholder="W"
                  className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-3 text-sm font-medium text-[var(--brand-ink)] placeholder:text-[rgba(25,27,28,0.45)] shadow-[0_1px_0_rgba(255,255,255,0.75),0_10px_24px_rgba(25,27,28,0.05)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                />
              </label>

              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                Min Height
                <input
                  type="text"
                  inputMode="decimal"
                  value={filters.minHeight}
                  onChange={(event) => setFilters((current) => ({ ...current, minHeight: event.target.value }))}
                  placeholder="H"
                  className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-3 text-sm font-medium text-[var(--brand-ink)] placeholder:text-[rgba(25,27,28,0.45)] shadow-[0_1px_0_rgba(255,255,255,0.75),0_10px_24px_rgba(25,27,28,0.05)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                />
              </label>

              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
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
          </section>

          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <PublicInventorySkeletonCard key={index} />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-[28px] border border-rose-200 bg-white/80 px-6 py-10 text-center text-rose-700 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-500">Load Failed</p>
              <h3 className="font-display mt-2 text-xl font-semibold text-rose-800">We couldn&apos;t load the remnants right now.</h3>
              <p className="mt-2 text-sm">{error}</p>
            </div>
          ) : cards.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-[var(--brand-line)] bg-white/88 px-6 py-12 text-center text-[rgba(35,35,35,0.68)] shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">No Matches</p>
              <h3 className="font-display mt-2 text-2xl font-semibold text-[var(--brand-ink)]">No remnants match these filters.</h3>
              <p className="mt-2 text-sm">Try changing the stone, brand, color, finish, ID, material, or size filters to widen the search.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {cards.map((remnant, index) => {
                const image = imageSrc(remnant);
                const status = statusText(remnant);
                const metricLayout = publicCardMetricLayout(remnant);
                return (
                  <article
                    key={`${displayRemnantId(remnant)}-${index}`}
                    className="group relative overflow-hidden rounded-[24px] border border-[var(--brand-line)] bg-[rgba(255,255,255,0.96)] shadow-[0_14px_30px_rgba(25,27,28,0.08)] transition-transform [contain-intrinsic-size:420px] [content-visibility:auto] hover:-translate-y-1 sm:rounded-[26px]"
                  >
                    <div className="relative">
                      <div className="overflow-hidden">
                        <div className="relative aspect-[4/3] overflow-hidden bg-[linear-gradient(180deg,var(--brand-white)_0%,rgba(255,255,255,0.94)_100%)]">
                          {image ? (
                            <button
                              type="button"
                              className="absolute inset-0 z-[1] block w-full overflow-hidden text-left"
                              onClick={() => openImageViewer(remnant)}
                              aria-label={`Open image for remnant ${displayRemnantId(remnant)}`}
                            />
                          ) : null}
                          <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-24 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.45),transparent_72%)]" />
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-16 bg-[linear-gradient(180deg,rgba(35,35,35,0),rgba(35,35,35,0.18))]" />
                          <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex items-start justify-between gap-2 p-3">
                            <span className="inline-flex items-center rounded-full border border-white/70 bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-orange-deep)] shadow-sm backdrop-blur">
                              ID #{displayRemnantId(remnant)}
                          </span>
                          <span
                            className={`inline-flex max-w-[72%] items-center justify-end rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-sm backdrop-blur ${statusBadgeClass(status)}`}
                          >
                            {status}
                          </span>
                        </div>
                          {image ? (
                          <div className="pointer-events-none flex h-full w-full items-center justify-center overflow-hidden p-1.5 sm:p-2">
                            <img
                              src={image}
                              alt={`Remnant ${displayRemnantId(remnant)}`}
                              className="h-full w-full scale-[1.05] object-contain object-center transition-transform duration-300 motion-safe:md:group-hover:scale-[1.08]"
                              decoding="async"
                              loading={index < 8 ? "eager" : "lazy"}
                            />
                          </div>
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[var(--brand-white)] text-sm font-semibold uppercase tracking-[0.16em] text-[var(--brand-orange)]">
                            No Image
                          </div>
                        )}
                        {image ? (
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex justify-center pb-2 sm:hidden">
                            <span className="rounded-full border border-white/60 bg-white/78 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgba(35,35,35,0.68)] shadow-sm backdrop-blur">
                              Tap image to enlarge
                            </span>
                          </div>
                        ) : null}
                        {String(remnant.status || "").toLowerCase() === "available" ? (
                          <div className="absolute bottom-0 left-0 z-[3] p-3">
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
                              className="group/hold inline-flex h-10 items-center justify-center gap-0 overflow-hidden rounded-2xl border border-[var(--brand-orange)] bg-[rgba(247,134,57,0.94)] pl-2.5 pr-2.5 text-[11px] font-medium text-white shadow-[0_12px_30px_rgba(25,27,28,0.18)] backdrop-blur transition-all hover:-translate-y-0.5 hover:gap-2 hover:bg-[var(--brand-orange-deep)] hover:border-[var(--brand-orange-deep)] active:scale-[0.99]"
                              aria-label="Request a hold"
                              title="Request a hold"
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="h-4 w-4"
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
                              <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover/hold:max-w-[10rem] group-hover/hold:opacity-100">
                                Request a hold
                              </span>
                            </button>
                          </div>
                        ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="p-3 text-sm text-[#232323] sm:p-3.5">
                      <div className="rounded-[22px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,rgba(242,242,242,0.92)_100%)] px-3.5 py-3 text-[var(--brand-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                        <div className="min-w-0">
                          <div className="min-w-0">
                            <h3 className="font-display text-[16px] font-semibold leading-snug text-[var(--brand-ink)] sm:text-[17px]">
                              {publicCardHeading(remnant)}
                            </h3>
                            {publicCardSubheading(remnant) ? (
                              <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgba(35,35,35,0.54)]">
                                {publicCardSubheading(remnant)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className={`mt-3 grid items-stretch gap-2 ${metricLayout.grid}`}>
                          <div className={`flex min-w-0 flex-col rounded-[16px] border border-[var(--brand-line)] bg-white/88 px-3 py-2 ${metricLayout.sizeTile}`}>
                            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-orange)] sm:text-[11px]">
                              Size
                            </p>
                            <p className="mt-1 text-[12px] font-semibold leading-tight text-[var(--brand-ink)] sm:text-[13px]">
                              <CardSizeValue remnant={remnant} />
                            </p>
                          </div>
                          {thicknessText(remnant) ? (
                            <div className="flex min-w-0 flex-col rounded-[16px] border border-[var(--brand-line)] bg-white/88 px-3 py-2">
                              <p
                                className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-orange)] sm:text-[11px]"
                                title="Thickness"
                              >
                                Thick
                              </p>
                              <p className="mt-1 break-words text-[13px] font-semibold leading-tight text-[var(--brand-ink)] sm:text-[14px]">
                                {thicknessText(remnant)}
                              </p>
                            </div>
                          ) : null}
                          {finishText(remnant) ? (
                            <div className="flex min-w-0 flex-col rounded-[16px] border border-[var(--brand-line)] bg-white/88 px-3 py-2">
                              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-orange)] sm:text-[11px]">
                                Finish
                              </p>
                              <p className="mt-1 break-words text-[13px] font-semibold leading-tight text-[var(--brand-ink)] sm:text-[14px]">
                                {finishText(remnant)}
                              </p>
                            </div>
                          ) : null}
                        </div>
                        {remnantColors(remnant).length ? (
                          <div className="mt-3 flex flex-wrap justify-center gap-2">
                            {remnantColors(remnant).map((color) => (
                              <span
                                key={`${displayRemnantId(remnant)}-${color}`}
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
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <footer className="px-3 pb-10 pt-2 md:px-6">
        <div className="mx-auto max-w-[1680px] rounded-[24px] border border-[var(--brand-line)] bg-white/80 px-4 py-5 text-center shadow-sm backdrop-blur sm:rounded-[28px] sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">Remnant Inventory System</p>
          <p className="mt-2 text-sm text-[rgba(25,27,28,0.72)]">Live remnant availability with simple hold requests.</p>
          <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[rgba(25,27,28,0.48)]">Created by EndoM14</p>
        </div>
      </footer>

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
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none text-current/70 transition-colors hover:bg-black/5 hover:text-current"
              aria-label="Dismiss notification"
            >
              {"\u00D7"}
            </button>
          </div>
        </div>
      ) : null}

      {mobileFilterPinned && !isModalOpen ? (
        <div className="fixed inset-x-3 bottom-4 z-[75] sm:hidden">
          <button
            type="button"
            onClick={openFilterMenu}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--brand-line)] bg-white/96 px-4 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--brand-ink)] shadow-[0_18px_40px_rgba(25,27,28,0.16)] backdrop-blur"
          >
            Filters
            {activeFilterCount ? <span className="rounded-full bg-[rgba(247,134,57,0.14)] px-2 py-0.5 text-[11px] text-[var(--brand-orange-deep)]">{activeFilterCount}</span> : null}
          </button>
        </div>
      ) : null}
    </main>
  );
}
