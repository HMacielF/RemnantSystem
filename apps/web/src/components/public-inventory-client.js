/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useBodyScrollLock from "@/components/use-body-scroll-lock";
import PublicHeader from "@/components/public/PublicHeader";
import PublicHero from "@/components/public/PublicHero";
import PublicFooter from "@/components/public/PublicFooter";
import StatusPill from "@/components/public/StatusPill";
import ColorTooltip from "@/components/public/ColorTooltip";

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
    colors: searchParams.getAll("color"),
    stone: searchParams.get("stone") || "",
    minWidth: searchParams.get("min-width") || "",
    minHeight: searchParams.get("min-height") || "",
    status: searchParams.get("status") || "",
  };
}

function emptyFilters() {
  return {
    materials: [],
    colors: [],
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
  filters.colors.forEach((color) => {
    if (color) params.append("color", color);
  });
  if (filters.stone.trim()) params.set("stone", filters.stone.trim());
  if (filters.minWidth.trim()) params.set("min-width", filters.minWidth.trim());
  if (filters.minHeight.trim()) params.set("min-height", filters.minHeight.trim());
  if (filters.status.trim()) params.set("status", filters.status.trim());
  return params;
}

function arraysShallowEqual(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function filtersEqual(a, b) {
  if (a === b) return true;
  if (
    a.stone !== b.stone ||
    a.minWidth !== b.minWidth ||
    a.minHeight !== b.minHeight ||
    a.status !== b.status
  ) {
    return false;
  }
  return arraysShallowEqual(a.materials, b.materials) && arraysShallowEqual(a.colors, b.colors);
}

function serverFilterSignature(filters) {
  return JSON.stringify([
    filters.materials,
    filters.stone,
    filters.minWidth,
    filters.minHeight,
    filters.status,
  ]);
}

function PublicInventorySkeletonCard() {
  return (
    <div
      className="overflow-hidden bg-white"
      style={{ border: "1px solid var(--qc-line)", borderRadius: "var(--qc-radius-sharp)" }}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[#f3f1ee]">
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

export default function PublicInventoryClient({ initialProfile = null } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const [filters, setFilters] = useState(() => currentFiltersFromSearch(searchParams));
  const debouncedFilters = useDebouncedValue(filters, 250);
  const [remnants, setRemnants] = useState([]);
  const [allRemnants, setAllRemnants] = useState([]);
  const [salesReps, setSalesReps] = useState([]);
  const [materialOptions, setMaterialOptions] = useState([]);
  const [lookupsLoaded, setLookupsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedImageIndex, setSelectedImageIndex] = useState(null);
  const [holdRemnant, setHoldRemnant] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
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
  const lastServerSigRef = useRef(null);
  const materialRailRef = useRef(null);
  const materialRailScrollRef = useRef(0);
  const imageSwipeStartRef = useRef(null);

  useEffect(() => {
    const next = currentFiltersFromSearch(new URLSearchParams(searchKey));
    setFilters((prev) => (filtersEqual(prev, next) ? prev : next));
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
        const [lookupPayload, allRows] = await Promise.all([
          apiFetch("/api/public/lookups"),
          apiFetch("/api/public/remnants?enrich=0"),
        ]);
        if (!mounted) return;
        setMaterialOptions(
          uniqueMaterialOptions(
            Array.isArray(lookupPayload?.materials)
              ? lookupPayload.materials.map((row) => row.name).filter(Boolean)
              : [],
          ),
        );
        setAllRemnants(Array.isArray(allRows) ? allRows : []);
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

    const sig = serverFilterSignature(debouncedFilters);
    const hadRows = remnants.length > 0;
    if (lastServerSigRef.current === sig && hadRows) return;
    lastServerSigRef.current = sig;

    if (abortRef.current) abortRef.current.abort();
    if (enrichmentRef.current) enrichmentRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    async function loadRows() {
      try {
        if (!hadRows) setLoading(true);
        setError("");
        const params = buildSearchQuery(debouncedFilters);
        params.set("enrich", "0");
        const rows = await apiFetch(`/api/public/remnants?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!Array.isArray(rows)) {
          throw new Error("Unexpected remnant payload");
        }

        const ids = [...new Set(rows.map((row) => Number(internalRemnantId(row))).filter(Boolean))];
        let merged = rows;

        if (ids.length) {
          const enrichmentController = new AbortController();
          enrichmentRef.current = enrichmentController;
          const enrichmentRows = await apiFetch("/api/public/remnants/enrichment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
            signal: enrichmentController.signal,
          });

          if (Array.isArray(enrichmentRows)) {
            const enrichmentMap = new Map(
              enrichmentRows.map((row) => [Number(row.remnant_id), row]),
            );
            merged = rows.map((row) => {
              const enrichment = enrichmentMap.get(Number(internalRemnantId(row)));
              return enrichment ? { ...row, ...enrichment } : row;
            });
          }
        }

        setRemnants(merged);
        setLoading(false);
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
    // remnants is intentionally read from closure: adding it to deps would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function toggleColorFilter(color) {
    setFilters((current) => {
      const isSelected = current.colors.includes(color);
      return {
        ...current,
        colors: isSelected
          ? current.colors.filter((value) => value !== color)
          : [...current.colors, color],
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
    const allowedMaterials = filters.materials.length
      ? new Set(filters.materials.map((material) => normalizeMaterialName(material)))
      : null;
    const allowedColors = filters.colors.length
      ? new Set(filters.colors.map((color) => normalizeStoneLookupName(color)))
      : null;

    if (!allowedMaterials && !allowedColors) return remnants;

    return remnants.filter((remnant) => {
      if (allowedMaterials) {
        const material = normalizeMaterialName(remnant.material_name || remnant.material?.name || remnant.material);
        if (!allowedMaterials.has(material)) return false;
      }
      if (allowedColors) {
        const remnantColorSet = new Set(
          remnantColors(remnant).map((color) => normalizeStoneLookupName(color)),
        );
        const matched = [...allowedColors].some((color) => remnantColorSet.has(color));
        if (!matched) return false;
      }
      return true;
    });
  }, [filters.materials, filters.colors, remnants]);

  const availableColors = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const remnant of remnants) {
      for (const color of remnantColors(remnant)) {
        const key = normalizeStoneLookupName(color);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(color);
      }
    }
    return result.sort((a, b) => a.localeCompare(b));
  }, [remnants]);

  const modalImageItems = useMemo(
    () => cards.filter((remnant) => Boolean(imageSrc(remnant))),
    [cards],
  );

  const selectedImageRemnant =
    selectedImageIndex !== null && selectedImageIndex >= 0 && selectedImageIndex < modalImageItems.length
      ? modalImageItems[selectedImageIndex]
      : null;
  const isModalOpen = Boolean(selectedImageRemnant || holdRemnant);

  useBodyScrollLock(isModalOpen);

  useEffect(() => {
    const rail = materialRailRef.current;
    if (!rail) return;
    rail.scrollLeft = materialRailScrollRef.current;
  }, [materialOptions, filters.materials]);

  useEffect(() => {
    function syncBackToTop() {
      setShowBackToTop(window.scrollY > 600);
    }

    syncBackToTop();
    window.addEventListener("scroll", syncBackToTop, { passive: true });
    window.addEventListener("resize", syncBackToTop);
    return () => {
      window.removeEventListener("scroll", syncBackToTop);
      window.removeEventListener("resize", syncBackToTop);
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
    if (selectedImageIndex === null && !holdRemnant) return undefined;

    function handleKeydown(event) {
      if (event.key === "Escape") {
        if (holdRemnant) {
          setHoldRemnant(null);
        } else {
          closeImageViewer();
        }
        return;
      }
      if (selectedImageIndex === null) return;
      if (event.key === "ArrowLeft") {
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
  }, [modalImageItems.length, selectedImageIndex, holdRemnant]);

  return (
    <main className="font-inter min-h-screen bg-[color:var(--qc-bg-page)] text-[color:var(--qc-ink-1)]">
      <PublicHeader initialProfile={initialProfile} />
      <PublicHero remnants={allRemnants} />

      <div className="relative">
        <div className="relative mx-auto w-full max-w-[1680px] px-8 pb-16">

          <section
            id="filter_menu"
            className="sticky top-0 z-40 mb-8 bg-[color:var(--qc-bg-page)] py-6"
            style={{
              borderTop: "1px solid var(--qc-line)",
              borderBottom: "1px solid var(--qc-line)",
            }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative h-11 min-w-[260px] flex-1">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--qc-ink-3)]"
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
                  className="font-inter h-11 w-full border border-[color:var(--qc-line)] bg-white pl-11 pr-4 text-[14px] font-normal normal-case tracking-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors hover:border-[color:var(--qc-line-strong)] focus:border-[color:var(--qc-ink-1)]"
                  style={{ borderRadius: "var(--qc-radius-sharp)" }}
                />
              </div>

              <input
                type="text"
                inputMode="decimal"
                value={filters.minWidth}
                onChange={(event) => setFilters((current) => ({ ...current, minWidth: event.target.value }))}
                placeholder='Min W"'
                aria-label="Minimum width"
                className="font-inter h-11 w-[110px] border border-[color:var(--qc-line)] bg-white px-4 text-center text-[14px] font-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors hover:border-[color:var(--qc-line-strong)] focus:border-[color:var(--qc-ink-1)]"
                style={{ borderRadius: "var(--qc-radius-sharp)" }}
              />

              <input
                type="text"
                inputMode="decimal"
                value={filters.minHeight}
                onChange={(event) => setFilters((current) => ({ ...current, minHeight: event.target.value }))}
                placeholder='Min H"'
                aria-label="Minimum height"
                className="font-inter h-11 w-[110px] border border-[color:var(--qc-line)] bg-white px-4 text-center text-[14px] font-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors hover:border-[color:var(--qc-line-strong)] focus:border-[color:var(--qc-ink-1)]"
                style={{ borderRadius: "var(--qc-radius-sharp)" }}
              />

              <div
                className="flex h-11 items-center bg-white"
                style={{
                  border: "1px solid var(--qc-line)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                {[
                  { value: "available", label: "Available", dot: "var(--qc-status-available-dot)" },
                  { value: "hold", label: "On Hold", dot: "var(--qc-status-hold-dot)" },
                  { value: "sold", label: "Sold", dot: "var(--qc-status-sold-dot)" },
                ].map((option, index) => {
                  const checked = filters.status === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={checked}
                      onClick={() =>
                        setFilters((current) => ({
                          ...current,
                          status: current.status === option.value ? "" : option.value,
                        }))
                      }
                      className={`font-inter inline-flex h-full items-center gap-1.5 px-4 text-[13px] transition-colors ${
                        checked
                          ? "bg-[rgba(0,0,0,0.04)] font-medium text-[color:var(--qc-ink-1)]"
                          : "text-[color:var(--qc-ink-2)] hover:bg-[rgba(0,0,0,0.04)] hover:text-[color:var(--qc-ink-1)]"
                      }`}
                      style={{
                        borderLeft: index === 0 ? "none" : "1px solid var(--qc-line)",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: option.dot }}
                      />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {(materialOptions.length || availableColors.length) ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={filters.materials.length === 0}
                  onClick={() =>
                    setFilters((current) => ({ ...current, materials: [] }))
                  }
                  className={`font-inter inline-flex items-center px-4 py-2 text-[13px] font-medium transition-colors ${
                    filters.materials.length === 0
                      ? "bg-[color:var(--qc-ink-1)] text-white hover:bg-[#232323]"
                      : "bg-[rgba(0,0,0,0.04)] text-[color:var(--qc-ink-1)] hover:bg-[rgba(0,0,0,0.08)]"
                  }`}
                  style={{ borderRadius: "var(--qc-radius-sharp)" }}
                >
                  All
                </button>
                {materialOptions.map((material) => {
                  const checked = filters.materials.includes(material);
                  return (
                    <button
                      key={material}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggleMaterialFilter(material)}
                      className={`font-inter inline-flex shrink-0 items-center px-4 py-2 text-[13px] font-medium transition-colors ${
                        checked
                          ? "bg-[color:var(--qc-ink-1)] text-white hover:bg-[#232323]"
                          : "bg-[rgba(0,0,0,0.04)] text-[color:var(--qc-ink-1)] hover:bg-[rgba(0,0,0,0.08)]"
                      }`}
                      style={{ borderRadius: "var(--qc-radius-sharp)" }}
                    >
                      {material}
                    </button>
                  );
                })}
                {availableColors.length ? (
                  <div className="ml-2 flex items-center gap-1.5">
                    {availableColors.map((color) => {
                      const checked = filters.colors.includes(color);
                      return (
                        <ColorTooltip key={color} name={color}>
                          <button
                            type="button"
                            aria-pressed={checked}
                            aria-label={color}
                            onClick={() => toggleColorFilter(color)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110"
                            style={{
                              ...colorSwatchStyle(color),
                              boxShadow: checked
                                ? "0 0 0 1px var(--qc-bg-page), 0 0 0 2px var(--qc-ink-1)"
                                : "inset 0 0 0 1px rgba(0,0,0,0.10)",
                            }}
                          />
                        </ColorTooltip>
                      );
                    })}
                  </div>
                ) : null}
                <span className="font-inter ml-auto text-[13px] text-[color:var(--qc-ink-3)]">
                  <span className="font-medium text-[color:var(--qc-ink-1)]">{cards.length}</span>{" "}
                  {cards.length === 1 ? "result" : "results"}
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
                    className="group relative flex flex-col overflow-hidden bg-[color:var(--qc-bg-surface)] transition-all duration-200 hover:-translate-y-1"
                    style={{
                      border: "1px solid var(--qc-line)",
                      borderRadius: "var(--qc-radius-sharp)",
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.borderColor = "var(--qc-ink-1)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.borderColor = "var(--qc-line)";
                    }}
                  >
                    <div className="relative aspect-[4/3] overflow-hidden bg-[#f3f1ee]">
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
                            className="h-full w-full object-cover object-top"
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
                        <StatusPill
                          status={status}
                          label={`#${displayRemnantId(remnant)}`}
                          location={remnant.location}
                        />
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
                          className="font-inter absolute bottom-3 right-3 z-[3] inline-flex items-center gap-1.5 bg-[color:var(--qc-ink-1)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[color:var(--qc-orange)]"
                          style={{
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
                                <ColorTooltip
                                  key={`${displayRemnantId(remnant)}-${color}`}
                                  name={color}
                                >
                                  <span
                                    aria-hidden="true"
                                    className="block h-3.5 w-3.5 rounded-full transition-transform group-hover/swatch:scale-110"
                                    style={{
                                      ...colorSwatchStyle(color),
                                      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.10)",
                                    }}
                                  />
                                </ColorTooltip>
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

      <PublicFooter slabCount={allRemnants.length} />

      {selectedImageRemnant ? (
        <div
          className="font-inter fixed inset-0 z-[74] bg-black/60 px-4 py-6 sm:px-6 sm:py-10"
          onClick={closeImageViewer}
        >
          <div
            className="mx-auto flex h-full max-w-[1180px] flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="flex h-full w-full flex-col overflow-hidden bg-[color:var(--qc-bg-surface)]"
              style={{
                border: "1px solid var(--qc-line)",
                borderRadius: "var(--qc-radius-sharp)",
                boxShadow: "0 32px 90px rgba(0, 0, 0, 0.38)",
              }}
            >
              <div
                className="flex items-center justify-between gap-4 px-5 py-4"
                style={{ borderBottom: "1px solid var(--qc-line)" }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      status={statusText(selectedImageRemnant)}
                      label={`#${displayRemnantId(selectedImageRemnant)}`}
                      location={selectedImageRemnant.location}
                    />
                    <span
                      className="px-2 py-1 text-[11px] text-[color:var(--qc-ink-3)]"
                      style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
                    >
                      {selectedImageIndex + 1} / {modalImageItems.length}
                    </span>
                  </div>
                  <h2 className="mt-3 text-[22px] font-medium leading-tight tracking-[-0.015em] text-[color:var(--qc-ink-1)] sm:text-[26px]">
                    {publicCardHeading(selectedImageRemnant)}
                  </h2>
                  {publicCardSubheading(selectedImageRemnant) ? (
                    <p className="mt-1 text-[10.5px] uppercase tracking-[0.18em] text-[color:var(--qc-orange)]">
                      {publicCardSubheading(selectedImageRemnant)}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-[color:var(--qc-ink-2)]">
                    {remnantMetricEntries(selectedImageRemnant).map((entry) => (
                      <span
                        key={`${displayRemnantId(selectedImageRemnant)}-${entry.label}`}
                        title={entry.title}
                        className="inline-flex items-center gap-1.5"
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
                          {entry.label}
                        </span>
                        <span className="whitespace-nowrap text-[color:var(--qc-ink-1)]">{entry.value}</span>
                      </span>
                    ))}
                    {remnantColors(selectedImageRemnant).length ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
                          Color
                        </span>
                        <span className="flex items-center gap-1.5">
                          {remnantColors(selectedImageRemnant).slice(0, 4).map((color) => (
                            <ColorTooltip
                              key={`${displayRemnantId(selectedImageRemnant)}-viewer-${color}`}
                              name={color}
                            >
                              <span
                                aria-hidden="true"
                                className="block h-3.5 w-3.5 rounded-full transition-transform group-hover/swatch:scale-110"
                                style={{
                                  ...colorSwatchStyle(color),
                                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.10)",
                                }}
                              />
                            </ColorTooltip>
                          ))}
                        </span>
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {String(selectedImageRemnant?.status || "").toLowerCase() === "available" ? (
                    <button
                      type="button"
                      onClick={() => {
                        const target = selectedImageRemnant;
                        closeImageViewer();
                        openHoldRequest(target).catch((requestError) =>
                          setNotice({ type: "error", message: requestError.message })
                        );
                      }}
                      className="font-inter inline-flex h-9 items-center gap-1.5 bg-[color:var(--qc-ink-1)] px-4 text-[12px] font-medium text-white transition-colors hover:bg-[color:var(--qc-orange)]"
                      style={{ borderRadius: "var(--qc-radius-sharp)" }}
                      aria-label="Request a hold"
                    >
                      Request hold
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14" />
                        <path d="m13 5 7 7-7 7" />
                      </svg>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={closeImageViewer}
                    className="inline-flex h-9 w-9 items-center justify-center text-[20px] leading-none text-[color:var(--qc-ink-2)] transition-colors hover:border-[color:var(--qc-orange)] hover:text-[color:var(--qc-orange)]"
                    style={{
                      border: "1px solid var(--qc-line)",
                      borderRadius: "var(--qc-radius-sharp)",
                    }}
                    aria-label="Close image preview"
                  >
                    {"\u00D7"}
                  </button>
                </div>
              </div>
              <div
                className="relative flex min-h-0 flex-1 items-center justify-center bg-[#f3f1ee] p-4 sm:p-6"
                onTouchStart={handleImageViewerTouchStart}
                onTouchEnd={handleImageViewerTouchEnd}
              >
                {modalImageItems.length > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={showPreviousImage}
                      className="absolute left-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center bg-white text-[20px] leading-none text-[color:var(--qc-ink-1)] transition-colors hover:border-[color:var(--qc-orange)] hover:text-[color:var(--qc-orange)]"
                      style={{
                        border: "1px solid var(--qc-line)",
                        borderRadius: "var(--qc-radius-sharp)",
                      }}
                      aria-label="Previous image"
                    >
                      {"\u2039"}
                    </button>
                    <button
                      type="button"
                      onClick={showNextImage}
                      className="absolute right-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center bg-white text-[20px] leading-none text-[color:var(--qc-ink-1)] transition-colors hover:border-[color:var(--qc-orange)] hover:text-[color:var(--qc-orange)]"
                      style={{
                        border: "1px solid var(--qc-line)",
                        borderRadius: "var(--qc-radius-sharp)",
                      }}
                      aria-label="Next image"
                    >
                      {"\u203A"}
                    </button>
                  </>
                ) : null}
                <img
                  src={imageSrc(selectedImageRemnant)}
                  alt={`Remnant ${displayRemnantId(selectedImageRemnant)}`}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {holdRemnant ? (
        <div className="font-inter fixed inset-0 z-[72] overflow-y-auto bg-black/40 px-4 py-8">
          <div
            className="mx-auto max-w-2xl overflow-hidden bg-[color:var(--qc-bg-surface)]"
            style={{
              border: "1px solid var(--qc-line)",
              borderRadius: "var(--qc-radius-sharp)",
            }}
          >
            <div
              className="flex items-start justify-between gap-4 px-6 py-5"
              style={{ borderBottom: "1px solid var(--qc-line)" }}
            >
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
                  Hold request
                </p>
                <h2 className="mt-2 text-[22px] font-medium leading-tight tracking-[-0.015em] text-[color:var(--qc-ink-1)]">
                  Request this{" "}
                  <span className="font-italic-accent text-[color:var(--qc-ink-2)]">remnant.</span>
                </h2>
                <p className="mt-2 max-w-[440px] text-[13px] leading-[1.6] text-[color:var(--qc-ink-2)]">
                  Send your request and we&apos;ll confirm availability with your sales rep before anything is placed on hold.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHoldRemnant(null)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-[20px] leading-none text-[color:var(--qc-ink-2)] transition-colors hover:text-[color:var(--qc-ink-1)]"
                style={{
                  border: "1px solid var(--qc-line)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
                aria-label="Close hold request form"
              >
                {"\u00D7"}
              </button>
            </div>
            <form onSubmit={submitHoldRequest} className="grid gap-6 p-6">
              <section
                className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_180px]"
                style={{
                  border: "1px solid var(--qc-line)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.20em] text-[color:var(--qc-orange)]">
                    {publicCardSubheading(holdRemnant) || "Remnant"}
                  </p>
                  <h3 className="mt-2 text-[18px] font-medium leading-tight tracking-[-0.01em] text-[color:var(--qc-ink-1)]">
                    {publicCardHeading(holdRemnant)}
                  </h3>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StatusPill
                      status={statusText(holdRemnant)}
                      label={`#${displayRemnantId(holdRemnant)}`}
                    />
                  </div>
                  <dl className="mt-4 grid gap-3 text-[12px] text-[color:var(--qc-ink-2)] sm:grid-cols-2">
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
                        Material
                      </dt>
                      <dd className="mt-1 text-[13px] text-[color:var(--qc-ink-1)]">
                        {holdRemnant.material_name || holdRemnant.material || "Not listed"}
                      </dd>
                    </div>
                    {remnantMetricEntries(holdRemnant).map((entry) => (
                      <div key={`${displayRemnantId(holdRemnant)}-hold-${entry.label}`}>
                        <dt
                          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]"
                          title={entry.title}
                        >
                          {entry.label}
                        </dt>
                        <dd className="mt-1 text-[13px] text-[color:var(--qc-ink-1)]">{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="self-start">
                  {imageSrc(holdRemnant) ? (
                    <button
                      type="button"
                      onClick={() => openImageViewer(holdRemnant)}
                      className="block w-full overflow-hidden bg-[#f3f1ee]"
                      style={{
                        border: "1px solid var(--qc-line)",
                        borderRadius: "var(--qc-radius-sharp)",
                      }}
                    >
                      <img
                        src={imageSrc(holdRemnant)}
                        alt={`Remnant ${displayRemnantId(holdRemnant)}`}
                        className="h-32 w-full object-cover"
                      />
                    </button>
                  ) : (
                    <div
                      className="flex h-32 items-center justify-center text-[12px] text-[color:var(--qc-ink-3)]"
                      style={{
                        border: "1px solid var(--qc-line)",
                        borderRadius: "var(--qc-radius-sharp)",
                      }}
                    >
                      No image
                    </div>
                  )}
                  {remnantColors(holdRemnant).length ? (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {remnantColors(holdRemnant).slice(0, 4).map((color) => (
                        <span
                          key={`${displayRemnantId(holdRemnant)}-hold-color-${color}`}
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
                  ) : null}
                </div>
              </section>

              {holdFormMessage ? (
                <div
                  className="px-4 py-3 text-[13px] text-[color:var(--qc-status-sold-fg)]"
                  style={{
                    border: "1px solid var(--qc-line)",
                    borderLeft: "2px solid var(--qc-status-sold-dot)",
                    borderRadius: "var(--qc-radius-sharp)",
                  }}
                >
                  {holdFormMessage}
                </div>
              ) : null}

              <section className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="block text-[10px] font-medium uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                    Name
                  </span>
                  <input
                    required
                    value={holdForm.requester_name}
                    onChange={(event) =>
                      setHoldForm((current) => ({ ...current, requester_name: event.target.value }))
                    }
                    placeholder="Your full name"
                    className="mt-2 h-[42px] w-full bg-white px-3.5 text-[14px] font-normal normal-case tracking-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors focus:border-[color:var(--qc-ink-1)]"
                    style={{
                      border: "1px solid var(--qc-line)",
                      borderRadius: "var(--qc-radius-sharp)",
                    }}
                  />
                </label>
                <label className="block">
                  <span className="block text-[10px] font-medium uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                    Email
                  </span>
                  <input
                    required
                    type="email"
                    value={holdForm.requester_email}
                    onChange={(event) =>
                      setHoldForm((current) => ({ ...current, requester_email: event.target.value }))
                    }
                    placeholder="you@example.com"
                    className="mt-2 h-[42px] w-full bg-white px-3.5 text-[14px] font-normal normal-case tracking-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors focus:border-[color:var(--qc-ink-1)]"
                    style={{
                      border: "1px solid var(--qc-line)",
                      borderRadius: "var(--qc-radius-sharp)",
                    }}
                  />
                </label>
              </section>

              <section className="grid gap-4">
                <label className="block">
                  <span className="block text-[10px] font-medium uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                    Sales rep
                  </span>
                  <SelectField
                    value={holdForm.sales_rep_user_id}
                    onChange={(event) =>
                      setHoldForm((current) => ({ ...current, sales_rep_user_id: event.target.value }))
                    }
                    disabled={salesReps.length === 0}
                    wrapperClassName="relative mt-2"
                    className="disabled:bg-[#f3f1ee] disabled:text-[color:var(--qc-ink-3)]"
                  >
                    <option value="">
                      {salesReps.length === 0
                        ? "No active sales reps available"
                        : "Select sales rep"}
                    </option>
                    {salesReps.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.display_name || row.full_name || row.email || "User"}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="block">
                  <span className="block text-[10px] font-medium uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                    Notes
                  </span>
                  <textarea
                    rows="4"
                    value={holdForm.notes}
                    onChange={(event) =>
                      setHoldForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder="Anything the sales rep should know about timing, pickup, or questions"
                    className="mt-2 w-full bg-white px-3.5 py-3 text-[14px] font-normal normal-case tracking-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors focus:border-[color:var(--qc-ink-1)]"
                    style={{
                      border: "1px solid var(--qc-line)",
                      borderRadius: "var(--qc-radius-sharp)",
                    }}
                  />
                </label>
              </section>

              <div
                className="flex flex-col items-stretch justify-between gap-4 pt-5 sm:flex-row sm:items-center"
                style={{ borderTop: "1px solid var(--qc-line)" }}
              >
                <p className="font-italic-accent text-[14px] leading-[1.5] text-[color:var(--qc-ink-2)] sm:max-w-[320px]">
                  {salesReps.length === 0
                    ? "No active sales reps yet. Add one in the admin workspace first."
                    : "One remnant. First come, first served."}
                </p>
                <input
                  type="hidden"
                  name="remnant_id"
                  value={internalRemnantId(holdRemnant) || ""}
                />
                <button
                  type="submit"
                  disabled={holdSubmitting || salesReps.length === 0}
                  className="inline-flex h-11 items-center justify-center gap-2 bg-[color:var(--qc-ink-1)] px-6 text-[13px] font-medium text-white transition-colors hover:bg-[color:var(--qc-orange)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[color:var(--qc-ink-1)]"
                  style={{
                    borderRadius: "var(--qc-radius-sharp)",
                  }}
                >
                  {holdSubmitting ? "Sending\u2026" : "Send hold request"}
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

      {showBackToTop && !isModalOpen ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Scroll to top"
          title="Scroll to top"
          className="fixed bottom-6 right-6 z-[60] inline-flex h-11 w-11 items-center justify-center text-white transition-colors hover:bg-[#232323]"
          style={{
            backgroundColor: "var(--qc-ink-1)",
            borderRadius: "var(--qc-radius-sharp)",
            boxShadow: "var(--qc-shadow-toast)",
          }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      ) : null}
    </main>
  );
}
