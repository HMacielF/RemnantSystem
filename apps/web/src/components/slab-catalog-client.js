"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import useBodyScrollLock from "@/components/use-body-scroll-lock";

const FILTER_LABEL_CLASS =
  "block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]";
const FILTER_INPUT_CLASS =
  "mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-medium normal-case tracking-normal text-[var(--brand-ink)] placeholder:text-[color:color-mix(in_srgb,var(--brand-ink)_44%,white)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]";
const FILTER_SELECT_CLASS =
  "mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-3 text-sm font-medium text-[var(--brand-ink)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] focus-visible:ring-4 focus-visible:ring-[rgba(247,134,57,0.14)]";

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

const THICKNESS_ORDER = new Map([
  ["6 MM", 1],
  ["10 MM", 2],
  ["12 MM", 3],
  ["15 MM", 4],
  ["2 CM", 5],
  ["3 CM", 6],
]);

function normalizeThicknessLabel(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function compareThicknessLabels(left, right) {
  const normalizedLeft = normalizeThicknessLabel(left);
  const normalizedRight = normalizeThicknessLabel(right);
  const leftRank = THICKNESS_ORDER.get(normalizedLeft);
  const rightRank = THICKNESS_ORDER.get(normalizedRight);

  if (leftRank !== undefined || rightRank !== undefined) {
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    if (leftRank !== rightRank) return leftRank - rightRank;
  }

  return normalizedLeft.localeCompare(normalizedRight);
}

function uniqueSortedThicknesses(values) {
  return [...new Set((values || []).filter(Boolean))].sort(compareThicknessLabels);
}

function slabColors(row) {
  return uniqueSorted([
    ...(Array.isArray(row?.primary_colors) ? row.primary_colors : []),
    ...(Array.isArray(row?.accent_colors) ? row.accent_colors : []),
  ]);
}

function splitMetricValues(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatDimensionToken(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/[″"]/.test(normalized)) return normalized.replace(/"/g, "″");

  const cleaned = normalized.replace(/\s+/g, " ");
  if (/^\d+(?:\.\d+)?(?:\s+\d+\/\d+)?$/.test(cleaned)) {
    return `${cleaned}″`;
  }

  return cleaned;
}

function editableDimensionToken(value) {
  return String(value || "")
    .trim()
    .replace(/[″"]/g, "")
    .trim();
}

function sizeValues(row) {
  const widths = splitMetricValues(row?.width).map(formatDimensionToken);
  const heights = splitMetricValues(row?.height).map(formatDimensionToken);

  if (!widths.length && !heights.length) return [];
  if (!widths.length) return heights;
  if (!heights.length) return widths;
  if (widths.length === 1 && heights.length === 1) {
    return [`${widths[0]} x ${heights[0]}`];
  }
  if (widths.length === 1 && heights.length > 1) {
    return heights.map((height) => `${widths[0]} x ${height}`);
  }
  if (heights.length === 1 && widths.length > 1) {
    return widths.map((width) => `${width} x ${heights[0]}`);
  }
  if (widths.length === heights.length) {
    return widths.map((width, index) => `${width} x ${heights[index]}`);
  }

  return [`${widths.join(", ")} x ${heights.join(", ")}`];
}

function thicknessValues(row) {
  return uniqueSortedThicknesses(
    Array.isArray(row?.thicknesses)
      ? row.thicknesses
      : splitMetricValues(row?.thickness),
  );
}

function isPorcelainMaterial(value) {
  return String(value || "").trim().toLowerCase() === "porcelain";
}

const PROXIED_IMAGE_HOSTS = new Set([
  "www.gramaco.com",
  "gramaco.com",
]);

function displayImageUrl(url) {
  const normalized = String(url || "").trim();
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    if (PROXIED_IMAGE_HOSTS.has(parsed.hostname)) {
      return `/api/image-proxy?url=${encodeURIComponent(normalized)}`;
    }
  } catch {
    return normalized;
  }

  return normalized;
}

function finishValues(row) {
  return uniqueSorted(
    Array.isArray(row?.finishes)
      ? row.finishes
      : splitMetricValues(row?.finish),
  );
}

function renderMetricValues(values, singleLineClassName, multiLineClassName) {
  if (!values.length) return null;
  if (values.length === 1) {
    return <span className="whitespace-nowrap">{values[0]}</span>;
  }

  return (
    <span className={multiLineClassName}>
      {values.map((value) => (
        <span key={value} className="whitespace-nowrap">
          {value}
        </span>
      ))}
    </span>
  );
}

function cardMetricLayout(row) {
  const hasThickness = Boolean(thicknessValues(row).length);
  const hasFinish = Boolean(finishValues(row).length);
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

function normalizeColorName(value) {
  return String(value || "").trim().toLowerCase();
}

function colorSwatchStyle(colorName) {
  const normalized = normalizeColorName(colorName);
  const palette = {
    beige: { backgroundColor: "#d7b98c" },
    black: { backgroundColor: "#1f1d1b" },
    blonde: { backgroundColor: "#e7c98b" },
    blue: { backgroundColor: "#5b88d6" },
    brown: { backgroundColor: "#8b5a2b" },
    charcoal: { backgroundColor: "#3d3d3d" },
    copper: { backgroundColor: "#b87333" },
    cream: { backgroundColor: "#f4ead2" },
    gold: { backgroundColor: "#d4af37" },
    gray: { backgroundColor: "#8b9098" },
    "gray-dark": { backgroundColor: "#5a5f68" },
    "gray-light": { backgroundColor: "#cfd4dc" },
    grey: { backgroundColor: "#8b9098" },
    green: { backgroundColor: "#6f956f" },
    ivory: { backgroundColor: "#fffff0" },
    navy: { backgroundColor: "#284a7a" },
    orange: { backgroundColor: "#e07b39" },
    pink: { backgroundColor: "#e8a0a0" },
    purple: { backgroundColor: "#8b5cf6" },
    red: { backgroundColor: "#ff3b30" },
    silver: { backgroundColor: "#c0c0c0" },
    taupe: { backgroundColor: "#8f7762" },
    white: { backgroundColor: "#ffffff" },
  };
  return palette[normalized] || { backgroundColor: "#d6ccc2" };
}

function badgeClass(tone = "neutral") {
  const styles = {
    neutral: "border-[var(--brand-line)] bg-[var(--brand-shell)] text-[color:color-mix(in_srgb,var(--brand-ink)_68%,white)]",
    accent: "border-[rgba(247,134,57,0.22)] bg-[rgba(247,134,57,0.10)] text-[var(--brand-orange-deep)]",
    green: "border-[rgba(60,113,82,0.18)] bg-[#eef6f1] text-[#27543f]",
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
    <div className="overflow-hidden rounded-[28px] border border-[var(--brand-line)] bg-white/95 shadow-[0_18px_48px_rgba(25,27,28,0.08)]">
      <div className="relative aspect-[16/10] overflow-hidden bg-[var(--brand-shell)]">
        <div className="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,#f7f2ec,#efe6dc,#f7f2ec)]" />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(180deg,transparent,rgba(25,27,28,0.10))]" />
      </div>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2">
          <div className="h-7 w-20 animate-pulse rounded-full bg-[rgba(247,134,57,0.10)]" />
          <div className="h-7 w-24 animate-pulse rounded-full bg-[var(--brand-shell)]" />
          <div className="h-7 w-18 animate-pulse rounded-full bg-[#eef6f1]" />
        </div>
        <div>
          <div className="h-5 w-2/3 animate-pulse rounded-full bg-[#ece3d9]" />
          <div className="mt-2 h-4 w-1/3 animate-pulse rounded-full bg-[#f3ece4]" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 py-3">
              <div className="h-3 w-16 animate-pulse rounded-full bg-[#eadccf]" />
              <div className="mt-2 h-4 w-12 animate-pulse rounded-full bg-[#e5d9cd]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SlabCatalogClient() {
  const [rows, setRows] = useState([]);
  const [catalogOptions, setCatalogOptions] = useState({
    brands: [],
    suppliers: [],
    materials: [],
    finishFilters: [],
    thicknesses: [],
    colors: [],
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState(null);
  const [groupViewer, setGroupViewer] = useState(null);
  const [editor, setEditor] = useState(null);
  const [editorLookups, setEditorLookups] = useState({
    colors: [],
    finishes: [],
    suppliers: [],
    materials: [],
  });
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [supplier, setSupplier] = useState("");
  const [material, setMaterial] = useState("");
  const [finish, setFinish] = useState("");
  const [thickness, setThickness] = useState("");
  const [priceSort, setPriceSort] = useState("default");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const deferredSearch = useDeferredValue(search);

  const hasActiveFilters = Boolean(search || brand || supplier || material || finish || thickness || priceSort !== "default");

  function clearFilters() {
    setSearch("");
    setBrand("");
    setSupplier("");
    setMaterial("");
    setFinish("");
    setThickness("");
    setPriceSort("default");
    setPage(1);
  }

  useBodyScrollLock(Boolean(lightbox || groupViewer || editor));

  useEffect(() => {
    let active = true;

    async function loadSlabs() {
      try {
        if (page > 1) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }
        setError("");
        const params = new URLSearchParams({
          search: deferredSearch.trim(),
          brand,
          supplier,
          material,
          finish,
          thickness,
          priceSort,
          page: String(page),
          pageSize: "24",
        });
        const response = await fetch(`/api/slabs?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Slab request failed with ${response.status}`);
        }

        const data = await response.json();
        if (!active) return;
        setRows((current) => {
          const nextRows = Array.isArray(data?.rows) ? data.rows : [];
          if (page <= 1) return nextRows;
          const seen = new Set(current.map((row) => String(row.id)));
          return [...current, ...nextRows.filter((row) => !seen.has(String(row.id)))];
        });
        setCatalogOptions({
          brands: uniqueSorted(data?.options?.brands || []),
          suppliers: uniqueSorted(data?.options?.suppliers || []),
          materials: uniqueSorted(data?.options?.materials || []),
          finishFilters: Array.isArray(data?.options?.finish_filters)
            ? data.options.finish_filters.filter((option) => option?.value)
            : [],
          thicknesses: uniqueSortedThicknesses(data?.options?.thicknesses || []),
          colors: uniqueSorted(data?.options?.colors || []),
        });
        setTotalCount(Number(data?.total || 0));
        setHasMore(Boolean(data?.hasMore));
      } catch (loadError) {
        console.error(loadError);
        if (!active) return;
        setError("Unable to load the slab catalog right now.");
      } finally {
        if (!active) return;
        setLoading(false);
        setLoadingMore(false);
      }
    }

    loadSlabs();

    return () => {
      active = false;
    };
  }, [brand, deferredSearch, finish, material, page, priceSort, reloadTick, supplier, thickness]);

  const modalImageItems = useMemo(
    () =>
      rows
        .flatMap((row) => (
          row?.is_group && Array.isArray(row?.group_rows)
            ? row.group_rows
            : [row]
        ))
        .filter((row) => row.image_url)
        .map((row) => ({
          id: row.id,
          src: displayImageUrl(row.image_url),
          alt: row.name || "Slab preview",
          name: row.name || "Slab preview",
          supplier: row.supplier || "",
          material: row.material || "",
          width: formatDimensionToken(row.width || ""),
          height: formatDimensionToken(row.height || ""),
          thicknesses: row.thicknesses || [],
          finishes: row.finishes || [],
        })),
    [rows],
  );

  const selectedLightboxIndex = useMemo(() => {
    if (!lightbox) return -1;
    return modalImageItems.findIndex((item) => item.id === lightbox.id);
  }, [lightbox, modalImageItems]);

  const priceSortLabel =
    priceSort === "low"
      ? "Price: Low to High"
      : priceSort === "high"
        ? "Price: High to Low"
        : "Sort by Price";

  function openGroupViewer(row) {
    if (!row?.is_group) return;
    setGroupViewer(row);
  }

  function closeGroupViewer() {
    setGroupViewer(null);
  }

  function cyclePriceSort() {
    setPage(1);
    setPriceSort((current) =>
      current === "default" ? "low" : current === "low" ? "high" : "default",
    );
  }

  function showPreviousImage() {
    if (selectedLightboxIndex < 0 || !modalImageItems.length) return;
    const nextIndex =
      (selectedLightboxIndex - 1 + modalImageItems.length) % modalImageItems.length;
    setLightbox(modalImageItems[nextIndex]);
  }

  function showNextImage() {
    if (selectedLightboxIndex < 0 || !modalImageItems.length) return;
    const nextIndex = (selectedLightboxIndex + 1) % modalImageItems.length;
    setLightbox(modalImageItems[nextIndex]);
  }

  async function openEditor(row) {
    try {
      setEditorLoading(true);
      setEditorError("");
      const [slabResponse, lookupResponse] = await Promise.all([
        fetch(`/api/slabs/${row.id}`, { cache: "no-store" }),
        fetch("/api/lookups", { cache: "no-store" }),
      ]);

      if (!slabResponse.ok) {
        const payload = await slabResponse.json().catch(() => ({}));
        throw new Error(payload?.error || `Slab request failed with ${slabResponse.status}`);
      }
      if (!lookupResponse.ok) {
        const payload = await lookupResponse.json().catch(() => ({}));
        throw new Error(payload?.error || `Lookup request failed with ${lookupResponse.status}`);
      }

      const [data, lookupPayload] = await Promise.all([
        slabResponse.json(),
        lookupResponse.json(),
      ]);
      setEditorLookups({
        colors: Array.isArray(lookupPayload?.colors)
          ? lookupPayload.colors.filter((row) => row?.active !== false && row?.name)
          : [],
        finishes: Array.isArray(lookupPayload?.finishes)
          ? lookupPayload.finishes.filter((row) => row?.active !== false && row?.name)
          : [],
        suppliers: Array.isArray(lookupPayload?.suppliers)
          ? lookupPayload.suppliers.filter((row) => row?.active !== false && row?.name)
          : [],
        materials: Array.isArray(lookupPayload?.materials)
          ? lookupPayload.materials.filter((row) => row?.active !== false && row?.name)
          : [],
      });
      setEditor({
        id: data.id,
        active: data.active !== false,
        name: data.name || "",
        brand_name: data.brand_name || "",
        supplier: data.supplier || "",
        supplier_id: data.supplier_id ? String(data.supplier_id) : "",
        material: data.material || "",
        material_id: data.material_id ? String(data.material_id) : "",
        width: editableDimensionToken(data.width || ""),
        height: editableDimensionToken(data.height || ""),
        detail_url: data.detail_url || "",
        image_url: data.image_url || "",
        colors: Array.isArray(data.colors) ? data.colors : [],
        finishes: Array.isArray(data.finishes) ? data.finishes : [],
        thicknesses: Array.isArray(data.thicknesses) ? data.thicknesses : [],
      });
    } catch (loadError) {
      console.error(loadError);
      setEditorError(loadError.message || "Unable to load slab editor.");
    } finally {
      setEditorLoading(false);
    }
  }

  function closeEditor() {
    setEditor(null);
    setEditorLookups({ colors: [], finishes: [], suppliers: [], materials: [] });
    setEditorError("");
    setEditorLoading(false);
    setEditorSaving(false);
    setArchiveConfirm(false);
  }

  function updateEditorField(key, value) {
    setEditor((current) => current ? ({ ...current, [key]: value }) : current);
  }

  function listIncludes(values, target) {
    const normalizedTarget = String(target || "").trim().toLowerCase();
    return (Array.isArray(values) ? values : []).some(
      (value) => String(value || "").trim().toLowerCase() === normalizedTarget,
    );
  }

  function toggleEditorListValue(key, value) {
    setEditor((current) => {
      if (!current) return current;
      const currentValues = Array.isArray(current[key]) ? current[key] : [];
      const nextValues = listIncludes(currentValues, value)
        ? currentValues.filter((entry) => String(entry || "").trim().toLowerCase() !== String(value || "").trim().toLowerCase())
        : [...currentValues, value];
      return { ...current, [key]: nextValues };
    });
  }

  async function saveEditor(overrides = {}) {
    if (!editor?.id) return;
    const nextEditor = { ...editor, ...overrides };

    try {
      setEditorSaving(true);
      setEditorError("");
      const response = await fetch(`/api/slabs/${nextEditor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nextEditor.name,
          brand_name: nextEditor.brand_name,
          supplier_id: nextEditor.supplier_id,
          material_id: nextEditor.material_id,
          active: nextEditor.active,
          width: nextEditor.width,
          height: nextEditor.height,
          detail_url: nextEditor.detail_url,
          image_url: nextEditor.image_url,
          colors: nextEditor.colors,
          finishes: nextEditor.finishes,
          thicknesses: nextEditor.thicknesses,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `Slab update failed with ${response.status}`);
      }

      setPage(1);
      setReloadTick((current) => current + 1);
      closeEditor();
    } catch (saveError) {
      console.error(saveError);
      setEditorError(saveError.message || "Unable to save slab changes.");
    } finally {
      setEditorSaving(false);
    }
  }

  async function archiveEditor() {
    if (!editor?.id) return;
    if (!archiveConfirm) { setArchiveConfirm(true); return; }
    setArchiveConfirm(false);
    await saveEditor({ active: false });
  }

  useEffect(() => {
    function handleViewerKeys(event) {
      if (event.key === "Escape") {
        if (lightbox) { setLightbox(null); return; }
        if (groupViewer) { setGroupViewer(null); return; }
        return;
      }
      if (!lightbox) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (selectedLightboxIndex < 0 || !modalImageItems.length) return;
        const nextIndex =
          (selectedLightboxIndex - 1 + modalImageItems.length) % modalImageItems.length;
        setLightbox(modalImageItems[nextIndex]);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (selectedLightboxIndex < 0 || !modalImageItems.length) return;
        const nextIndex = (selectedLightboxIndex + 1) % modalImageItems.length;
        setLightbox(modalImageItems[nextIndex]);
      }
    }

    window.addEventListener("keydown", handleViewerKeys);
    return () => window.removeEventListener("keydown", handleViewerKeys);
  }, [lightbox, modalImageItems, selectedLightboxIndex]);

  return (
    <>
      <main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,var(--brand-white)_52%,rgba(247,134,57,0.08)_100%)] text-[var(--brand-ink)]">
        <div className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[440px] bg-[radial-gradient(circle_at_top_left,rgba(247,134,57,0.18),transparent_36%),radial-gradient(circle_at_top_right,rgba(60,113,82,0.12),transparent_32%)]" />
          <div className="pointer-events-none absolute left-[-120px] top-[120px] h-[260px] w-[260px] rounded-full bg-[rgba(247,134,57,0.10)] blur-3xl" />
          <div className="pointer-events-none absolute right-[-60px] top-[40px] h-[220px] w-[220px] rounded-full bg-[rgba(60,113,82,0.10)] blur-3xl" />

          <div className="relative mx-auto max-w-[1680px] px-4 py-4 md:px-6 md:py-5">
            <section className="mb-4 overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-[linear-gradient(135deg,rgba(255,255,255,0.99),rgba(242,242,242,0.96))] px-6 py-5 shadow-[0_28px_90px_rgba(25,27,28,0.10)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-orange)]">
                    Internal Slab Catalog
                  </p>
                  <h1 className="font-display mt-3 text-[1.95rem] font-semibold leading-tight text-[var(--brand-ink)] md:text-[2.45rem]">
                    Review supplier slabs in one place.
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:color-mix(in_srgb,var(--brand-ink)_68%,white)] md:text-base">
                    Compare current slab options across suppliers without
                    jumping between vendor sites.
                  </p>
                </div>
                <Link
                  href="/manage"
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-5 text-sm font-semibold text-[var(--brand-ink)] shadow-sm transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)] hover:text-[var(--brand-orange)]"
                >
                  Back to Manage
                </Link>
              </div>
            </section>

            <section className="mb-4 rounded-[30px] border border-[var(--brand-line)] bg-white/92 p-5 shadow-[0_24px_70px_rgba(25,27,28,0.08)]">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(280px,1.3fr)_220px_220px_220px_220px_220px] xl:items-end">
                <label className={FILTER_LABEL_CLASS}>
                  Search
                  <input
                    type="text"
                    placeholder="Stone, color, size, dimension..."
                    className={FILTER_INPUT_CLASS}
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                  />
                </label>

                <label className={FILTER_LABEL_CLASS}>
                  Brand
                  <select
                    className={FILTER_SELECT_CLASS}
                    value={brand}
                    onChange={(event) => {
                      setBrand(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All brands</option>
                    {catalogOptions.brands.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={FILTER_LABEL_CLASS}>
                  Supplier
                  <select
                    className={FILTER_SELECT_CLASS}
                    value={supplier}
                    onChange={(event) => {
                      setSupplier(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All suppliers</option>
                    {catalogOptions.suppliers.map((value) => (
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
                    onChange={(event) => {
                      setMaterial(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All materials</option>
                    {catalogOptions.materials.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={FILTER_LABEL_CLASS}>
                  Basic Finish
                  <select
                    className={FILTER_SELECT_CLASS}
                    value={finish}
                    onChange={(event) => {
                      setFinish(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All basic finishes</option>
                    {catalogOptions.finishFilters.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={FILTER_LABEL_CLASS}>
                  Thickness
                  <select
                    className={FILTER_SELECT_CLASS}
                    value={thickness}
                    onChange={(event) => {
                      setThickness(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All thicknesses</option>
                    {catalogOptions.thicknesses.map((value) => (
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">
                  Catalog
                </p>
                <h2 className="font-display mt-1 text-2xl font-semibold text-[var(--brand-ink)]">
                  Slabs
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={cyclePriceSort}
                  className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold shadow-sm transition ${priceSort !== "default" ? "border-[var(--brand-orange)] bg-[rgba(247,134,57,0.08)] text-[var(--brand-orange)]" : "border-[var(--brand-line)] bg-white text-[var(--brand-ink)] hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)]"}`}
                >
                  {priceSortLabel}
                </button>
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded-full border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-[color:color-mix(in_srgb,var(--brand-ink)_68%,white)] shadow-sm transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)]"
                  >
                    Clear filters
                  </button>
                ) : null}
                <div className="rounded-full border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-[color:color-mix(in_srgb,var(--brand-ink)_68%,white)] shadow-sm">
                  {loading ? "Loading..." : error ? "Unavailable" : `${totalCount} results`}
                </div>
              </div>
            </section>

            {error ? (
              <div className="rounded-[28px] border border-[#fecaca] bg-[#fff1f1] p-8 text-center text-[#b42318] shadow-sm">
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
            ) : rows.length === 0 ? (
              <div className="rounded-[28px] border border-[var(--brand-line)] bg-white/92 p-8 text-center text-[rgba(35,35,35,0.72)] shadow-sm">
                No slabs match the current filters.
              </div>
            ) : (
              <>
                <div
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                  aria-live="polite"
                >
                {rows.map((row) => {
                  const colors = slabColors(row);
                  const metricLayout = cardMetricLayout(row);
                  const dimensions = sizeValues(row);
                  const thicknesses = thicknessValues(row);
                  const finishes = finishValues(row);
                  const isGroupedNaturalStone = Boolean(row?.is_group);
                  const groupedSuppliers = Array.isArray(row?.suppliers) ? row.suppliers : [];

                  return (
                    <article
                      key={row.id}
                      className="group relative overflow-hidden rounded-[24px] border border-[var(--brand-line)] bg-[rgba(255,255,255,0.96)] shadow-[0_14px_30px_rgba(25,27,28,0.08)] transition-transform [contain-intrinsic-size:420px] [content-visibility:auto] hover:-translate-y-1 sm:rounded-[26px]"
                    >
                      <div className="relative aspect-[16/10] overflow-hidden bg-[linear-gradient(180deg,var(--brand-white)_0%,rgba(255,255,255,0.94)_100%)]">
                        {row.image_url ? (
                          <button
                            type="button"
                            className="group relative block h-full w-full overflow-hidden text-left"
                            onClick={() => {
                              if (isGroupedNaturalStone) {
                                openGroupViewer(row);
                                return;
                              }
                              setLightbox({
                                id: row.id,
                                src: displayImageUrl(row.image_url),
                                alt: row.name || "Slab preview",
                                name: row.name || "Slab preview",
                                brand_name: row.brand_name || row.supplier || "",
                                supplier: row.supplier || "",
                                material: row.material || "",
                                rotateImage: isPorcelainMaterial(row.material),
                                width: formatDimensionToken(row.width || ""),
                                height: formatDimensionToken(row.height || ""),
                                thicknesses: row.thicknesses || [],
                                finishes: row.finishes || [],
                                colors,
                                detail_url: row.detail_url || "",
                              });
                            }}
                            aria-label={isGroupedNaturalStone ? `Open slab group for ${row.name}` : `Open image for ${row.name}`}
                          >
                            <Image
                              src={displayImageUrl(row.image_url)}
                              alt={row.name}
                              fill
                              unoptimized={String(displayImageUrl(row.image_url || "")).startsWith("/api/image-proxy?")}
                              sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                              className={
                                isPorcelainMaterial(row.material)
                                  ? "object-contain object-center p-1 transition duration-300 rotate-90 scale-[2.1] group-hover:rotate-90 group-hover:scale-[2.18]"
                                  : "object-cover object-center transition duration-300 group-hover:scale-[1.03]"
                              }
                            />
                          </button>
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                            No Image
                          </div>
                        )}
                        <div className="absolute right-3 top-3 z-[2] flex items-center gap-2">
                          {isGroupedNaturalStone ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openGroupViewer(row);
                              }}
                              className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/80 bg-white/92 px-4 text-sm font-semibold text-[var(--brand-ink)] shadow-sm backdrop-blur transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)]"
                              aria-label={`View slabs for ${row.name}`}
                              title="View slab group"
                            >
                              View Slabs
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void openEditor(row);
                              }}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/80 bg-white/92 text-[var(--brand-ink)] shadow-sm backdrop-blur transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)]"
                              aria-label={`Edit ${row.name}`}
                              title="Edit slab"
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="h-4.5 w-4.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="m12 20 9-9" />
                                <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
                            </button>
                          )}
                        {!isGroupedNaturalStone && row.detail_url ? (
                            <a
                              href={row.detail_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="group/site inline-flex h-10 items-center justify-center gap-0 overflow-hidden rounded-2xl border border-white/80 bg-white/92 pl-3 pr-3 text-[var(--brand-ink)] shadow-sm backdrop-blur transition-all hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)]"
                              aria-label={`Open supplier page for ${row.name}`}
                              title="View supplier page"
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="h-4.5 w-4.5 shrink-0"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M14 5h5v5" />
                                <path d="M10 14 19 5" />
                                <path d="M19 14v4a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
                              </svg>
                              <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-semibold opacity-0 transition-all duration-200 ease-out group-hover/site:max-w-[7rem] group-hover/site:pl-2 group-hover/site:opacity-100">
                                Visit Site
                              </span>
                            </a>
                        ) : null}
                        </div>
                      </div>
                      <div className="p-3 text-sm text-[#232323] sm:p-3.5">
                        <div className="rounded-[22px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,rgba(242,242,242,0.92)_100%)] px-3.5 py-3 text-[var(--brand-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                          <div className="min-w-0">
                            <div className="min-w-0">
                              <div className="flex items-start gap-2">
                                <h3 className="font-display min-w-0 flex-1 text-[16px] font-semibold leading-snug text-[var(--brand-ink)] sm:text-[17px]">
                                  {isGroupedNaturalStone
                                    ? row.name
                                    : [row.brand_name || row.supplier, row.name].filter(Boolean).join(" · ")}
                                </h3>
                                {row.pricing_codes?.length ? (
                                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                    {row.pricing_codes.map((value) => (
                                      <span
                                        key={`${row.id}-title-price-${value}`}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(60,113,82,0.18)] bg-[#eef6f1] text-[12px] font-semibold text-[#27543f]"
                                        title={`Tier ${value}`}
                                        aria-label={`Tier ${value}`}
                                      >
                                        {value}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              {row.material || row.supplier ? (
                                <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgba(35,35,35,0.54)]">
                                  {isGroupedNaturalStone
                                    ? [
                                        row.material,
                                        row.group_count ? `${row.group_count} slabs` : "",
                                        groupedSuppliers.length ? `${groupedSuppliers.length} suppliers` : "",
                                      ].filter(Boolean).join(" · ")
                                    : [row.material, row.supplier].filter(Boolean).join(" · ")}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          {isGroupedNaturalStone && groupedSuppliers.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {groupedSuppliers.slice(0, 4).map((value) => (
                                <SlabBadge key={`${row.id}-supplier-${value}`} label={value} />
                              ))}
                              {groupedSuppliers.length > 4 ? (
                                <SlabBadge label={`+${groupedSuppliers.length - 4} more`} />
                              ) : null}
                            </div>
                          ) : null}
                          {dimensions.length || thicknesses.length || finishes.length ? (
                            <div className={`mt-3 grid items-stretch gap-2 ${metricLayout.grid}`}>
                              {dimensions.length ? (
                                <div className={`flex min-w-0 flex-col rounded-[16px] border border-[var(--brand-line)] bg-white/88 px-3 py-2 ${metricLayout.sizeTile}`}>
                                  <p className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-orange)] sm:text-[11px]">
                                    Size
                                  </p>
                                  <p className="mt-1 text-[12px] font-semibold leading-tight text-[var(--brand-ink)] sm:text-[13px]">
                                    {renderMetricValues(
                                      dimensions,
                                      "whitespace-nowrap",
                                      "flex flex-col gap-0.5",
                                    )}
                                  </p>
                                </div>
                              ) : null}
                              {thicknesses.length ? (
                                <div className="flex min-w-0 flex-col rounded-[16px] border border-[var(--brand-line)] bg-white/88 px-3 py-2">
                                  <p className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-orange)] sm:text-[11px]">
                                    Thickness
                                  </p>
                                  <p className="mt-1 break-words text-[13px] font-semibold leading-tight text-[var(--brand-ink)] sm:text-[14px]">
                                    {renderMetricValues(
                                      thicknesses,
                                      "whitespace-nowrap",
                                      "flex flex-col gap-0.5",
                                    )}
                                  </p>
                                </div>
                              ) : null}
                              {finishes.length ? (
                                <div className="flex min-w-0 flex-col rounded-[16px] border border-[var(--brand-line)] bg-white/88 px-3 py-2">
                                  <p className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-orange)] sm:text-[11px]">
                                    Finish
                                  </p>
                                  <p className="mt-1 break-words text-[13px] font-semibold leading-tight text-[var(--brand-ink)] sm:text-[14px]">
                                    {renderMetricValues(
                                      finishes,
                                      "whitespace-nowrap",
                                      "flex flex-col gap-0.5",
                                    )}
                                  </p>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="mt-3 space-y-3">
                          {colors.length ? (
                            <div className="flex flex-wrap justify-center gap-2">
                              {colors.map((color) => (
                                <span
                                  key={`${row.id}-color-${color}`}
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
                      </div>
                    </article>
                    );
                  })}
                </div>
                {hasMore ? (
                  <div className="mt-6 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setPage((current) => current + 1)}
                      disabled={loadingMore}
                      className="inline-flex h-12 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-6 text-sm font-semibold text-[var(--brand-ink)] shadow-sm transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loadingMore ? "Loading More…" : "Load More"}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <footer className="px-4 pb-10 pt-2 md:px-6">
          <div className="mx-auto max-w-[1680px] rounded-[28px] border border-[var(--brand-line)] bg-white/70 px-6 py-5 text-center shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">
              Built by EndoMF14
            </p>
            <p className="mt-2 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_68%,white)]">
              Designed to make supplier slab browsing clear, fast, and easy to
              compare.
            </p>
          </div>
        </footer>
      </main>

      {lightbox ? (
        <div
          className="fixed inset-0 z-[70] overflow-y-auto bg-black/75 px-3 py-4 sm:px-4 sm:py-8"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setLightbox(null);
            }
          }}
        >
          <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col">
            <div className="flex flex-1 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-[rgba(10,10,10,0.86)] shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6 sm:py-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
                    Slab Preview
                  </p>
                  <h2 className="font-display mt-1 text-xl font-semibold text-white sm:text-2xl">
                    {lightbox.name || lightbox.alt}
                  </h2>
                  {(lightbox.supplier || lightbox.material) ? (
                    <p className="mt-1 text-sm text-white/68">
                      {[lightbox.supplier, lightbox.material].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {lightbox.brand_name ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] text-white/88">
                        <span className="font-semibold uppercase tracking-[0.08em] text-white/60">Brand</span>
                        <span className="whitespace-nowrap font-medium">{lightbox.brand_name}</span>
                      </span>
                    ) : null}
                    {(lightbox.colors || []).map((value) => (
                      <span
                        key={`${lightbox.id}-viewer-color-${value}`}
                        className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] text-white/88"
                      >
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 rounded-full border border-black/10 shadow-inner"
                          style={colorSwatchStyle(value)}
                        />
                        <span className="whitespace-nowrap">{value}</span>
                      </span>
                    ))}
                    {(lightbox.width || lightbox.height) ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] text-white/88">
                        <span className="font-semibold uppercase tracking-[0.08em] text-white/60">Size</span>
                        <span className="whitespace-nowrap font-medium">
                          {lightbox.width && lightbox.height
                            ? `${lightbox.width} x ${lightbox.height}`
                            : lightbox.width || lightbox.height}
                        </span>
                      </span>
                    ) : null}
                    {(lightbox.thicknesses || []).map((value) => (
                      <span
                        key={`${lightbox.id}-viewer-thickness-${value}`}
                        className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] text-white/88"
                      >
                        <span className="font-semibold uppercase tracking-[0.08em] text-white/60">Thickness</span>
                        <span className="whitespace-nowrap font-medium">{value}</span>
                      </span>
                    ))}
                    {(lightbox.finishes || []).map((value) => (
                      <span
                        key={`${lightbox.id}-viewer-finish-${value}`}
                        className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] text-white/88"
                      >
                        <span className="font-semibold uppercase tracking-[0.08em] text-white/60">Finish</span>
                        <span className="whitespace-nowrap font-medium">{value}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {lightbox.detail_url ? (
                    <a
                      href={lightbox.detail_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/18 bg-white/10 px-4 text-sm font-semibold text-white transition hover:border-white/28 hover:bg-white/16"
                    >
                      View Supplier
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setLightbox(null)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/18 bg-white/10 text-2xl leading-none text-white transition-colors hover:border-white/28 hover:bg-white/16"
                    aria-label="Close slab image preview"
                  >
                    {"\u00D7"}
                  </button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-4">
                <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[28px] border border-white/8 bg-[#111111] p-2 sm:p-3">
                  {modalImageItems.length > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={showPreviousImage}
                        className="absolute left-3 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/35 text-2xl text-white shadow-lg backdrop-blur transition hover:bg-black/50"
                        aria-label="Previous image"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={showNextImage}
                        className="absolute right-3 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/35 text-2xl text-white shadow-lg backdrop-blur transition hover:bg-black/50"
                        aria-label="Next image"
                      >
                        ›
                      </button>
                    </>
                  ) : null}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={lightbox.src}
                    alt={lightbox.alt}
                    className={`max-h-full max-w-full rounded-[24px] object-contain shadow-[0_24px_60px_rgba(0,0,0,0.3)] ${
                      lightbox.rotateImage ? "rotate-90 scale-[1.08] sm:scale-[1.16]" : ""
                    }`}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editorLoading && !editor ? (
        <div className="fixed inset-0 z-[71] flex items-center justify-center bg-black/50 px-4">
          <div className="rounded-[28px] border border-[var(--brand-line)] bg-white px-6 py-5 text-sm font-semibold text-[var(--brand-ink)] shadow-[0_24px_70px_rgba(25,27,28,0.14)]">
            Loading slab editor…
          </div>
        </div>
      ) : null}

      {groupViewer ? (
        <div
          className="fixed inset-0 z-[68] overflow-y-auto bg-black/70 px-3 py-4 sm:px-4 sm:py-8"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeGroupViewer();
            }
          }}
        >
          <div className="mx-auto max-w-6xl">
            <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[rgba(10,10,10,0.88)] shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6 sm:py-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
                    Natural Stone Group
                  </p>
                  <h2 className="font-display mt-1 text-xl font-semibold text-white sm:text-2xl">
                    {groupViewer.name}
                  </h2>
                  <p className="mt-1 text-sm text-white/68">
                    {[
                      groupViewer.material,
                      groupViewer.group_count ? `${groupViewer.group_count} slabs` : "",
                      Array.isArray(groupViewer.suppliers) && groupViewer.suppliers.length
                        ? `${groupViewer.suppliers.length} suppliers`
                        : "",
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeGroupViewer}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/18 bg-white/10 text-2xl leading-none text-white transition-colors hover:border-white/28 hover:bg-white/16"
                  aria-label="Close natural stone group"
                >
                  {"\u00D7"}
                </button>
              </div>
              <div className="p-4 sm:p-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {(Array.isArray(groupViewer.group_rows) ? groupViewer.group_rows : []).map((member) => {
                    const memberColors = slabColors(member);
                    const memberDimensions = sizeValues(member);
                    const memberThicknesses = thicknessValues(member);
                    const memberFinishes = finishValues(member);
                    const memberMetricLayout = cardMetricLayout(member);

                    return (
                      <article
                        key={`group-member-${member.id}`}
                        className="overflow-hidden rounded-[24px] border border-white/10 bg-white/95 shadow-[0_14px_30px_rgba(25,27,28,0.12)]"
                      >
                        <div className="relative aspect-[16/10] overflow-hidden bg-[var(--brand-shell)]">
                          {member.image_url ? (
                            <button
                              type="button"
                              className="block h-full w-full text-left"
                              onClick={() =>
                                setLightbox({
                                  id: member.id,
                                  src: displayImageUrl(member.image_url),
                                  alt: member.name || "Slab preview",
                                  name: member.name || "Slab preview",
                                  brand_name: member.brand_name || member.supplier || "",
                                  supplier: member.supplier || "",
                                  material: member.material || "",
                                  rotateImage: isPorcelainMaterial(member.material),
                                  width: formatDimensionToken(member.width || ""),
                                  height: formatDimensionToken(member.height || ""),
                                  thicknesses: member.thicknesses || [],
                                  finishes: member.finishes || [],
                                  colors: memberColors,
                                  detail_url: member.detail_url || "",
                                })
                              }
                              aria-label={`Open image for ${member.name}`}
                            >
                              <Image
                                src={displayImageUrl(member.image_url)}
                                alt={member.name}
                                fill
                                unoptimized={String(displayImageUrl(member.image_url || "")).startsWith("/api/image-proxy?")}
                                sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                                className="object-cover object-center"
                              />
                            </button>
                          ) : null}
                          <div className="absolute right-3 top-3 z-[2] flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void openEditor(member);
                              }}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/80 bg-white/92 text-[var(--brand-ink)] shadow-sm backdrop-blur transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)]"
                              aria-label={`Edit ${member.name}`}
                              title="Edit slab"
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="h-4.5 w-4.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="m12 20 9-9" />
                                <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
                            </button>
                            {member.detail_url ? (
                              <a
                                href={member.detail_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/80 bg-white/92 px-4 text-sm font-semibold text-[var(--brand-ink)] shadow-sm backdrop-blur transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)]"
                              >
                                Visit Site
                              </a>
                            ) : null}
                          </div>
                        </div>
                        <div className="p-4 text-sm text-[var(--brand-ink)]">
                          <h3 className="font-display text-[16px] font-semibold leading-snug">
                            {[member.supplier, member.name].filter(Boolean).join(" · ")}
                          </h3>
                          <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgba(35,35,35,0.54)]">
                            {member.material}
                          </p>
                          <div className={`mt-3 grid items-stretch gap-2 ${memberMetricLayout.grid}`}>
                            {memberDimensions.length ? (
                              <div className={`rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-shell)] px-3 py-2 ${memberMetricLayout.sizeTile}`}>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-orange)]">Size</p>
                                <p className="mt-1 text-[13px] font-semibold leading-tight">{memberDimensions.join(", ")}</p>
                              </div>
                            ) : null}
                            {memberThicknesses.length ? (
                              <div className="rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-shell)] px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-orange)]">Thickness</p>
                                <p className="mt-1 text-[13px] font-semibold leading-tight">{memberThicknesses.join(", ")}</p>
                              </div>
                            ) : null}
                            {memberFinishes.length ? (
                              <div className="rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-shell)] px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-orange)]">Finish</p>
                                <p className="mt-1 text-[13px] font-semibold leading-tight">{memberFinishes.join(", ")}</p>
                              </div>
                            ) : null}
                          </div>
                          {memberColors.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {memberColors.map((value) => (
                                <span
                                  key={`${member.id}-group-color-${value}`}
                                  className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-line)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[rgba(25,27,28,0.72)]"
                                >
                                  <span
                                    aria-hidden="true"
                                    className="h-3 w-3 rounded-full border border-black/10 shadow-inner"
                                    style={colorSwatchStyle(value)}
                                  />
                                  {value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editor ? (
        <div
          className="fixed inset-0 z-[71] overflow-y-auto bg-black/55 px-4 py-8"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <div className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-white shadow-[0_24px_70px_rgba(25,27,28,0.14)]">
            <div className="flex items-center justify-between border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">
                  Slab Editor
                </p>
                <h2 className="font-display text-2xl font-semibold text-[var(--brand-ink)]">
                  Edit Slab
                </h2>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="h-10 w-10 rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
              >
                {"\u00D7"}
              </button>
            </div>

            <div className="grid gap-4 p-6">
              <div className="flex flex-wrap gap-2">
                {editor.active === false ? (
                  <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-700">
                    Archived
                  </span>
                ) : null}
                {editor.brand_name ? (
                  <span className="inline-flex items-center rounded-full border border-[var(--brand-line)] bg-[var(--brand-white)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(35,35,35,0.7)]">
                    Brand · {editor.brand_name}
                  </span>
                ) : null}
                {editor.supplier ? (
                  <span className="inline-flex items-center rounded-full border border-[var(--brand-line)] bg-[var(--brand-white)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(35,35,35,0.7)]">
                    Supplier · {editor.supplier}
                  </span>
                ) : null}
                {editor.material ? (
                  <span className="inline-flex items-center rounded-full border border-[var(--brand-line)] bg-[var(--brand-white)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(35,35,35,0.7)]">
                    Material · {editor.material}
                  </span>
                ) : null}
              </div>

              <section className="rounded-[26px] border border-[var(--brand-line)] bg-white p-5 shadow-[0_12px_28px_rgba(25,27,28,0.05)]">
                <div className="grid gap-4 xl:grid-cols-12">
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-3">
                    Brand
                    <input
                      type="text"
                      value={editor.brand_name}
                      onChange={(event) => updateEditorField("brand_name", event.target.value)}
                      className={FILTER_INPUT_CLASS}
                    />
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-3">
                    Supplier
                    <select
                      value={editor.supplier_id}
                      onChange={(event) => updateEditorField("supplier_id", event.target.value)}
                      className={FILTER_SELECT_CLASS}
                    >
                      <option value="">Select supplier</option>
                      {editorLookups.suppliers.map((row) => (
                        <option key={`editor-supplier-${row.id}`} value={String(row.id)}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-3">
                    Material
                    <select
                      value={editor.material_id}
                      onChange={(event) => updateEditorField("material_id", event.target.value)}
                      className={FILTER_SELECT_CLASS}
                    >
                      <option value="">Select material</option>
                      {editorLookups.materials.map((row) => (
                        <option key={`editor-material-${row.id}`} value={String(row.id)}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-4">
                    Slab Name
                    <input
                      type="text"
                      value={editor.name}
                      onChange={(event) => updateEditorField("name", event.target.value)}
                      className={FILTER_INPUT_CLASS}
                    />
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                    Width
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editor.width}
                      onChange={(event) => updateEditorField("width", event.target.value)}
                      className={FILTER_INPUT_CLASS}
                    />
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                    Height
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editor.height}
                      onChange={(event) => updateEditorField("height", event.target.value)}
                      className={FILTER_INPUT_CLASS}
                    />
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-4">
                    Supplier URL
                    <input
                      type="url"
                      value={editor.detail_url}
                      onChange={(event) => updateEditorField("detail_url", event.target.value)}
                      className={FILTER_INPUT_CLASS}
                    />
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-12">
                    Image URL
                    <input
                      type="url"
                      value={editor.image_url}
                      onChange={(event) => updateEditorField("image_url", event.target.value)}
                      className={FILTER_INPUT_CLASS}
                    />
                  </label>
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-3">
                <section className="rounded-[22px] border border-[var(--brand-line)] bg-[var(--brand-white)] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Colors</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {editorLookups.colors.map((row) => {
                      const value = row.name;
                      return (
                        <button
                          key={`editor-color-${row.id}`}
                          type="button"
                          onClick={() => toggleEditorListValue("colors", value)}
                          className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(247,134,57,0.14)] ${
                            listIncludes(editor.colors, value)
                              ? "border-[var(--brand-orange)] bg-white text-[rgba(25,27,28,0.82)] ring-4 ring-[rgba(247,134,57,0.14)]"
                              : "border-[var(--brand-line)] bg-white/92 text-[rgba(25,27,28,0.72)]"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 rounded-full border border-black/10 shadow-inner"
                            style={colorSwatchStyle(value)}
                          />
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-[22px] border border-[var(--brand-line)] bg-[var(--brand-white)] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Finishes</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {editorLookups.finishes.map((row) => (
                      <button
                        key={`editor-finish-${row.id}`}
                        type="button"
                        onClick={() => toggleEditorListValue("finishes", row.name)}
                        className={`inline-flex h-10 items-center justify-center rounded-full border px-3.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(247,134,57,0.14)] ${
                          listIncludes(editor.finishes, row.name)
                            ? "border-[var(--brand-orange)] bg-white text-[var(--brand-orange)] ring-4 ring-[rgba(247,134,57,0.14)]"
                            : "border-[var(--brand-line)] bg-white text-[var(--brand-ink)] hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                        }`}
                      >
                        {row.name}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="rounded-[22px] border border-[var(--brand-line)] bg-[var(--brand-white)] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Thicknesses</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {catalogOptions.thicknesses.map((value) => (
                      <button
                        key={`editor-thickness-${value}`}
                        type="button"
                        onClick={() => toggleEditorListValue("thicknesses", value)}
                        className={`inline-flex h-10 items-center justify-center rounded-full border px-3.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(247,134,57,0.14)] ${
                          listIncludes(editor.thicknesses, value)
                            ? "border-[var(--brand-orange)] bg-white text-[var(--brand-orange)] ring-4 ring-[rgba(247,134,57,0.14)]"
                            : "border-[var(--brand-line)] bg-white text-[var(--brand-ink)] hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              {editorError ? (
                <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {editorError}
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3">
                {archiveConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-rose-700">Archive this slab?</span>
                    <button
                      type="button"
                      onClick={archiveEditor}
                      disabled={editorSaving}
                      className="inline-flex h-10 items-center justify-center rounded-2xl bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setArchiveConfirm(false)}
                      className="inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-white)]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={archiveEditor}
                    disabled={editorSaving}
                    className="inline-flex h-12 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-6 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Archive Slab
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeEditor}
                  className="inline-flex h-12 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-6 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveEditor}
                  disabled={editorSaving}
                  className="inline-flex h-12 items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-6 text-sm font-semibold text-white transition hover:bg-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {editorSaving ? "Saving Slab…" : "Save Slab"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
