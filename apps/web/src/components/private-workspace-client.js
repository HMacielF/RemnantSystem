/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useBodyScrollLock from "@/components/use-body-scroll-lock";

const MAX_BROWSER_IMAGE_PIXELS = 16_000_000;
const CROP_CANVAS_WIDTH = 960;
const CROP_CANVAS_HEIGHT = 640;
const DEFAULT_CROP_RECT = {
  x: 120,
  y: 90,
  width: 720,
  height: 540,
};
const TOAST_DURATION_MS = 3600;
const HOLD_REQUEST_REFRESH_MS = 15_000;

function imageSrc(remnant) {
  return remnant.image || remnant.source_image_url || "";
}

function displayRemnantId(remnant) {
  return remnant.display_id || remnant.moraware_remnant_id || remnant.id;
}

function isAccessDeniedError(message) {
  const normalized = String(message || "").trim().toLowerCase();
  return [
    "not authenticated",
    "invalid session",
    "profile not found",
    "your account is inactive",
    "inactive profile",
    "access denied",
    "forbidden",
  ].some((fragment) => normalized.includes(fragment));
}

function remnantToastLabel(remnant) {
  const id = displayRemnantId(remnant);
  const name = String(remnant?.name || "").trim();
  return `#${id}${name ? ` - ${name}` : ""}`;
}

function internalRemnantId(remnant) {
  return remnant.internal_remnant_id || remnant.id || null;
}

function statusText(remnant) {
  const normalized = String(remnant?.status || "").trim().toLowerCase();
  if (!normalized || normalized === "available") return "Available";
  if (normalized === "hold" || normalized === "on hold") return "On Hold";
  if (normalized === "sold") return "Sold";
  return remnant?.status || "Available";
}

function statusToastText(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "hold" || normalized === "on hold") return "on hold";
  if (normalized === "sold") return "sold";
  return "available";
}

function statusBadgeClass(status) {
  const lc = String(status || "").toLowerCase();
  if (lc === "sold") return "bg-rose-100 text-rose-800 ring-1 ring-rose-300";
  if (lc === "hold" || lc === "on hold") return "bg-amber-100 text-amber-900 ring-1 ring-amber-300";
  return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300";
}

function remnantJobReference(remnant) {
  const normalized = normalizeRemnantStatus(remnant);
  if (normalized === "hold") return normalizeJobNumberInput(remnant?.current_hold?.job_number || "");
  if (normalized === "sold") {
    return normalizeJobNumberInput(remnant?.sold_job_number || remnant?.current_sale?.job_number || "");
  }
  return "";
}

function jobNumberPrefixForCompanyName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("prime")) return "P";
  return "J";
}

function jobNumberPrefixForRemnant(remnant) {
  return jobNumberPrefixForCompanyName(companyText(remnant));
}

function formatJobNumber(value, context) {
  const normalized = normalizeJobNumberInput(value);
  if (!normalized) return "";
  const prefix =
    typeof context === "string"
      ? jobNumberPrefixForCompanyName(context)
      : jobNumberPrefixForRemnant(context);
  return `${prefix}${normalized}`;
}

function statusBadgeText(remnant) {
  const normalized = normalizeRemnantStatus(remnant);
  const jobReference = remnantJobReference(remnant);

  if (normalized === "hold") {
    const owner = firstName(remnant?.current_hold?.owner_name || "");
    const until = remnant?.current_hold?.expires_at ? `Until ${formatShortDateLabel(remnant.current_hold.expires_at)}` : "";
    return [owner || "On Hold", formatJobNumber(jobReference, remnant), until].filter(Boolean).join(" · ");
  }

  if (normalized === "sold") {
    const soldBy = firstName(remnant?.sold_by_name || remnant?.current_sale?.sold_by_name || "");
    return [soldBy || "Sold", formatJobNumber(jobReference, remnant)].filter(Boolean).join(" · ");
  }

  return statusText(remnant);
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

function materialOptionsFromRows(rows) {
  return uniqueMaterialOptions(
    (Array.isArray(rows) ? rows : [])
      .map((row) => row?.material_name || row?.material?.name || row?.material)
      .filter(Boolean),
  );
}

function normalizeStoneLookupName(value) {
  return String(value || "").trim().toLowerCase();
}

function stoneNameWithoutBrandPrefix(stoneName, brandName) {
  const stone = String(stoneName || "").trim();
  const brand = String(brandName || "").trim();
  if (!stone || !brand) return stone;

  const normalizedStone = normalizeStoneLookupName(stone);
  const normalizedBrand = normalizeStoneLookupName(brand);
  if (!normalizedStone.startsWith(`${normalizedBrand} `)) return stone;

  return stone.slice(brand.length).trim();
}

function supportsBrandField(materialName) {
  const normalized = normalizeStoneLookupName(materialName);
  return normalized === "quartz" || normalized === "porcelain";
}

function colorListIncludes(values, target) {
  const normalizedTarget = normalizeStoneLookupName(target);
  return (Array.isArray(values) ? values : []).some((value) => normalizeStoneLookupName(value) === normalizedTarget);
}

function stoneLookupMatchesName(row, stoneName) {
  const normalizedName = normalizeStoneLookupName(stoneName);
  if (!normalizedName || !row) return false;

  return [row.display_name, row.stone_name, row.name].some(
    (value) => normalizeStoneLookupName(value) === normalizedName,
  );
}

function sharedStoneColorsForEditor(stoneProducts, materialId, stoneName) {
  const numericMaterialId = Number(materialId);
  const match = (Array.isArray(stoneProducts) ? stoneProducts : []).find((row) => {
    return Number(row?.material_id) === numericMaterialId && stoneLookupMatchesName(row, stoneName);
  });

  if (!match) {
    return [];
  }

  return Array.isArray(match.colors) ? match.colors : [];
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
  const material = String(remnant.material_name || "").trim();
  const stone = String(remnant.name || "").trim();
  if (material && stone) return `${material} | ${stone}`;
  return material || stone || "Unnamed";
}

function brandText(remnant) {
  return String(remnant?.brand_name || "").trim();
}

function stoneNameText(remnant) {
  return String(remnant?.name || "").trim();
}

function companyText(remnant) {
  return String(remnant?.company_name || remnant?.company || "").trim();
}

function thicknessText(remnant) {
  const value = String(remnant?.thickness_name || remnant?.thickness || "").trim();
  if (!value) return "";
  const normalized = value.toLowerCase();
  if (normalized === "unknown" || normalized === "n/a" || normalized === "na") return "";
  return value;
}

function finishText(remnant) {
  return String(remnant?.finish_name || "").trim();
}

function priceText(remnant) {
  const numeric = Number(remnant?.price_per_sqft);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const formatted = Number.isInteger(numeric)
    ? String(numeric)
    : numeric.toFixed(numeric >= 100 ? 0 : 2).replace(/\.?0+$/, "");
  return `$${formatted}`;
}

function privateCardHeading(remnant) {
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

function privateCardSubheading(remnant) {
  const material = String(remnant?.material_name || remnant?.material || "").trim();
  const company = companyText(remnant);
  return [material, company].filter(Boolean).join(" · ");
}

function privateCardMetricEntries(remnant) {
  return [
    { label: "Size", value: cardSizeText(remnant) },
    ...(priceText(remnant) ? [{ label: "Price", value: priceText(remnant), title: "Open slab price per sqft" }] : []),
    ...(thicknessText(remnant) ? [{ label: "Thick", value: thicknessText(remnant), title: "Thickness" }] : []),
    ...(finishText(remnant) ? [{ label: "Finish", value: finishText(remnant) }] : []),
  ];
}

function privateModalSummaryEntries(remnant) {
  return [
    { label: "Material", value: String(remnant?.material_name || remnant?.material || "").trim() },
    { label: "Size", value: cardSizeText(remnant) },
    ...(priceText(remnant) ? [{ label: "Price", value: priceText(remnant), title: "Open slab price per sqft" }] : []),
    { label: "Thick", value: thicknessText(remnant), title: "Thickness" },
    { label: "Finish", value: finishText(remnant) },
  ].filter((entry) => String(entry.value || "").trim());
}

function PrivateRemnantSummaryBlock({ remnant, className = "", onOpenImage }) {
  const colors = remnantColors(remnant);
  const metrics = privateModalSummaryEntries(remnant);
  const image = imageSrc(remnant);
  const displayId = displayRemnantId(remnant);

  return (
    <section
      className={`rounded-[26px] border border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,var(--brand-white)_100%)] p-3.5 shadow-[0_16px_38px_rgba(25,27,28,0.06)] sm:p-4 ${className}`.trim()}
    >
      <div className="grid gap-4 sm:grid-cols-[240px_minmax(0,1fr)] sm:items-start">
        <div className="self-start">
          <button
            type="button"
            onClick={onOpenImage}
            disabled={!image}
            className={`overflow-hidden rounded-[22px] border border-white/80 bg-white text-left shadow-[0_12px_24px_rgba(25,27,28,0.08)] transition ${image ? "hover:-translate-y-0.5" : "cursor-default"}`}
          >
            {image ? (
              <img
                alt={`Remnant ${displayId}`}
                className="h-36 w-full bg-[var(--brand-white)] p-2 object-contain object-center"
                src={image}
              />
            ) : (
              <div className="flex h-36 w-full items-center justify-center bg-[var(--brand-white)] px-6 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                No Image
              </div>
            )}
          </button>
          {colors.length ? (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {colors.map((color) => (
                <span
                  key={`${displayId}-summary-${color}`}
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
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-orange)]">Remnant Summary</p>
          <div className="mt-3">
            <h3 className="font-display text-lg font-semibold text-[var(--brand-ink)] sm:text-xl">
              {privateCardHeading(remnant)}
            </h3>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgba(35,35,35,0.54)]">
              {privateCardSubheading(remnant)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full border border-[var(--brand-line)] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-orange-deep)]">
                ID #{displayId}
              </span>
              <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusBadgeClass(remnant?.status)}`}>
                {statusText(remnant)}
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {metrics.map((entry) => (
                <div
                  key={`${displayId}-${entry.label}`}
                  className="rounded-[20px] border border-[var(--brand-line)] bg-white/92 px-4 py-3"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]" title={entry.title}>
                    {entry.label}
                  </p>
                  <p className="mt-1 text-sm font-medium text-[var(--brand-ink)]">{entry.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function remnantColors(remnant) {
  return Array.isArray(remnant?.colors) ? remnant.colors.filter(Boolean) : [];
}

function colorSwatchStyle(colorName) {
  const normalized = normalizeStoneLookupName(colorName);
  const palette = {
    beige: { backgroundColor: "#d9c3a5" },
    black: { backgroundColor: "#2b2928" },
    blonde: { backgroundColor: "#e8d8b4" },
    blue: { backgroundColor: "#7d9dbf" },
    brown: { backgroundColor: "#8b5e3c" },
    cream: { backgroundColor: "#efe2c7" },
    gold: { backgroundColor: "#c8a14e" },
    gray: { backgroundColor: "#8e9096" },
    "gray-dark": { backgroundColor: "#575b63" },
    "gray-light": { backgroundColor: "#c9ced6" },
    green: { backgroundColor: "#758c75" },
    navy: { backgroundColor: "#2f4a6d" },
    taupe: { backgroundColor: "#a9927b" },
    white: { backgroundColor: "#ffffff" },
  };
  return palette[normalized] || { backgroundColor: "#d6ccc2" };
}

function SelectField({ wrapperClassName = "relative mt-2", className = "", children, ...props }) {
  return (
    <div className={wrapperClassName}>
      <select
        {...props}
        className={`h-12 w-full appearance-none rounded-2xl border border-[var(--brand-line)] bg-white px-4 pr-10 text-sm font-medium text-[var(--brand-ink)] shadow-[0_1px_0_rgba(255,255,255,0.75),0_10px_24px_rgba(25,27,28,0.05)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] ${className}`}
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

function InAppSelect({
  value,
  onChange,
  options,
  placeholder = "Select option",
  wrapperClassName = "mt-2",
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const selected = (Array.isArray(options) ? options : []).find((option) => String(option.value) === String(value ?? ""));
  const buttonText = selected?.label || placeholder;

  return (
    <div className={`relative ${wrapperClassName}`.trim()}>
      <button
        type="button"
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        disabled={disabled}
        className={`flex h-12 w-full items-center justify-between gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-left text-sm font-medium shadow-[0_1px_0_rgba(255,255,255,0.75),0_10px_24px_rgba(25,27,28,0.05)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] ${selected ? "text-[var(--brand-ink)]" : "text-[rgba(35,35,35,0.48)]"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <span className="truncate">{buttonText}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-[var(--brand-orange)] transition ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>
      {open && !disabled ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-[22px] border border-[var(--brand-line)] bg-white shadow-[0_20px_40px_rgba(25,27,28,0.12)]">
          <div className="max-h-64 overflow-y-auto p-2">
            {(Array.isArray(options) ? options : []).map((option) => {
              const isSelected = String(option.value) === String(value ?? "");
              return (
                <button
                  key={`select-${option.value}`}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onChange?.({ target: { value: option.value } });
                    setOpen(false);
                  }}
                  className={`flex w-full items-center rounded-[16px] px-3 py-2.5 text-left transition hover:bg-[var(--brand-white)] ${isSelected ? "bg-[var(--brand-white)]" : ""}`}
                >
                  <span className={`block truncate text-sm ${isSelected ? "font-semibold text-[var(--brand-ink)]" : "font-medium text-[rgba(35,35,35,0.78)]"}`}>
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function compactSizeText(remnant) {
  if (!remnant?.width || !remnant?.height) return "Unknown";
  return `${remnant.width} x ${remnant.height}`;
}

function formatDateLabel(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatShortDateLabel(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(date);
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

function cropSourceUrl(src) {
  const value = String(src || "").trim();
  if (!value) return "";
  if (value.startsWith("blob:") || value.startsWith("data:")) return value;

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin === window.location.origin) return parsed.toString();
    return `/api/image-proxy?url=${encodeURIComponent(parsed.toString())}`;
  } catch (_error) {
    return value;
  }
}

function preferredCropType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized === "image/png" || normalized === "image/webp") return normalized;
  return "image/webp";
}

function imagePayloadFromDataUrl(dataUrl, fileName, type) {
  return {
    name: fileName,
    type: preferredCropType(type),
    dataUrl,
  };
}

function formatCropRotationLabel(value) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}deg`;
}

function canvasPointFromPointer(event, canvas) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
    y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
  };
}

function cropHandles(rect) {
  return [
    { key: "nw", x: rect.x, y: rect.y },
    { key: "ne", x: rect.x + rect.width, y: rect.y },
    { key: "sw", x: rect.x, y: rect.y + rect.height },
    { key: "se", x: rect.x + rect.width, y: rect.y + rect.height },
  ];
}

function pointInCropRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function normalizeCropDraft(draft, image, canvasWidth = CROP_CANVAS_WIDTH, canvasHeight = CROP_CANVAS_HEIGHT) {
  if (!image) return draft;

  const next = {
    ...draft,
    cropRect: { ...draft.cropRect },
  };
  const scaledWidth = image.width * next.scale;
  const scaledHeight = image.height * next.scale;
  const maxOffsetX = Math.max(0, (scaledWidth - canvasWidth) / 2);
  const maxOffsetY = Math.max(0, (scaledHeight - canvasHeight) / 2);

  next.offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, next.offsetX));
  next.offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, next.offsetY));

  next.cropRect.width = Math.max(40, Math.min(canvasWidth, next.cropRect.width));
  next.cropRect.height = Math.max(40, Math.min(canvasHeight, next.cropRect.height));
  next.cropRect.x = Math.max(0, Math.min(canvasWidth - next.cropRect.width, next.cropRect.x));
  next.cropRect.y = Math.max(0, Math.min(canvasHeight - next.cropRect.height, next.cropRect.y));

  return next;
}

function PrivateWorkspaceSkeletonCard({ showActions = false }) {
  return (
    <div className="overflow-hidden rounded-[26px] border border-white/20 bg-white/16 shadow-[0_14px_30px_rgba(15,23,39,0.14)]">
      <div className="relative aspect-[4/3] overflow-hidden bg-[linear-gradient(180deg,rgba(247,239,230,0.16)_0%,rgba(239,228,215,0.10)_100%)]">
        <div className="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,rgba(75,104,138,0.58),rgba(57,85,123,0.48),rgba(75,104,138,0.58))]" />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="h-6 w-20 animate-pulse rounded-full bg-white/22" />
          <div className="h-6 w-28 animate-pulse rounded-full bg-white/18" />
        </div>
      </div>
      <div className="space-y-2.5 p-3.5 text-sm">
        <div className={`gap-3 ${showActions ? "grid grid-cols-[minmax(0,1fr)_108px] items-start" : ""}`}>
          <div className="space-y-3 rounded-[22px] bg-white/85 px-3 py-3">
            <div className="h-4 w-3/5 animate-pulse rounded-full bg-[#dbe3ec]" />
            <div className="h-4 w-2/3 animate-pulse rounded-full bg-[#e7edf4]" />
          </div>
          {showActions ? (
            <div className="grid gap-2 self-stretch">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-11 animate-pulse rounded-[18px] bg-white/18" />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function cropGeometry(cropModal, image) {
  if (!cropModal || !image) return null;
  const drawWidth = image.width * cropModal.scale;
  const drawHeight = image.height * cropModal.scale;
  return {
    drawWidth,
    drawHeight,
    drawX: (CROP_CANVAS_WIDTH - drawWidth) / 2 + cropModal.offsetX,
    drawY: (CROP_CANVAS_HEIGHT - drawHeight) / 2 + cropModal.offsetY,
  };
}

function renderCropCanvas(canvas, image, cropModal) {
  if (!canvas || !image || !cropModal) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const geometry = cropGeometry(cropModal, image);
  if (!geometry) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#efe4d8";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const centerX = geometry.drawX + geometry.drawWidth / 2;
  const centerY = geometry.drawY + geometry.drawHeight / 2;
  context.save();
  context.translate(centerX, centerY);
  context.rotate(((cropModal.rotationBase + cropModal.rotation) * Math.PI) / 180);
  context.drawImage(image, -geometry.drawWidth / 2, -geometry.drawHeight / 2, geometry.drawWidth, geometry.drawHeight);
  context.restore();

  const rect = cropModal.cropRect;
  context.save();
  context.fillStyle = "rgba(15, 23, 39, 0.5)";
  context.beginPath();
  context.rect(0, 0, canvas.width, canvas.height);
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.fill("evenodd");
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  cropHandles(rect).forEach((handle) => {
    context.fillStyle = "#f08b49";
    context.fillRect(handle.x - 7, handle.y - 7, 14, 14);
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.5;
    context.strokeRect(handle.x - 7, handle.y - 7, 14, 14);
  });
  context.restore();
}

async function loadImageElement(src) {
  const image = new Image();
  image.src = src;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Failed to load image for cropping"));
  });
  return image;
}

async function normalizeImageFile(file) {
  const contentType = String(file?.type || "").toLowerCase();
  if (!contentType.startsWith("image/")) return null;
  if (contentType === "image/gif") return null;

  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(imageUrl);
    const originalWidth = image.naturalWidth || image.width;
    const originalHeight = image.naturalHeight || image.height;
    const originalPixels = originalWidth * originalHeight;
    const scale = originalPixels > MAX_BROWSER_IMAGE_PIXELS
      ? Math.sqrt(MAX_BROWSER_IMAGE_PIXELS / originalPixels)
      : 1;
    const targetWidth = Math.max(1, Math.round(originalWidth * scale));
    const targetHeight = Math.max(1, Math.round(originalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to prepare image compression canvas");
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const outputType = preferredCropType(contentType);
    return {
      name: file.name.replace(/\.[^.]+$/, "") + ".webp",
      type: outputType,
      dataUrl: canvas.toDataURL(outputType, 0.86),
    };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function fileToPayload(file) {
  if (!file) return null;
  const normalizedImage = await normalizeImageFile(file);
  if (normalizedImage) return normalizedImage;

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

  return {
    name: file.name,
    type: file.type,
    dataUrl,
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

function canManageStructure(profile) {
  return ["super_admin", "manager"].includes(profile?.system_role || "");
}

function canManageRemnant(profile, remnant) {
  if (!profile) return false;
  if (["super_admin", "manager"].includes(profile.system_role)) return true;
  return (
    profile.system_role === "status_user" &&
    profile.company_id !== null &&
    Number(profile.company_id) === Number(remnant.company_id)
  );
}

function normalizeRemnantStatus(remnant) {
  return String(remnant?.status || "").trim().toLowerCase();
}

function statusOwnedByProfile(profile, remnant) {
  if (!profile || profile.system_role !== "status_user") return true;

  const status = normalizeRemnantStatus(remnant);
  if (status === "hold") {
    return String(remnant?.current_hold?.hold_owner_user_id || "") === String(profile.id || "");
  }
  if (status === "sold") {
    return String(remnant?.sold_by_user_id || remnant?.current_sale?.sold_by_user_id || "") === String(profile.id || "");
  }
  return true;
}

function humanizeRole(role) {
  if (role === "status_user") return "Sales Rep";
  if (role === "super_admin") return "Super Admin";
  return String(role || "user")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function profileDisplayName(profile) {
  return profile?.full_name || profile?.display_name || profile?.email || "User";
}

function firstName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.split(/\s+/)[0] || text;
}

function normalizeJobNumberInput(value) {
  return String(value || "")
    .replace(/^\s*[jp]\s*#?\s*/i, "")
    .trim();
}

export default function PrivateWorkspaceClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const initialFilters = useMemo(
    () => currentFiltersFromSearch(new URLSearchParams(searchKey)),
    [searchKey],
  );
  const [filters, setFilters] = useState(initialFilters);
  const [profile, setProfile] = useState(null);
  const [remnants, setRemnants] = useState([]);
  const [availableMaterialOptions, setAvailableMaterialOptions] = useState([]);
  const [holdRequests, setHoldRequests] = useState([]);
  const [myHolds, setMyHolds] = useState([]);
  const [mySold, setMySold] = useState([]);
  const [lookups, setLookups] = useState({ companies: [], materials: [], thicknesses: [], finishes: [], colors: [], stone_products: [] });
  const [salesReps, setSalesReps] = useState([]);
  const [nextStoneId, setNextStoneId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState("loading");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("success");
  const [selectedImageIndex, setSelectedImageIndex] = useState(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [myHoldsOpen, setMyHoldsOpen] = useState(false);
  const [mySoldOpen, setMySoldOpen] = useState(false);
  const [myHoldsLoading, setMyHoldsLoading] = useState(false);
  const [mySoldLoading, setMySoldLoading] = useState(false);
  const [pendingReviewId, setPendingReviewId] = useState("");
  const [holdRequestDrafts, setHoldRequestDrafts] = useState({});
  const [workingRemnantId, setWorkingRemnantId] = useState("");
  const [editorMode, setEditorMode] = useState("");
  const [editorForm, setEditorForm] = useState(null);
  const [editorColorComposerOpen, setEditorColorComposerOpen] = useState(false);
  const [editorColorDraft, setEditorColorDraft] = useState("");
  const [editorColorSaving, setEditorColorSaving] = useState(false);
  const [editorStoneMenuOpen, setEditorStoneMenuOpen] = useState(false);
  const [editorBrandMenuOpen, setEditorBrandMenuOpen] = useState(false);
  const [holdEditor, setHoldEditor] = useState(null);
  const [soldEditor, setSoldEditor] = useState(null);
  const [cropModal, setCropModal] = useState(null);
  const remnantAbortRef = useRef(null);
  const enrichmentRef = useRef(null);
  const cropCanvasRef = useRef(null);
  const cropImageRef = useRef(null);
  const cropDragRef = useRef({
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    startCropRect: DEFAULT_CROP_RECT,
    dragMode: null,
    activeHandle: null,
  });
  const editorImageInputRef = useRef(null);
  const lastPathnameRef = useRef(pathname);
  const canStructure = canManageStructure(profile);
  const isStatusUser = profile?.system_role === "status_user";
  const roleDisplay = humanizeRole(profile?.system_role);
  const profileCompanyName = useMemo(() => {
    const directName = String(
      profile?.company_name || profile?.company?.name || profile?.company || "",
    ).trim();
    if (directName) return directName;
    const match = (Array.isArray(lookups?.companies) ? lookups.companies : []).find(
      (company) => Number(company?.id) === Number(profile?.company_id),
    );
    return String(match?.name || "").trim();
  }, [lookups?.companies, profile]);
  const materialFilterOptions = useMemo(() => {
    return uniqueMaterialOptions([...availableMaterialOptions, ...filters.materials]);
  }, [availableMaterialOptions, filters.materials]);
  const filterGridClass = canStructure
    ? "mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] 2xl:grid-cols-[fit-content(29rem)_minmax(360px,1fr)_110px_110px_140px_56px] 2xl:items-end"
    : "mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] 2xl:grid-cols-[fit-content(29rem)_minmax(360px,1fr)_110px_110px_140px] 2xl:items-end";
  const activeFilterCount = useMemo(() => {
    let total = 0;
    if (filters.materials.length) total += 1;
    if (filters.stone.trim()) total += 1;
    if (filters.minWidth.trim()) total += 1;
    if (filters.minHeight.trim()) total += 1;
    if (filters.status.trim()) total += 1;
    return total;
  }, [filters]);
  const boardGridClass = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  const editorStoneSuggestions = useMemo(() => {
    if (!editorForm?.material_id) return [];
    const materialId = Number(editorForm.material_id);
    if (!Number.isFinite(materialId)) return [];
    const normalizedBrand = normalizeStoneLookupName(editorForm.brand_name || "");

    return (Array.isArray(lookups.stone_products) ? lookups.stone_products : [])
      .filter((row) => {
        if (Number(row.material_id) !== materialId) return false;
        if (!normalizedBrand) return true;
        return normalizeStoneLookupName(row.brand_name || "").includes(normalizedBrand);
      })
      .sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || "")));
  }, [editorForm?.brand_name, editorForm?.material_id, lookups.stone_products]);
  const editorBrandSuggestions = useMemo(() => {
    if (!editorForm?.material_id) return [];
    const materialId = Number(editorForm.material_id);
    if (!Number.isFinite(materialId)) return [];
    const seen = new Set();
    return (Array.isArray(lookups.stone_products) ? lookups.stone_products : [])
      .filter((row) => Number(row.material_id) === materialId)
      .map((row) => String(row.brand_name || "").trim())
      .filter((value) => {
        const key = normalizeStoneLookupName(value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.localeCompare(b));
  }, [editorForm?.material_id, lookups.stone_products]);
  const filteredEditorBrandSuggestions = useMemo(() => {
    const search = normalizeStoneLookupName(editorForm?.brand_name || "");
    const rows = Array.isArray(editorBrandSuggestions) ? editorBrandSuggestions : [];
    if (!search) return rows.slice(0, 8);
    return rows.filter((value) => normalizeStoneLookupName(value).includes(search)).slice(0, 8);
  }, [editorBrandSuggestions, editorForm?.brand_name]);
  const filteredEditorStoneSuggestions = useMemo(() => {
    const search = normalizeStoneLookupName(editorForm?.name || "");
    const rows = Array.isArray(editorStoneSuggestions) ? editorStoneSuggestions : [];
    if (!search) return rows.slice(0, 8);
    return rows
      .filter((row) => {
        const display = normalizeStoneLookupName(row.display_name || row.stone_name || "");
        const brand = normalizeStoneLookupName(row.brand_name || "");
        return display.includes(search) || brand.includes(search);
      })
      .slice(0, 8);
  }, [editorForm?.name, editorStoneSuggestions]);
  const matchedEditorStone = useMemo(() => {
    if (!editorForm?.material_id || !editorForm?.name) return null;
    const materialId = Number(editorForm.material_id);
    if (!Number.isFinite(materialId) || !normalizeStoneLookupName(editorForm.name)) return null;
    const normalizedBrand = normalizeStoneLookupName(editorForm.brand_name || "");

    return editorStoneSuggestions.find((row) => {
      if (!stoneLookupMatchesName(row, editorForm.name)) return false;
      if (!normalizedBrand) return true;
      return normalizeStoneLookupName(row.brand_name || "") === normalizedBrand;
    }) || editorStoneSuggestions.find((row) => stoneLookupMatchesName(row, editorForm.name)) || null;
  }, [editorForm?.brand_name, editorForm?.material_id, editorForm?.name, editorStoneSuggestions]);
  const selectedEditorMaterialName = useMemo(() => {
    const materialId = Number(editorForm?.material_id);
    if (!Number.isFinite(materialId)) return "";
    const row = (Array.isArray(lookups.materials) ? lookups.materials : []).find(
      (item) => Number(item?.id) === materialId,
    );
    return String(row?.name || "").trim();
  }, [editorForm?.material_id, lookups.materials]);
  const showEditorBrandField = supportsBrandField(selectedEditorMaterialName);
  const modalImageItems = useMemo(
    () => remnants.filter((remnant) => Boolean(imageSrc(remnant))),
    [remnants],
  );
  const selectedImageRemnant =
    selectedImageIndex !== null && selectedImageIndex >= 0 && selectedImageIndex < modalImageItems.length
      ? modalImageItems[selectedImageIndex]
      : null;
  const isModalOpen = Boolean(
    selectedImageRemnant ||
      queueOpen ||
      myHoldsOpen ||
      mySoldOpen ||
      (editorMode && editorForm) ||
      holdEditor ||
      soldEditor ||
      cropModal,
  );
  const workspaceCopy = isStatusUser
    ? {
        eyebrow: "Status Workspace",
        title: "Update live inventory fast.",
        description:
          "Review requests, change status, and keep your company feed current.",
        boardEyebrow: "Your Inventory Lane",
        boardTitle: "Status updates and request work",
        queueTitle: "Requests",
        queueDescription: "Requests that need a quick approve or deny pass from your lane.",
      }
    : {
        eyebrow: "Private Workspace",
        title: "Manage your live inventory.",
        description:
          "Review requests, update remnants, and keep the feed current.",
        boardEyebrow: "Workspace Board",
        boardTitle: "Inventory and quick controls",
        queueTitle: "Pending hold requests",
        queueDescription: "Review incoming requests without leaving the management workspace.",
      };

  useBodyScrollLock(isModalOpen);

  function clearMessage() {
    setMessage("");
  }

  function showSuccessMessage(text) {
    setMessageTone("success");
    setMessage(text);
  }

  function showErrorMessage(text) {
    setMessageTone("error");
    setMessage(text);
  }

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
    setFilters(currentFiltersFromSearch(new URLSearchParams(searchKey)));
  }, [searchKey]);

  useEffect(() => {
    if (!message) return undefined;
    const timeoutId = window.setTimeout(() => {
      setMessage("");
    }, TOAST_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

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

    async function bootstrap() {
      try {
        const profilePayload = await apiFetch("/api/me");
        const nextProfile = profilePayload.profile || null;
        if (!mounted) return;
        if (!nextProfile) {
          setAuthState("forbidden");
          return;
        }
        setProfile(nextProfile);
        setAuthState("ready");

        const [requestsPayload, myHoldsPayload, mySoldPayload, lookupPayload, salesRepPayload, stonePayload, remnantRows] = await Promise.all([
          apiFetch("/api/hold-requests?status=pending", { cache: "no-store" }),
          apiFetch("/api/my-holds", { cache: "no-store" }),
          apiFetch("/api/my-sold", { cache: "no-store" }),
          apiFetch("/api/lookups", { cache: "no-store" }),
          nextProfile.system_role === "status_user" ? Promise.resolve([]) : apiFetch("/api/sales-reps", { cache: "no-store" }),
          canManageStructure(nextProfile) ? apiFetch("/api/next-stone-id", { cache: "no-store" }) : Promise.resolve({ nextStoneId: null }),
          apiFetch("/api/remnants?enrich=0", { cache: "no-store" }),
        ]);

        if (!mounted) return;
        setHoldRequests(Array.isArray(requestsPayload) ? requestsPayload : []);
        setMyHolds(Array.isArray(myHoldsPayload) ? myHoldsPayload : []);
        setMySold(Array.isArray(mySoldPayload) ? mySoldPayload : []);
        setLookups({
          companies: Array.isArray(lookupPayload.companies) ? lookupPayload.companies : [],
          materials: Array.isArray(lookupPayload.materials) ? lookupPayload.materials : [],
          thicknesses: Array.isArray(lookupPayload.thicknesses) ? lookupPayload.thicknesses : [],
          finishes: Array.isArray(lookupPayload.finishes) ? lookupPayload.finishes : [],
          colors: Array.isArray(lookupPayload.colors) ? lookupPayload.colors : [],
          stone_products: Array.isArray(lookupPayload.stone_products) ? lookupPayload.stone_products : [],
        });
        setSalesReps(Array.isArray(salesRepPayload) ? salesRepPayload : []);
        setNextStoneId(stonePayload?.nextStoneId ?? null);
        setAvailableMaterialOptions(materialOptionsFromRows(remnantRows));
      } catch (loadError) {
        if (!mounted) return;
        if (isAccessDeniedError(loadError.message)) {
          setAuthState("forbidden");
          return;
        }
        setError(loadError.message);
      }
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (authState !== "ready") return;

    if (remnantAbortRef.current) remnantAbortRef.current.abort();
    if (enrichmentRef.current) enrichmentRef.current.abort();

    const controller = new AbortController();
    remnantAbortRef.current = controller;

    async function loadRows() {
      try {
        setLoading(true);
        setError("");
        const params = buildSearchQuery(filters);
        params.set("enrich", "0");
        const rows = await apiFetch(`/api/remnants?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!Array.isArray(rows)) throw new Error("Unexpected remnant payload");
        setRemnants(rows.map((row) => ({ ...row, __detailsPending: rows.length > 0 })));
        setLoading(false);

        const ids = [...new Set(rows.map((row) => Number(internalRemnantId(row))).filter(Boolean))];
        if (!ids.length) return;

        const enrichmentController = new AbortController();
        enrichmentRef.current = enrichmentController;
        const enrichmentRows = await apiFetch("/api/remnants/enrichment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
          signal: enrichmentController.signal,
        });
        if (!Array.isArray(enrichmentRows)) return;
        const enrichmentMap = new Map(enrichmentRows.map((row) => [Number(row.remnant_id), row]));
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
    return () => controller.abort();
  }, [authState, filters]);

  useEffect(() => {
    const canvas = cropCanvasRef.current;
    const image = cropImageRef.current;
    if (!canvas || !image || !cropModal) return;
    renderCropCanvas(canvas, image, cropModal);
  }, [cropModal]);

  useEffect(() => {
    if (!matchedEditorStone) return;
    setEditorForm((current) => {
      if (!current) return current;
      const currentColors = Array.isArray(current.colors) ? current.colors : [];
      const nextColors = currentColors.length
        ? currentColors
        : Array.isArray(matchedEditorStone.colors) ? matchedEditorStone.colors : [];
      const nextBrandName = current.brand_name || matchedEditorStone.brand_name || "";
      const sameColors = JSON.stringify(currentColors) === JSON.stringify(nextColors);
      const sameBrand = String(current.brand_name || "") === String(nextBrandName || "");
      if (sameColors && sameBrand) return current;

      return {
        ...current,
        brand_name: nextBrandName,
        colors: nextColors,
      };
    });
  }, [matchedEditorStone]);

  async function reloadHoldRequests() {
    const requestsPayload = await apiFetch("/api/hold-requests?status=pending");
    setHoldRequests(Array.isArray(requestsPayload) ? requestsPayload : []);
  }

  useEffect(() => {
    if (authState !== "ready") return undefined;

    let active = true;

    async function syncHoldRequests() {
      if (document.visibilityState === "hidden") return;
      try {
        const requestsPayload = await apiFetch("/api/hold-requests?status=pending", { cache: "no-store" });
        if (!active) return;
        setHoldRequests(Array.isArray(requestsPayload) ? requestsPayload : []);
      } catch (_error) {
        // Keep background refresh quiet; explicit actions still surface errors.
      }
    }

    const intervalId = window.setInterval(syncHoldRequests, HOLD_REQUEST_REFRESH_MS);
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void syncHoldRequests();
      }
    };

    window.addEventListener("focus", handleVisible);
    document.addEventListener("visibilitychange", handleVisible);

    if (queueOpen) {
      void syncHoldRequests();
    }

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisible);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [authState, queueOpen]);

  async function reloadMyHolds() {
    const holdsPayload = await apiFetch("/api/my-holds");
    setMyHolds(Array.isArray(holdsPayload) ? holdsPayload : []);
  }

  async function reloadMySold() {
    const soldPayload = await apiFetch("/api/my-sold");
    setMySold(Array.isArray(soldPayload) ? soldPayload : []);
  }

  async function openMyHoldsPanel() {
    setQueueOpen(false);
    setMySoldOpen(false);
    setMyHoldsOpen(true);
    try {
      setMyHoldsLoading(true);
      await reloadMyHolds();
    } catch (loadError) {
      showErrorMessage(loadError.message);
    } finally {
      setMyHoldsLoading(false);
    }
  }

  async function openMySoldPanel() {
    setQueueOpen(false);
    setMyHoldsOpen(false);
    setMySoldOpen(true);
    try {
      setMySoldLoading(true);
      await reloadMySold();
    } catch (loadError) {
      showErrorMessage(loadError.message);
    } finally {
      setMySoldLoading(false);
    }
  }

  async function reloadAvailableMaterialOptions() {
    const rows = await apiFetch("/api/remnants?enrich=0");
    setAvailableMaterialOptions(materialOptionsFromRows(rows));
  }

  async function reloadNextStoneId() {
    if (!profile || !canManageStructure(profile)) return;
    const payload = await apiFetch("/api/next-stone-id");
    setNextStoneId(payload?.nextStoneId ?? null);
  }

  async function changeRemnantStatus(remnant, nextStatus) {
    if (!profile || !canManageRemnant(profile, remnant)) return;
    if (nextStatus === "sold") {
      openSoldEditor(remnant);
      return;
    }

    try {
      setWorkingRemnantId(String(remnant.id));
      clearMessage();

      const payload = { status: nextStatus };

      const updatedRow = await apiFetch(`/api/remnants/${remnant.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setRemnants((currentRows) =>
        currentRows.map((row) => (Number(row.id) === Number(remnant.id) ? { ...row, ...updatedRow } : row)),
      );
      await reloadHoldRequests();
      await reloadMyHolds();
      showSuccessMessage(`Remnant ${remnantToastLabel(remnant)} marked as ${statusToastText(nextStatus)}.`);
    } catch (actionError) {
      showErrorMessage(actionError.message);
    } finally {
      setWorkingRemnantId("");
    }
  }

  async function reviewHoldRequest(requestId, nextStatus) {
    try {
      setPendingReviewId(String(requestId));
      clearMessage();
      const jobNumber = normalizeJobNumberInput(holdRequestDrafts[requestId] || "");
      await apiFetch(`/api/hold-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          job_number: jobNumber,
        }),
      });
      await reloadHoldRequests();
      await reloadMyHolds();
      showSuccessMessage(nextStatus === "approved" ? "Hold request approved." : "Hold request denied.");
    } catch (actionError) {
      showErrorMessage(actionError.message);
    } finally {
      setPendingReviewId("");
    }
  }

  function openCreateEditor() {
    if (!profile || !canManageStructure(profile)) return;
    setEditorMode("create");
    setEditorForm({
      moraware_remnant_id: nextStoneId ?? "",
      name: "",
      brand_name: "",
      company_id: profile.system_role === "status_user" ? String(profile.company_id || "") : "",
      material_id: "",
      thickness_id: "",
      finish_id: "",
      price_per_sqft: "",
      colors: [],
      width: "",
      height: "",
      l_shape: false,
      l_width: "",
      l_height: "",
      image_preview: "",
      original_image_preview: "",
      image_file: null,
    });
    setEditorColorComposerOpen(false);
    setEditorColorDraft("");
    setEditorStoneMenuOpen(false);
    setEditorBrandMenuOpen(false);
    if (editorImageInputRef.current) editorImageInputRef.current.value = "";
  }

  function openEditEditor(remnant) {
    if (!profile || !canManageStructure(profile)) return;
    const fallbackColors = sharedStoneColorsForEditor(
      lookups.stone_products,
      remnant.material_id,
      remnant.name,
    );
    const remnantColors = Array.isArray(remnant.colors) ? remnant.colors : [];
    const colors = remnantColors.length ? remnantColors : fallbackColors;

    setEditorMode("edit");
    setEditorForm({
      id: remnant.id,
      moraware_remnant_id: remnant.moraware_remnant_id || "",
      name: remnant.name || "",
      brand_name: remnant.brand_name || "",
      company_id: String(remnant.company_id || ""),
      material_id: String(remnant.material_id || ""),
      thickness_id: String(remnant.thickness_id || ""),
      finish_id: String(remnant.finish_id || ""),
      price_per_sqft: remnant.price_per_sqft ?? "",
      colors,
      width: remnant.width || "",
      height: remnant.height || "",
      l_shape: Boolean(remnant.l_shape),
      l_width: remnant.l_width || "",
      l_height: remnant.l_height || "",
      image_preview: imageSrc(remnant),
      original_image_preview: imageSrc(remnant),
      image_file: null,
    });
    setEditorColorComposerOpen(false);
    setEditorColorDraft("");
    setEditorStoneMenuOpen(false);
    setEditorBrandMenuOpen(false);
    if (editorImageInputRef.current) editorImageInputRef.current.value = "";
  }

  function closeEditor() {
    setEditorMode("");
    setEditorForm(null);
    setEditorColorComposerOpen(false);
    setEditorColorDraft("");
    setEditorColorSaving(false);
    setEditorStoneMenuOpen(false);
    setEditorBrandMenuOpen(false);
    setCropModal(null);
    cropImageRef.current = null;
    if (editorImageInputRef.current) editorImageInputRef.current.value = "";
  }

  function updateEditorField(key, value) {
    setEditorForm((current) => {
      const next = {
        ...(current || {}),
        [key]: value,
        ...(key === "l_shape" && !value ? { l_width: "", l_height: "" } : {}),
      };

      if (key === "brand_name" && next.name) {
        next.name = stoneNameWithoutBrandPrefix(next.name, value);
      }

      return next;
    });
  }

  function toggleEditorColor(colorName) {
    setEditorForm((current) => {
      if (!current) return current;
      const currentValues = Array.isArray(current.colors) ? current.colors : [];
      const nextValues = colorListIncludes(currentValues, colorName)
        ? currentValues.filter((value) => normalizeStoneLookupName(value) !== normalizeStoneLookupName(colorName))
        : [...currentValues, colorName];

      return {
        ...current,
        colors: nextValues,
      };
    });
  }

  async function createEditorColor() {
    if (!editorForm) return;
    const requestedName = String(editorColorDraft || "").trim();
    if (!requestedName) {
      showErrorMessage("Enter a color name first.");
      return;
    }

    try {
      setEditorColorSaving(true);
      clearMessage();
      const createdColor = await apiFetch("/api/lookups/colors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: requestedName }),
      });

      const nextColor = createdColor?.name || String(requestedName || "").trim();
      if (!nextColor) return;

      setLookups((current) => {
        const currentRows = Array.isArray(current.colors) ? current.colors : [];
        const exists = currentRows.some((row) => normalizeStoneLookupName(row?.name) === normalizeStoneLookupName(nextColor));
        const nextRows = exists
          ? currentRows
          : [...currentRows, { id: createdColor?.id || `new-${nextColor}`, name: nextColor, active: true }];

        nextRows.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
        return {
          ...current,
          colors: nextRows,
        };
      });

      setEditorForm((current) => {
        if (!current) return current;
        const currentColors = Array.isArray(current.colors) ? current.colors : [];
        return colorListIncludes(currentColors, nextColor)
          ? current
          : { ...current, colors: [...currentColors, nextColor] };
      });

      setEditorColorDraft("");
      setEditorColorComposerOpen(false);
      showSuccessMessage(`Color ${nextColor} added.`);
    } catch (error) {
      showErrorMessage(error.message || "Unable to add color.");
    } finally {
      setEditorColorSaving(false);
    }
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (!editorForm) return;

    try {
      clearMessage();
      setError("");
      const payload = {
        moraware_remnant_id: editorForm.moraware_remnant_id,
        name: editorForm.name,
        brand_name: editorForm.brand_name,
        company_id: editorForm.company_id,
        material_id: editorForm.material_id,
        thickness_id: editorForm.thickness_id,
        finish_id: editorForm.finish_id,
        colors: editorForm.colors,
        price_per_sqft: editorForm.price_per_sqft,
        width: editorForm.width,
        height: editorForm.height,
        l_shape: Boolean(editorForm.l_shape),
        l_width: editorForm.l_shape ? editorForm.l_width : "",
        l_height: editorForm.l_shape ? editorForm.l_height : "",
        image_file: editorForm.image_file || undefined,
      };

      if (editorMode === "create") {
        await apiFetch("/api/remnants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await reloadNextStoneId();
        await reloadAvailableMaterialOptions();
        showSuccessMessage("Remnant created.");
      } else {
        await apiFetch(`/api/remnants/${editorForm.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await reloadAvailableMaterialOptions();
        showSuccessMessage("Remnant updated.");
      }

      closeEditor();
      await reloadHoldRequests();
      await reloadMyHolds();
      await reloadMySold();
      setFilters((current) => ({ ...current }));
      setLoading(true);
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  async function archiveEditorRemnant() {
    if (editorMode !== "edit" || !editorForm?.id) return;
    if (!window.confirm("Archive this remnant?")) return;

    try {
      await apiFetch(`/api/remnants/${editorForm.id}`, {
        method: "DELETE",
      });
      closeEditor();
      await reloadAvailableMaterialOptions();
      showSuccessMessage("Remnant archived.");
      await reloadHoldRequests();
      await reloadMyHolds();
      await reloadMySold();
      setFilters((current) => ({ ...current }));
      setLoading(true);
    } catch (archiveError) {
      setError(archiveError.message);
    }
  }

  function updateEditorImage(payload, previewUrl) {
    setEditorForm((current) => current ? ({
      ...current,
      image_file: payload,
      image_preview: previewUrl,
    }) : current);
  }

  async function handleEditorImageChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const payload = await fileToPayload(file);
      if (!payload) throw new Error("Unsupported image file");
      updateEditorImage(payload, payload.dataUrl);
      showSuccessMessage("Image loaded. You can crop it before saving.");
      setError("");
    } catch (imageError) {
      setError(imageError.message);
    }
  }

  async function openCropEditor() {
    const src = String(editorForm?.image_preview || "").trim();
    if (!src) {
      setError("Choose or load an image before cropping.");
      return;
    }

    try {
      const image = await loadImageElement(cropSourceUrl(src));
      cropImageRef.current = image;
      const fileName = editorForm?.image_file?.name
        || `${String(editorForm?.name || "remnant").trim().replace(/\s+/g, "-").toLowerCase() || "remnant"}.jpg`;
      const contentType = editorForm?.image_file?.type || "image/jpeg";
      const baseScale = Math.min(CROP_CANVAS_WIDTH / image.width, CROP_CANVAS_HEIGHT / image.height);

      setCropModal(normalizeCropDraft({
        prefix: editorMode || "edit",
        source: src,
        fileName,
        contentType,
        baseScale,
        scale: baseScale,
        offsetX: 0,
        offsetY: 0,
        rotationBase: 0,
        rotation: 0,
        cropRect: { ...DEFAULT_CROP_RECT },
      }, image));
      setError("");
    } catch (cropError) {
      setError(cropError.message);
    }
  }

  function closeCropEditor() {
    setCropModal(null);
    cropImageRef.current = null;
  }

  function updateCropModal(updater) {
    setCropModal((current) => {
      if (!current) return current;
      const next = typeof updater === "function" ? updater(current) : updater;
      return normalizeCropDraft(next, cropImageRef.current);
    });
  }

  function handleCropPointerDown(event) {
    const canvas = cropCanvasRef.current;
    if (!canvas || !cropModal || !cropImageRef.current) return;

    const point = canvasPointFromPointer(event, canvas);
    const handle = cropHandles(cropModal.cropRect).find((item) => (
      Math.abs(point.x - item.x) <= 12 && Math.abs(point.y - item.y) <= 12
    ));

    cropDragRef.current = {
      dragging: true,
      dragStartX: point.x,
      dragStartY: point.y,
      startOffsetX: cropModal.offsetX,
      startOffsetY: cropModal.offsetY,
      startCropRect: { ...cropModal.cropRect },
      dragMode: handle ? "resize" : pointInCropRect(point, cropModal.cropRect) ? "move-crop" : "move-image",
      activeHandle: handle?.key || null,
    };

    canvas.setPointerCapture?.(event.pointerId);
  }

  function handleCropPointerMove(event) {
    const canvas = cropCanvasRef.current;
    const dragState = cropDragRef.current;
    if (!canvas || !cropModal || !dragState.dragging) return;

    const point = canvasPointFromPointer(event, canvas);
    const dx = point.x - dragState.dragStartX;
    const dy = point.y - dragState.dragStartY;

    updateCropModal((current) => {
      if (dragState.dragMode === "move-image") {
        return {
          ...current,
          offsetX: dragState.startOffsetX + dx,
          offsetY: dragState.startOffsetY + dy,
        };
      }

      if (dragState.dragMode === "move-crop") {
        return {
          ...current,
          cropRect: {
            ...current.cropRect,
            x: dragState.startCropRect.x + dx,
            y: dragState.startCropRect.y + dy,
          },
        };
      }

      if (dragState.dragMode === "resize") {
        const rect = { ...dragState.startCropRect };
        if (dragState.activeHandle?.includes("n")) {
          rect.y = dragState.startCropRect.y + dy;
          rect.height = dragState.startCropRect.height - dy;
        }
        if (dragState.activeHandle?.includes("s")) {
          rect.height = dragState.startCropRect.height + dy;
        }
        if (dragState.activeHandle?.includes("w")) {
          rect.x = dragState.startCropRect.x + dx;
          rect.width = dragState.startCropRect.width - dx;
        }
        if (dragState.activeHandle?.includes("e")) {
          rect.width = dragState.startCropRect.width + dx;
        }
        return {
          ...current,
          cropRect: rect,
        };
      }

      return current;
    });
  }

  function endCropPointerDrag(event) {
    const canvas = cropCanvasRef.current;
    if (canvas && typeof event?.pointerId === "number") {
      canvas.releasePointerCapture?.(event.pointerId);
    }
    cropDragRef.current = {
      dragging: false,
      dragStartX: 0,
      dragStartY: 0,
      startOffsetX: 0,
      startOffsetY: 0,
      startCropRect: DEFAULT_CROP_RECT,
      dragMode: null,
      activeHandle: null,
    };
  }

  async function saveCropEditor() {
    const image = cropImageRef.current;
    if (!cropModal || !image) return;

    const geometry = cropGeometry(cropModal, image);
    if (!geometry) return;

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = CROP_CANVAS_WIDTH;
    sourceCanvas.height = CROP_CANVAS_HEIGHT;
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) {
      setError("Failed to prepare crop canvas.");
      return;
    }

    sourceContext.fillStyle = "#efe4d8";
    sourceContext.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    const centerX = geometry.drawX + geometry.drawWidth / 2;
    const centerY = geometry.drawY + geometry.drawHeight / 2;
    sourceContext.save();
    sourceContext.translate(centerX, centerY);
    sourceContext.rotate(((cropModal.rotationBase + cropModal.rotation) * Math.PI) / 180);
    sourceContext.drawImage(image, -geometry.drawWidth / 2, -geometry.drawHeight / 2, geometry.drawWidth, geometry.drawHeight);
    sourceContext.restore();

    const rect = cropModal.cropRect;
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = Math.max(1, Math.round(rect.width));
    outputCanvas.height = Math.max(1, Math.round(rect.height));
    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) {
      setError("Failed to prepare output image.");
      return;
    }

    outputContext.drawImage(
      sourceCanvas,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      outputCanvas.width,
      outputCanvas.height,
    );

    const outputType = preferredCropType(cropModal.contentType);
    const dataUrl = outputCanvas.toDataURL(outputType, 0.92);
    const payload = imagePayloadFromDataUrl(dataUrl, cropModal.fileName, outputType);
    updateEditorImage(payload, dataUrl);
    closeCropEditor();
    showSuccessMessage("Cropped image ready to save.");
  }

  function openHoldEditor(remnant) {
    const hold = remnant.current_hold || null;
    const isSelfOnly = profile?.system_role === "status_user";
    const currentOwnerUserId = hold?.hold_owner_user_id || null;
    const lockedToOtherOwner = Boolean(
      isSelfOnly &&
      currentOwnerUserId &&
      String(currentOwnerUserId) !== String(profile?.id || ""),
    );
    setHoldEditor({
      remnant,
      remnantId: remnant.id,
      remnantLabel: remnantToastLabel(remnant),
      holdId: hold?.id || null,
      owner_user_id: isSelfOnly ? profile?.id || "" : hold?.hold_owner_user_id || profile?.id || "",
      current_owner_user_id: currentOwnerUserId,
      current_owner_name: hold?.owner_name || hold?.owner_email || "",
      self_only: isSelfOnly,
      locked_to_other_owner: lockedToOtherOwner,
      customer_name: hold?.customer_name || "",
      expires_at: hold?.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      job_number: normalizeJobNumberInput(hold?.job_number || ""),
      notes: hold?.notes || "",
      summary: hold
        ? `${hold.status === "active" ? "Active" : "Expired"} hold${hold.customer_name ? ` for ${hold.customer_name}` : ""}${hold.job_number ? ` · ${formatJobNumber(hold.job_number, remnant)}` : ""}${hold.expires_at ? ` · Expires ${formatDateLabel(hold.expires_at)}` : ""}`
        : "No hold is linked to this remnant yet.",
    });
  }

  function closeHoldEditor() {
    setHoldEditor(null);
  }

  function updateHoldField(key, value) {
    setHoldEditor((current) => ({ ...(current || {}), [key]: value }));
  }

  function openSoldEditor(remnant) {
    const sale = remnant.current_sale || null;
    clearMessage();
    setSoldEditor({
      remnant,
      remnantId: remnant.id,
      remnantLabel: remnantToastLabel(remnant),
      sold_by_user_id: isStatusUser ? profile?.id || "" : sale?.sold_by_user_id || "",
      job_number: normalizeJobNumberInput(sale?.job_number || remnant?.sold_job_number || ""),
      notes: sale?.notes || "",
      self_only: isStatusUser,
    });
  }

  function closeSoldEditor() {
    setSoldEditor(null);
  }

  function sellFromHoldEditor() {
    if (!holdEditor?.remnant) return;
    const nextRemnant = holdEditor.remnant;
    closeHoldEditor();
    openSoldEditor(nextRemnant);
  }

  function updateSoldField(key, value) {
    setSoldEditor((current) => ({ ...(current || {}), [key]: value }));
  }

  async function saveHoldEditor(event) {
    event.preventDefault();
    if (!holdEditor) return;
    if (holdEditor.locked_to_other_owner) {
      setError("Only the original sales rep or a manager can change this hold.");
      return;
    }

    try {
      await apiFetch(`/api/remnants/${holdEditor.remnantId}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hold_owner_user_id: holdEditor.self_only ? profile?.id || "" : holdEditor.owner_user_id,
          expires_at: holdEditor.expires_at,
          customer_name: holdEditor.customer_name,
          job_number: normalizeJobNumberInput(holdEditor.job_number),
          notes: holdEditor.notes,
        }),
      });
      closeHoldEditor();
      showSuccessMessage(`Remnant ${holdEditor.remnantLabel} marked as on hold.`);
      await reloadHoldRequests();
      await reloadMyHolds();
      await reloadMySold();
      setFilters((current) => ({ ...current }));
      setLoading(true);
    } catch (holdError) {
      setError(holdError.message);
    }
  }

  async function saveSoldEditor(event) {
    event.preventDefault();
    if (!soldEditor) return;

    try {
      setWorkingRemnantId(String(soldEditor.remnantId));
      clearMessage();
      const updatedRow = await apiFetch(`/api/remnants/${soldEditor.remnantId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "sold",
          sold_by_user_id: soldEditor.self_only ? profile?.id || "" : soldEditor.sold_by_user_id,
          sold_job_number: normalizeJobNumberInput(soldEditor.job_number),
          sold_notes: soldEditor.notes,
        }),
      });

      setRemnants((currentRows) =>
        currentRows.map((row) =>
          Number(row.id) === Number(soldEditor.remnantId) ? { ...row, ...updatedRow } : row,
        ),
      );
      closeSoldEditor();
      await reloadHoldRequests();
      await reloadMyHolds();
      await reloadMySold();
      showSuccessMessage(`Remnant ${soldEditor.remnantLabel} marked as sold.`);
    } catch (soldError) {
      showErrorMessage(soldError.message);
    } finally {
      setWorkingRemnantId("");
    }
  }

  async function releaseHoldEditor() {
    if (!holdEditor?.holdId) return;
    if (holdEditor.locked_to_other_owner) {
      setError("Only the original sales rep or a manager can release this hold.");
      return;
    }
    try {
      await apiFetch(`/api/holds/${holdEditor.holdId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      closeHoldEditor();
      showSuccessMessage(`Remnant ${holdEditor.remnantLabel} released from hold.`);
      await reloadHoldRequests();
      await reloadMyHolds();
      await reloadMySold();
      setFilters((current) => ({ ...current }));
      setLoading(true);
    } catch (releaseError) {
      setError(releaseError.message);
    }
  }

  if (authState === "loading") {
    return <main className="min-h-screen bg-[#edf1f6] px-6 py-10 text-[#172230]">Loading workspace...</main>;
  }

  if (authState === "forbidden") {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#0f1727_0%,#203454_38%,#edf1f6_38%,#edf1f6_100%)] px-6 py-10 text-[#172230]">
        <div className="mx-auto max-w-3xl rounded-[32px] border border-white/15 bg-white/95 p-8 shadow-[0_28px_90px_rgba(8,15,32,0.18)]">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#5b6f87]">Access Required</p>
          <h1 className="mt-3 text-3xl font-semibold text-[#172230]">This private workspace needs an active management login.</h1>
          <p className="mt-3 text-sm leading-7 text-[#5f6c7b]">
            Sign in first, then come back here to continue in the private workspace.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/portal" className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#152238] px-5 text-sm font-semibold text-white transition hover:bg-[#f08b49]">
              Open Login
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,var(--brand-white)_52%,rgba(247,134,57,0.08)_100%)] text-[var(--brand-ink)]">
      <div className="mx-auto w-full max-w-[1800px] px-3 py-5 sm:px-4 md:px-6 2xl:px-8">
        <section className="mb-4 overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-[linear-gradient(135deg,rgba(255,255,255,0.99),rgba(242,242,242,0.96))] px-6 py-5 text-[var(--brand-ink)] shadow-[0_28px_90px_rgba(25,27,28,0.10)]">
          <div className={`grid gap-5 lg:items-start ${isStatusUser ? "xl:grid-cols-[minmax(0,1fr)_520px]" : "xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,640px)]"}`}>
            <div className={`${isStatusUser ? "max-w-3xl" : "max-w-4xl"}`}>
              <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-orange)]">Management Workspace</p>
              <h1 className={`font-display mt-3 font-semibold leading-tight text-[var(--brand-ink)] ${isStatusUser ? "max-w-2xl text-[1.7rem] md:text-[2.05rem]" : "max-w-3xl text-[1.9rem] md:text-[2.35rem]"}`}>
                {workspaceCopy.title}
              </h1>
              <p className={`mt-2 text-sm text-[rgba(35,35,35,0.72)] ${isStatusUser ? "max-w-2xl leading-5.5" : "max-w-3xl leading-6"}`}>
                {workspaceCopy.description}
              </p>
            </div>

            <div className={`rounded-[22px] border border-[var(--brand-line)] bg-white p-3.5 shadow-[0_16px_38px_rgba(25,27,28,0.06)] backdrop-blur ${isStatusUser ? "" : "ml-auto w-fit min-w-[420px] max-w-full"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-[var(--brand-ink)]">
                    {[
                      profileCompanyName,
                      profile?.full_name || profile?.email || "User",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </h2>
                </div>
                <form method="POST" action="/api/auth/logout" className="shrink-0">
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-3.5 text-center text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)]"
                  >
                    Log Out
                  </button>
                </form>
              </div>
              <div className={`mt-3.5 gap-2.5 ${isStatusUser ? "flex items-center" : "flex flex-wrap items-center"}`}>
                <button
                  type="button"
                  onClick={() => {
                    setMySoldOpen(false);
                    setMyHoldsOpen(false);
                    setQueueOpen(true);
                  }}
                  className={`inline-flex h-10 items-center justify-between gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)] ${
                    isStatusUser ? "min-w-0 flex-1" : "min-w-[118px]"
                  }`}
                >
                  <span className="whitespace-nowrap">Requests</span>
                  <span className="inline-flex min-w-7 shrink-0 items-center justify-center rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(244,63,94,0.32)]">
                    {holdRequests.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openMyHoldsPanel}
                  className={`inline-flex h-10 items-center justify-between gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)] ${
                    isStatusUser ? "min-w-0 flex-1" : "min-w-[118px]"
                  }`}
                >
                  <span className="whitespace-nowrap">Holds</span>
                  <span className="inline-flex min-w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-[#3d2918] shadow-[0_8px_18px_rgba(251,191,36,0.28)]">
                    {myHolds.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openMySoldPanel}
                  className={`inline-flex h-10 items-center justify-between gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)] ${
                    isStatusUser ? "min-w-0 flex-1" : "min-w-[118px]"
                  }`}
                >
                  <span className="whitespace-nowrap">Sold</span>
                  <span className="inline-flex min-w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(247,134,57,0.14)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-orange-deep)]">
                    {mySold.length}
                  </span>
                </button>
                {profile?.system_role === "super_admin" ? (
                  <>
                    <Link
                      href="/admin"
                      className={`inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)] ${
                        isStatusUser ? "shrink-0 px-3.5" : ""
                      }`}
                    >
                      Admin
                    </Link>
                    <Link
                      href="/slabs"
                      className={`inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)] ${
                        isStatusUser ? "shrink-0 px-3.5" : ""
                      }`}
                    >
                      Slabs
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          </div>

        </section>

        <div className="space-y-4">
          <section className="space-y-4">
            <div className="rounded-[30px] border border-[var(--brand-line)] bg-white/94 p-4 shadow-[0_24px_70px_rgba(25,27,28,0.08)] backdrop-blur">
              <div className={filterGridClass}>
                <div className="min-w-0 sm:col-span-2 2xl:col-span-1 2xl:max-w-[29rem]">
                  <p className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                    Material Types
                  </p>
                  <div className="flex h-12 w-full max-w-full snap-x snap-mandatory items-center gap-2 overflow-x-auto whitespace-nowrap rounded-2xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm text-[var(--brand-ink)] shadow-sm [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
                    {materialFilterOptions.map((material) => {
                      const checked = filters.materials.includes(material);
                      return (
                        <button
                          key={material}
                          type="button"
                          aria-pressed={checked}
                          onClick={() =>
                            setFilters((current) => ({
                              ...current,
                              materials: checked
                                ? current.materials.filter((value) => value !== material)
                                : [...current.materials, material],
                            }))
                          }
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

                <label className="block min-w-0 sm:col-span-2 2xl:col-span-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                  Stone / Brand / Color / Finish / ID #
                  <div className="relative mt-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-orange)]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="6.5" />
                      <path d="M16 16l4 4" />
                    </svg>
                    <input
                      type="text"
                      value={filters.stone}
                      onChange={(event) => setFilters((current) => ({ ...current, stone: event.target.value }))}
                      placeholder="Stone, brand, color, finish or #741"
                      className="h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white pl-10 pr-4 text-sm font-medium text-[var(--brand-ink)] placeholder:text-[rgba(25,27,28,0.45)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                    />
                  </div>
                </label>

                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                  Min Width
                  <input
                    type="text"
                    inputMode="decimal"
                    value={filters.minWidth}
                    onChange={(event) => setFilters((current) => ({ ...current, minWidth: event.target.value }))}
                    placeholder="W"
                    className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-3 text-sm font-medium text-[var(--brand-ink)] placeholder:text-[rgba(25,27,28,0.45)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
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
                    className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-3 text-sm font-medium text-[var(--brand-ink)] placeholder:text-[rgba(25,27,28,0.45)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
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

                {canStructure ? (
                  <div className="flex items-end justify-start sm:col-span-2 2xl:col-span-1 2xl:justify-center">
                    <div className="flex w-12 flex-col items-center">
                      <p className="mb-2 hidden w-full text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)] lg:block">
                        Add
                      </p>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={openCreateEditor}
                          className="peer inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-ink)] text-white shadow-[0_14px_30px_rgba(25,27,28,0.18)] transition-all hover:-translate-y-0.5 hover:bg-[var(--brand-orange)]"
                          aria-label="Add remnant"
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            className="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 5v14" />
                            <path d="M5 12h14" />
                          </svg>
                        </button>
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-[#2c211c]/92 px-3 py-2 text-[11px] font-semibold text-white opacity-0 shadow-lg backdrop-blur-sm transition-all peer-hover:opacity-100 peer-focus-visible:opacity-100 xl:inline-flex">
                          Add remnant
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {loading ? (
              <div className={boardGridClass}>
                {Array.from({ length: 6 }).map((_, index) => (
                  <PrivateWorkspaceSkeletonCard key={index} showActions={isStatusUser} />
                ))}
              </div>
            ) : error ? (
              <div className="rounded-[28px] border border-rose-200 bg-white/90 px-6 py-10 text-center text-rose-700 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-500">Load Failed</p>
                <h3 className="mt-2 text-xl font-semibold text-rose-800">We couldn&apos;t load the workspace right now.</h3>
                <p className="mt-2 text-sm">{error}</p>
              </div>
            ) : (
              <div className={boardGridClass}>
                {remnants.map((remnant) => {
                  const status = statusText(remnant);
                  const normalizedStatus = normalizeRemnantStatus(remnant);
                  const statusBadge = statusBadgeText(remnant);
                  const canManage = canManageRemnant(profile, remnant);
                  const isWorking = workingRemnantId === String(remnant.id);
                  const statusLockedForSalesRep =
                    isStatusUser &&
                    (normalizedStatus === "hold" || normalizedStatus === "sold") &&
                    !statusOwnedByProfile(profile, remnant);
                  const showStatusActions = canManage && !statusLockedForSalesRep;
                  const showAvailableAction = showStatusActions && normalizedStatus !== "available";
                  const showSoldAction = showStatusActions && normalizedStatus !== "sold";
                  const showHoldAction = showStatusActions && normalizedStatus !== "hold";
                  const showEditAction = showStatusActions && canStructure;
                  const leftAction =
                    normalizedStatus === "hold" || normalizedStatus === "sold"
                      ? showAvailableAction
                        ? {
                            key: "available",
                            label: isWorking ? "Working..." : "Available",
                            title: "Make available",
                            onClick: () => changeRemnantStatus(remnant, "available"),
                            disabled: isWorking,
                            className:
                              "border-emerald-300 bg-emerald-100 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-200",
                            icon: (
                              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m5 12 4.2 4.2L19 6.5" />
                              </svg>
                            ),
                          }
                        : null
                      : showHoldAction
                        ? {
                            key: "hold",
                            label: "Hold",
                            title: "Place on hold",
                            onClick: () => openHoldEditor(remnant),
                            disabled: false,
                            className:
                              "border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-400 hover:bg-amber-200",
                            icon: (
                              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10.9 4.75H6.75A2 2 0 0 0 4.75 6.75v4.15l7.34 7.35a1.8 1.8 0 0 0 2.55 0l3.62-3.62a1.8 1.8 0 0 0 0-2.55L10.9 4.75Z" />
                                <circle cx="7.75" cy="7.75" r="1.05" />
                              </svg>
                            ),
                          }
                        : null;
                  const rightAction =
                    normalizedStatus === "sold"
                      ? showHoldAction
                        ? {
                            key: "hold",
                            label: "Hold",
                            title: "Place on hold",
                            onClick: () => openHoldEditor(remnant),
                            disabled: false,
                            className:
                              "border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-400 hover:bg-amber-200",
                            icon: (
                              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10.9 4.75H6.75A2 2 0 0 0 4.75 6.75v4.15l7.34 7.35a1.8 1.8 0 0 0 2.55 0l3.62-3.62a1.8 1.8 0 0 0 0-2.55L10.9 4.75Z" />
                                <circle cx="7.75" cy="7.75" r="1.05" />
                              </svg>
                            ),
                          }
                        : null
                      : showSoldAction
                        ? {
                            key: "sold",
                            label: isWorking ? "Working..." : "Sell",
                            title: "Mark sold",
                            onClick: () => changeRemnantStatus(remnant, "sold"),
                            disabled: isWorking,
                            className:
                              "border-rose-300 bg-rose-100 text-rose-800 hover:border-rose-400 hover:bg-rose-200",
                            icon: (
                              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 3v18" />
                                <path d="M16.5 7.5c0-1.66-2.01-3-4.5-3S7.5 5.84 7.5 7.5 9.51 10.5 12 10.5s4.5 1.34 4.5 3-2.01 3-4.5 3-4.5-1.34-4.5-3" />
                              </svg>
                            ),
                          }
                        : null;
                  const actionButtonBaseClass =
                    "inline-flex h-11 items-center justify-center rounded-[18px] border px-3 text-[11px] font-semibold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50";
                  const availableActionClass = `${actionButtonBaseClass} border-emerald-300 bg-emerald-100 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-200`;
                  const holdActionClass = `${actionButtonBaseClass} border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-400 hover:bg-amber-200`;
                  const soldActionClass = `${actionButtonBaseClass} border-rose-300 bg-rose-100 text-rose-800 hover:border-rose-400 hover:bg-rose-200`;
                  const centerEditAction = showEditAction
                    ? {
                        label: "Edit",
                        title: "Edit remnant",
                        onClick: () => openEditEditor(remnant),
                        className: "border-slate-300 bg-slate-100 text-slate-800 hover:border-slate-400 hover:bg-slate-200",
                        icon: (
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.36 3.89h3.28l.47 1.88a6.8 6.8 0 0 1 1.51.63l1.7-.93 2.32 2.32-.93 1.7c.26.48.47.98.63 1.5l1.88.48v3.28l-1.88.47a6.8 6.8 0 0 1-.63 1.51l.93 1.7-2.32 2.32-1.7-.93a6.8 6.8 0 0 1-1.5.63l-.48 1.88h-3.28l-.47-1.88a6.8 6.8 0 0 1-1.51-.63l-1.7.93-2.32-2.32.93-1.7a6.8 6.8 0 0 1-.63-1.5l-1.88-.48v-3.28l1.88-.47c.16-.52.37-1.02.63-1.51l-.93-1.7 2.32-2.32 1.7.93c.48-.26.98-.47 1.5-.63z" />
                            <circle cx="12" cy="12" r="2.85" />
                          </svg>
                        ),
                      }
                    : null;
                  return (
                    <article
                      key={String(remnant.id)}
                      className="group relative overflow-hidden rounded-[24px] border border-[var(--brand-line)] bg-[rgba(255,255,255,0.96)] shadow-[0_14px_30px_rgba(25,27,28,0.08)] transition-transform [contain-intrinsic-size:420px] [content-visibility:auto] hover:-translate-y-1 sm:rounded-[26px]"
                    >
                      <div className="relative">
                        <div className="overflow-hidden">
                          <div className="relative aspect-[4/3] overflow-hidden bg-[linear-gradient(180deg,var(--brand-white)_0%,rgba(255,255,255,0.94)_100%)]">
                            {imageSrc(remnant) ? (
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
                                className={`inline-flex max-w-[72%] items-center justify-end rounded-full px-2.5 py-1 text-[10px] font-semibold leading-tight tracking-[0.02em] shadow-sm backdrop-blur ${statusBadgeClass(normalizedStatus)}`}
                              >
                                {statusBadge}
                              </span>
                            </div>
                            {imageSrc(remnant) ? (
                              <div className="pointer-events-none flex h-full w-full items-center justify-center overflow-hidden p-1.5 sm:p-2">
                                <img
                                  src={imageSrc(remnant)}
                                  alt={`Remnant ${displayRemnantId(remnant)}`}
                                  className="h-full w-full scale-[1.05] object-contain object-center transition-transform duration-300 motion-safe:md:group-hover:scale-[1.08]"
                                  decoding="async"
                                />
                              </div>
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-[var(--brand-white)] text-sm font-semibold uppercase tracking-[0.16em] text-[var(--brand-orange)]">
                                No Image
                              </div>
                            )}
                            {leftAction ? (
                              <div className="absolute bottom-0 left-0 z-[3] p-3">
                                <button
                                  type="button"
                                  disabled={leftAction.disabled}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    leftAction.onClick();
                                  }}
                                  className={`group/private-action inline-flex h-10 items-center justify-center gap-0 overflow-hidden rounded-2xl px-2.5 pr-2.5 text-[11px] font-medium shadow-[0_12px_30px_rgba(25,27,28,0.18)] backdrop-blur transition-all hover:-translate-y-0.5 hover:gap-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${leftAction.className}`}
                                  aria-label={leftAction.label}
                                  title={leftAction.title}
                                >
                                  {leftAction.icon}
                                  <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover/private-action:max-w-[8rem] group-hover/private-action:opacity-100">
                                    {leftAction.label}
                                  </span>
                                </button>
                              </div>
                            ) : null}
                            {rightAction ? (
                              <div className="absolute bottom-0 right-0 z-[3] p-3">
                                <button
                                  type="button"
                                  disabled={rightAction.disabled}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    rightAction.onClick();
                                  }}
                                  className={`group/private-action inline-flex h-10 items-center justify-end gap-0 overflow-hidden rounded-2xl px-2.5 pr-2.5 text-[11px] font-medium shadow-[0_12px_30px_rgba(25,27,28,0.18)] backdrop-blur transition-all hover:-translate-y-0.5 hover:gap-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${rightAction.className}`}
                                  aria-label={rightAction.label}
                                  title={rightAction.title}
                                >
                                  <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover/private-action:max-w-[8rem] group-hover/private-action:opacity-100">
                                    {rightAction.label}
                                  </span>
                                  {rightAction.icon}
                                </button>
                              </div>
                            ) : null}
                            {centerEditAction ? (
                              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] flex justify-center p-3">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    centerEditAction.onClick();
                                  }}
                                  className={`pointer-events-auto group/private-action inline-flex h-10 items-center justify-center gap-0 overflow-hidden rounded-2xl px-2.5 text-[11px] font-medium shadow-[0_12px_30px_rgba(25,27,28,0.18)] backdrop-blur transition-all hover:-translate-y-0.5 hover:gap-2 active:scale-[0.99] ${centerEditAction.className}`}
                                  aria-label={centerEditAction.label}
                                  title={centerEditAction.title}
                                >
                                  {centerEditAction.icon}
                                  <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover/private-action:max-w-[7rem] group-hover/private-action:opacity-100">
                                    {centerEditAction.label}
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
                            <h3 className="font-display text-[16px] font-semibold leading-snug text-[var(--brand-ink)] sm:text-[17px]">
                              {privateCardHeading(remnant)}
                            </h3>
                            {privateCardSubheading(remnant) ? (
                              <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgba(35,35,35,0.54)]">
                                {privateCardSubheading(remnant)}
                              </p>
                            ) : null}
                          </div>
                          <div className={`mt-3 grid items-stretch gap-2 ${privateCardMetricEntries(remnant).length >= 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                            {privateCardMetricEntries(remnant).map((entry, index) => (
                              <div
                                key={`${remnant.id}-${entry.label}`}
                                className="flex min-w-0 flex-col rounded-[16px] border border-[var(--brand-line)] bg-white/88 px-3 py-2"
                              >
                                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-orange)] sm:text-[11px]" title={entry.title}>
                                  {entry.label}
                                </p>
                                <p className="mt-1 text-[12px] font-semibold leading-tight text-[var(--brand-ink)] sm:text-[13px]">
                                  {entry.value}
                                </p>
                              </div>
                            ))}
                          </div>
                          {remnantColors(remnant).length ? (
                            <div className="mt-3 flex flex-wrap justify-center gap-2">
                              {remnantColors(remnant).map((color) => (
                                <span
                                  key={`${remnant.id}-${color}`}
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
          </section>
        </div>
      </div>

      <footer className="px-4 pb-10 pt-2 md:px-6">
        <div className="mx-auto max-w-[1800px] rounded-[24px] border border-[var(--brand-line)] bg-white/80 px-4 py-5 text-center shadow-sm backdrop-blur sm:rounded-[28px] sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">Internal Workspace</p>
          <p className="mt-2 text-sm text-[rgba(25,27,28,0.72)]">Built to keep remnant inventory, hold review, and status updates clear for the team.</p>
        </div>
      </footer>

      {selectedImageRemnant ? (
        <div
          className="fixed inset-0 z-[73] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_24%),linear-gradient(180deg,rgba(12,12,12,0.86),rgba(8,8,8,0.92))] px-3 py-4 sm:px-4 sm:py-6"
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
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusBadgeClass(normalizeRemnantStatus(selectedImageRemnant))}`}>
                        {statusBadgeText(selectedImageRemnant)}
                      </span>
                    </div>
                    <h2 className="font-display mt-3 text-xl font-semibold text-white sm:text-[2rem]">
                      {privateCardHeading(selectedImageRemnant)}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/68">
                      {privateCardSubheading(selectedImageRemnant) ? (
                        <span>{privateCardSubheading(selectedImageRemnant)}</span>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {privateCardMetricEntries(selectedImageRemnant).map((entry) => (
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

      {queueOpen ? (
        <div className="fixed inset-0 z-[71] overflow-y-auto bg-black/50 px-4 py-8">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-white shadow-[0_24px_70px_rgba(35,35,35,0.14)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">Queue</p>
                  <span className="inline-flex items-center rounded-full border border-[var(--brand-line)] bg-[var(--brand-white)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-ink)]">
                    {holdRequests.length} Pending
                  </span>
                </div>
                <h2 className="font-display mt-1 text-2xl font-semibold text-[var(--brand-ink)]">{workspaceCopy.queueTitle}</h2>
                <p className="mt-2 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">{workspaceCopy.queueDescription}</p>
              </div>
              <button
                type="button"
                onClick={() => setQueueOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                aria-label="Close request queue"
              >
                {"\u00D7"}
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-6">
              {holdRequests.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-[var(--brand-line)] bg-[var(--brand-white)] px-5 py-10 text-center text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">No Requests</p>
                  <p className="mt-2 text-sm">There are no hold requests to review right now.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {holdRequests.map((request) => {
                    const isPending = pendingReviewId === String(request.id);
                    const requestRemnant = request.remnant || {};
                    const requestMaterial = requestRemnant.material?.name || requestRemnant.material_name || "Unknown";
                    const requestStoneName = String(requestRemnant.name || "").trim() || "Unnamed";
                    const requestMessage = String(request.notes || "").trim();
                    const requestDisplayId =
                      requestRemnant.display_id || requestRemnant.moraware_remnant_id || requestRemnant.id || request.remnant_id;
                    return (
                      <article key={request.id} className={`rounded-[26px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 shadow-sm ${isPending ? "opacity-60 saturate-75" : ""}`}>
                        <div className="min-w-0">
                          <PrivateRemnantSummaryBlock
                            remnant={requestRemnant}
                            className=""
                            onOpenImage={() => imageSrc(requestRemnant) && openImageViewer(requestRemnant)}
                          />

                          <div className="mt-4 rounded-[24px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 shadow-[0_10px_24px_rgba(25,27,28,0.04)]">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Client Details</p>
                                <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
                                  Review who sent the request before you approve it.
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Client Name</p>
                                <p className="mt-2 break-words text-sm font-medium text-[var(--brand-ink)]">
                                  {request.requester_name || "Unknown"}
                                </p>
                              </div>
                              <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Client Email</p>
                                <p className="mt-2 break-all text-sm font-medium text-[var(--brand-ink)]">
                                  {request.requester_email || "Unknown"}
                                </p>
                              </div>
                            </div>

                            <div className="mt-3 rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Client Message</p>
                              <p className="mt-2 text-sm leading-6 text-[color:color-mix(in_srgb,var(--brand-ink)_80%,white)]">
                                {requestMessage || "No message provided."}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 rounded-[24px] border border-[var(--brand-line)] bg-white p-4 shadow-[0_10px_24px_rgba(25,27,28,0.04)]">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Review Action</p>
                                <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
                                  Add the job number, then approve or deny the request.
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_170px_170px] lg:items-end">
                              <label className="block text-sm font-medium text-[color:color-mix(in_srgb,var(--brand-ink)_82%,white)]">
                                Job Number
                                <div className="mt-1 flex overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white shadow-sm">
                                  <span className="inline-flex items-center border-r border-[var(--brand-line)] bg-[var(--brand-white)] px-4 text-sm font-semibold text-[var(--brand-orange)]">
                                    {jobNumberPrefixForRemnant(requestRemnant)}
                                  </span>
                                  <input
                                    type="text"
                                    value={normalizeJobNumberInput(holdRequestDrafts[request.id] ?? request.job_number ?? "")}
                                    onChange={(event) =>
                                      setHoldRequestDrafts((current) => ({
                                        ...current,
                                        [request.id]: normalizeJobNumberInput(event.target.value),
                                      }))
                                    }
                                    placeholder="1234"
                                    className="min-w-0 flex-1 bg-white px-4 py-3 text-sm text-[var(--brand-ink)] outline-none"
                                  />
                                </div>
                              </label>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => reviewHoldRequest(request.id, "approved")}
                                className="inline-flex h-12 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-100 px-5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-60"
                              >
                                {isPending ? "Working..." : "Approve"}
                              </button>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => reviewHoldRequest(request.id, "rejected")}
                                className="inline-flex h-12 items-center justify-center rounded-2xl border border-rose-200 bg-rose-100 px-5 text-sm font-semibold text-rose-800 transition hover:bg-rose-200 disabled:cursor-wait disabled:opacity-60"
                              >
                                {isPending ? "Working..." : "Deny"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {myHoldsOpen ? (
        <div className="fixed inset-0 z-[71] overflow-y-auto bg-black/50 px-4 py-8">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-white shadow-[0_24px_70px_rgba(35,35,35,0.14)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">Holds</p>
                  <span className="inline-flex items-center rounded-full border border-[var(--brand-line)] bg-[var(--brand-white)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-ink)]">
                    {myHolds.length} Active
                  </span>
                </div>
                <h2 className="font-display mt-1 text-2xl font-semibold text-[var(--brand-ink)]">Holds</h2>
                <p className="mt-2 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
                  View the stones currently under your hold, when they expire, and the original requester details.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMyHoldsOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                aria-label="Close my holds"
              >
                {"\u00D7"}
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-6">
              {myHoldsLoading ? (
                <div className="rounded-[24px] border border-dashed border-[var(--brand-line)] bg-[var(--brand-white)] px-5 py-10 text-center text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Loading</p>
                  <p className="mt-2 text-sm">Refreshing your active holds.</p>
                </div>
              ) : myHolds.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-[var(--brand-line)] bg-[var(--brand-white)] px-5 py-10 text-center text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">No Holds</p>
                  <p className="mt-2 text-sm">You do not have any active holds right now.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {myHolds.map((hold) => {
                    const holdRemnant = hold.remnant || {};
                    const holdMaterial = holdRemnant.material_name || holdRemnant.material?.name || "Unknown";
                    const holdStoneName = String(holdRemnant.name || "").trim() || "Unnamed";
                    const requesterName = hold.customer_name || hold.requester_name || "Customer name unavailable";
                    const requesterEmail = hold.requester_email || "Not provided";
                    const requesterMessage = hold.requester_message || hold.notes || "No message provided.";
                    const holdStatus = String(hold.status || "active").trim().toLowerCase();
                    const remnantStatus = normalizeRemnantStatus(holdRemnant);
                    const isWorking = workingRemnantId === String(holdRemnant.id || hold.remnant_id || hold.id);
                    const holdStatusClass =
                      holdStatus === "expired"
                        ? "bg-rose-100 text-rose-800 ring-1 ring-rose-300"
                        : "bg-amber-100 text-amber-900 ring-1 ring-amber-300";
                    const holdDisplayId =
                      holdRemnant.display_id || holdRemnant.moraware_remnant_id || holdRemnant.id || hold.remnant_id;

                    return (
                      <article key={hold.id} className="rounded-[26px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 shadow-sm">
                        <div className="min-w-0">
                          <PrivateRemnantSummaryBlock
                            remnant={holdRemnant}
                            className=""
                            onOpenImage={() => imageSrc(holdRemnant) && openImageViewer(holdRemnant)}
                          />

                          <div className="mt-4 rounded-[24px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 shadow-[0_10px_24px_rgba(25,27,28,0.04)]">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Hold Details</p>
                                <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
                                  Review the active hold, requester details, and expiration date.
                                </p>
                              </div>
                              <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${holdStatusClass}`}>
                                {holdStatus === "expired" ? "Expired" : "On Hold"}
                              </span>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Customer</p>
                                <p className="mt-2 break-words text-sm font-medium text-[var(--brand-ink)]">{requesterName}</p>
                              </div>
                              <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Email</p>
                                <p className="mt-2 break-all text-sm font-medium text-[var(--brand-ink)]">{requesterEmail}</p>
                              </div>
                              <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Job</p>
                                <p className="mt-2 text-sm font-medium text-[var(--brand-ink)]">{hold.job_number ? formatJobNumber(hold.job_number, holdRemnant) : "Unknown"}</p>
                              </div>
                              <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Expires</p>
                                <p className="mt-2 text-sm font-medium text-[var(--brand-ink)]">{formatDateLabel(hold.expires_at)}</p>
                              </div>
                            </div>

                            <div className="mt-3 rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Client Message</p>
                              <p className="mt-2 break-words text-sm leading-6 text-[color:color-mix(in_srgb,var(--brand-ink)_80%,white)]">{requesterMessage}</p>
                            </div>
                          </div>

                          <div className="mt-4 rounded-[24px] border border-[var(--brand-line)] bg-white p-4 shadow-[0_10px_24px_rgba(25,27,28,0.04)]">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Hold Actions</p>
                                <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
                                  Release this remnant back to available or mark it as sold.
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <button
                                type="button"
                                disabled={isWorking || remnantStatus === "available"}
                                onClick={() => changeRemnantStatus(holdRemnant, "available")}
                                className="inline-flex h-12 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-100 px-5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isWorking ? "Working..." : "Make Available"}
                              </button>
                              <button
                                type="button"
                                disabled={remnantStatus === "sold"}
                                onClick={() => changeRemnantStatus(holdRemnant, "sold")}
                                className="inline-flex h-12 items-center justify-center rounded-2xl border border-rose-200 bg-rose-100 px-5 text-sm font-semibold text-rose-800 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Sell
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {mySoldOpen ? (
        <div className="fixed inset-0 z-[71] overflow-y-auto bg-black/50 px-4 py-8">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-white shadow-[0_24px_70px_rgba(35,35,35,0.14)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">Sold</p>
                  <span className="inline-flex items-center rounded-full border border-[var(--brand-line)] bg-[var(--brand-white)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-ink)]">
                    {mySold.length} Total
                  </span>
                </div>
                <h2 className="font-display mt-1 text-2xl font-semibold text-[var(--brand-ink)]">Sold Remnants</h2>
                <p className="mt-2 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
                  Review the remnants you marked as sold, including the job number and sale notes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMySoldOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                aria-label="Close my sold"
              >
                {"\u00D7"}
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-6">
              {mySoldLoading ? (
                <div className="rounded-[24px] border border-dashed border-[var(--brand-line)] bg-[var(--brand-white)] px-5 py-10 text-center text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Loading</p>
                  <p className="mt-2 text-sm">Refreshing your sold remnants.</p>
                </div>
              ) : mySold.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-[var(--brand-line)] bg-[var(--brand-white)] px-5 py-10 text-center text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">No Sold Remnants</p>
                  <p className="mt-2 text-sm">You have not marked any remnants as sold yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {mySold.map((sale) => {
                    const soldRemnant = sale.remnant || {};
                    const soldMaterial = soldRemnant.material_name || soldRemnant.material?.name || "Unknown";
                    const soldStoneName = String(soldRemnant.name || "").trim() || "Unnamed";
                    const soldDisplayId =
                      soldRemnant.display_id || soldRemnant.moraware_remnant_id || soldRemnant.id || sale.remnant_id;

                    return (
                      <article key={sale.id} className="rounded-[26px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 shadow-sm">
                        <div className="min-w-0">
                          <PrivateRemnantSummaryBlock
                            remnant={soldRemnant}
                            className=""
                            onOpenImage={() => imageSrc(soldRemnant) && openImageViewer(soldRemnant)}
                          />

                          <div className="mt-4 rounded-[24px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 shadow-[0_10px_24px_rgba(25,27,28,0.04)]">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Sale Details</p>
                                <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
                                  Review when the remnant sold, the job reference, and sale notes.
                                </p>
                              </div>
                              <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-800 ring-1 ring-rose-300">
                                Sold
                              </span>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Sold At</p>
                                <p className="mt-2 text-sm font-medium text-[var(--brand-ink)]">{formatDateLabel(sale.sold_at || sale.created_at)}</p>
                              </div>
                              <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Job</p>
                                <p className="mt-2 text-sm font-medium text-[var(--brand-ink)]">{sale.job_number ? formatJobNumber(sale.job_number, soldRemnant) : "Unknown"}</p>
                              </div>
                            </div>

                            <div className="mt-3 rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Sale Notes</p>
                              <p className="mt-2 break-words text-sm leading-6 text-[color:color-mix(in_srgb,var(--brand-ink)_80%,white)]">{String(sale.notes || "").trim() || "No sale notes provided."}</p>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {editorMode && editorForm ? (
        <div className="fixed inset-0 z-[72] overflow-y-auto bg-black/50 px-4 py-8">
          <div className="mx-auto max-w-6xl overflow-visible rounded-[32px] border border-[var(--brand-line)] bg-white shadow-[0_24px_70px_rgba(25,27,28,0.14)]">
            <div className="flex items-center justify-between border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Inventory</p>
                <h2 className="font-display text-2xl font-semibold text-[var(--brand-ink)]">{editorMode === "create" ? "Add Remnant" : "Edit Remnant"}</h2>
              </div>
              <button type="button" onClick={closeEditor} className="h-10 w-10 rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]">
                {"\u00D7"}
              </button>
            </div>
            <form onSubmit={saveEditor} className="grid gap-4 p-6 md:grid-cols-2">
              <div className="md:col-span-2 grid gap-4 rounded-[28px] border border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,var(--brand-white)_100%)] p-4 lg:grid-cols-[minmax(0,1.15fr)_320px]">
                <div className="overflow-hidden rounded-[24px] border border-[var(--brand-line)] bg-white shadow-[0_16px_38px_rgba(25,27,28,0.08)]">
                  {editorForm.image_preview ? (
                    <img
                      src={editorForm.image_preview}
                      alt="Remnant preview"
                      className="h-72 w-full bg-[var(--brand-white)] object-contain"
                    />
                  ) : (
                    <div className="flex h-72 items-center justify-center bg-[linear-gradient(135deg,#ffffff_0%,var(--brand-white)_100%)] px-6 text-center text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                      Add an image to preview and crop it here
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-5 rounded-[24px] border border-[var(--brand-line)] bg-white p-5">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Image Tools</p>
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)]">
                      Choose image
                      <input
                        ref={editorImageInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleEditorImageChange}
                        className="mt-2 block w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-[var(--brand-ink)] file:mr-4 file:rounded-full file:border-0 file:bg-[var(--brand-ink)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                      />
                    </label>
                    <div className="flex">
                      <button
                        type="button"
                        onClick={openCropEditor}
                        disabled={!editorForm.image_preview}
                        className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Crop
                      </button>
                    </div>
                  </div>
                  <div className="border-t border-[var(--brand-line)] pt-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Colors</p>
                      </div>
                      {editorColorComposerOpen ? (
                        <div className="grid w-full grid-cols-[minmax(0,1fr)_40px_auto] items-center gap-2 sm:max-w-full">
                          <input
                            type="text"
                            value={editorColorDraft}
                            onChange={(event) => setEditorColorDraft(event.target.value)}
                            placeholder="Color"
                            className="h-10 min-w-0 flex-1 rounded-2xl border border-[var(--brand-line)] bg-white px-3.5 text-sm text-[var(--brand-ink)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setEditorColorComposerOpen(false);
                              setEditorColorDraft("");
                            }}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white text-base font-semibold text-[rgba(35,35,35,0.62)] transition hover:border-[var(--brand-orange)] hover:text-[var(--brand-orange)]"
                            aria-label="Cancel add color"
                          >
                            ×
                          </button>
                          <button
                            type="button"
                            onClick={createEditorColor}
                            disabled={editorColorSaving}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--brand-ink)] text-sm font-semibold text-white transition hover:bg-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label={editorColorSaving ? "Adding color" : "Add color"}
                          >
                            {editorColorSaving ? "…" : "✓"}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditorColorComposerOpen(true)}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-2xl border border-[var(--brand-line)] bg-white px-3.5 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                        >
                          <span className="text-base leading-none">+</span>
                          Color
                        </button>
                      )}
                    </div>
                    <div className="mt-4 rounded-[22px] border border-[var(--brand-line)] bg-[var(--brand-white)] p-4">
                      <div className="flex flex-wrap gap-2">
                        {lookups.colors.map((row) => {
                          const selected = colorListIncludes(editorForm.colors, row.name);
                          return (
                            <button
                              key={`color-${row.id}`}
                              type="button"
                              onClick={() => toggleEditorColor(row.name)}
                              className={`group relative inline-flex h-10 w-10 items-center justify-center rounded-full border transition ${
                                selected
                                  ? "border-[var(--brand-orange)] ring-4 ring-[rgba(247,134,57,0.16)] shadow-sm"
                                  : "border-[var(--brand-line)] hover:border-[rgba(247,134,57,0.35)] hover:scale-[1.03]"
                              }`}
                              style={colorSwatchStyle(row.name)}
                              title={row.name}
                              aria-label={row.name}
                              aria-pressed={selected}
                            >
                              {selected ? (
                                <span className="h-3.5 w-3.5 rounded-full border border-white/75 bg-white/90 shadow-sm" />
                              ) : null}
                              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-[#2c211c]/92 px-3 py-2 text-[11px] font-semibold text-white opacity-0 shadow-lg backdrop-blur-sm transition-all group-hover:opacity-100 group-focus-visible:opacity-100 xl:inline-flex">
                                {row.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <section className="rounded-[26px] border border-[var(--brand-line)] bg-white p-5 shadow-[0_12px_28px_rgba(25,27,28,0.05)] md:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Stone Details</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-12">
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-3">
                    Company
                    <InAppSelect
                      value={String(editorForm.company_id ?? "")}
                      onChange={(event) => updateEditorField("company_id", event.target.value)}
                      wrapperClassName="mt-2"
                      placeholder="Select company"
                      options={[
                        { value: "", label: "Select company" },
                        ...lookups.companies.map((row) => ({ value: String(row.id), label: row.name })),
                      ]}
                    />
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                    Stone ID #
                    <input
                      type="number"
                      value={editorForm.moraware_remnant_id}
                      onChange={(event) => updateEditorField("moraware_remnant_id", event.target.value)}
                      className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm text-[var(--brand-ink)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                    />
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                    Material
                    <InAppSelect
                      value={String(editorForm.material_id ?? "")}
                      onChange={(event) => updateEditorField("material_id", event.target.value)}
                      wrapperClassName="mt-2"
                      placeholder="Select material"
                      options={[
                        { value: "", label: "Select material" },
                        ...lookups.materials.map((row) => ({ value: String(row.id), label: row.name })),
                      ]}
                    />
                  </label>
                  {showEditorBrandField ? (
                    <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                      Brand
                      <div className="relative mt-2">
                        <input
                          type="text"
                          value={editorForm.brand_name}
                          onChange={(event) => {
                            updateEditorField("brand_name", event.target.value);
                            setEditorBrandMenuOpen(true);
                          }}
                          onFocus={() => setEditorBrandMenuOpen(true)}
                          onBlur={() => {
                            window.setTimeout(() => setEditorBrandMenuOpen(false), 120);
                          }}
                          className="h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm text-[var(--brand-ink)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                        />
                        {editorBrandMenuOpen && filteredEditorBrandSuggestions.length ? (
                          <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-[22px] border border-[var(--brand-line)] bg-white shadow-[0_20px_40px_rgba(25,27,28,0.12)]">
                            <div className="max-h-64 overflow-y-auto p-2">
                              {filteredEditorBrandSuggestions.map((brand) => (
                                <button
                                  key={`brand-suggestion-${brand}`}
                                  type="button"
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    updateEditorField("brand_name", brand);
                                    setEditorBrandMenuOpen(false);
                                  }}
                                  className="flex w-full items-center rounded-[16px] px-3 py-2.5 text-left transition hover:bg-[var(--brand-white)]"
                                >
                                  <span className="block truncate text-sm font-semibold text-[var(--brand-ink)]">
                                    {brand}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </label>
                  ) : null}
                  <label className={`block text-sm font-medium text-[rgba(35,35,35,0.78)] md:col-span-2 ${showEditorBrandField ? "xl:col-span-3" : "xl:col-span-5"}`}>
                    Stone Name
                    <div className="relative mt-2">
                      <input
                        type="text"
                        value={editorForm.name}
                        onChange={(event) => {
                          updateEditorField("name", event.target.value);
                          setEditorStoneMenuOpen(true);
                        }}
                        onFocus={() => setEditorStoneMenuOpen(true)}
                        onBlur={() => {
                          window.setTimeout(() => setEditorStoneMenuOpen(false), 120);
                        }}
                        className="h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm text-[var(--brand-ink)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                      />
                      {editorStoneMenuOpen && filteredEditorStoneSuggestions.length ? (
                        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-[22px] border border-[var(--brand-line)] bg-white shadow-[0_20px_40px_rgba(25,27,28,0.12)]">
                          <div className="max-h-64 overflow-y-auto p-2">
                            {filteredEditorStoneSuggestions.map((row) => (
                              <button
                                key={`stone-suggestion-${row.id}`}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  const nextBrand = row.brand_name || editorForm.brand_name || "";
                                  const nextStoneName = stoneNameWithoutBrandPrefix(
                                    row.display_name || row.stone_name || "",
                                    nextBrand,
                                  );
                                  if (row.brand_name) {
                                    updateEditorField("brand_name", row.brand_name);
                                  }
                                  updateEditorField("name", nextStoneName);
                                  setEditorStoneMenuOpen(false);
                                }}
                                className="flex w-full items-start justify-between gap-3 rounded-[16px] px-3 py-2.5 text-left transition hover:bg-[var(--brand-white)]"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold text-[var(--brand-ink)]">
                                    {row.display_name || row.stone_name || "Unnamed"}
                                  </span>
                                  {row.brand_name ? (
                                    <span className="mt-0.5 block truncate text-[11px] font-medium uppercase tracking-[0.12em] text-[rgba(35,35,35,0.54)]">
                                      {row.brand_name}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                    Finish
                    <InAppSelect
                      value={String(editorForm.finish_id ?? "")}
                      onChange={(event) => updateEditorField("finish_id", event.target.value)}
                      wrapperClassName="mt-2"
                      placeholder="Select finish"
                      options={[
                        { value: "", label: "Select finish" },
                        ...lookups.finishes.map((row) => ({ value: String(row.id), label: row.name })),
                      ]}
                    />
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                    Thickness
                    <InAppSelect
                      value={String(editorForm.thickness_id ?? "")}
                      onChange={(event) => updateEditorField("thickness_id", event.target.value)}
                      wrapperClassName="mt-2"
                      placeholder="Select thickness"
                      options={[
                        { value: "", label: "Select thickness" },
                        ...lookups.thicknesses.map((row) => ({ value: String(row.id), label: row.name })),
                      ]}
                    />
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                    Price / sqft
                    <div className="relative mt-2">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--brand-orange)]">
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editorForm.price_per_sqft}
                        onChange={(event) => updateEditorField("price_per_sqft", event.target.value)}
                        placeholder="0.00"
                        className="h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white pl-8 pr-4 text-sm font-semibold text-[var(--brand-ink)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                      />
                    </div>
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                    Width
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editorForm.width}
                      onChange={(event) => updateEditorField("width", event.target.value)}
                      placeholder='36.5 or 36 1/2'
                      className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm text-[var(--brand-ink)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                    />
                  </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                    Height
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editorForm.height}
                      onChange={(event) => updateEditorField("height", event.target.value)}
                      placeholder='24.25 or 24 1/4'
                      className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm text-[var(--brand-ink)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                    />
                  </label>
                  <div className="flex items-end xl:col-span-2">
                    <label className="inline-flex w-fit items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-white)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[rgba(35,35,35,0.72)]">
                      <input
                        type="checkbox"
                        checked={Boolean(editorForm.l_shape)}
                        onChange={(event) => updateEditorField("l_shape", event.target.checked)}
                      />
                      L-Shape
                    </label>
                  </div>
                  {editorForm.l_shape ? (
                    <>
                      <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                        L Width
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editorForm.l_width}
                          onChange={(event) => updateEditorField("l_width", event.target.value)}
                          placeholder='18.5 or 18 1/2'
                          className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm text-[var(--brand-ink)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                        />
                      </label>
                      <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
                        L Height
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editorForm.l_height}
                          onChange={(event) => updateEditorField("l_height", event.target.value)}
                          placeholder='18.5 or 18 1/2'
                          className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm text-[var(--brand-ink)] shadow-sm outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              </section>
              <div className="md:col-span-2 flex flex-wrap justify-center gap-3 pt-2">
                <button type="submit" className="inline-flex h-12 items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-6 text-sm font-semibold text-white transition hover:bg-[var(--brand-orange)]">
                  {editorMode === "create" ? "Create Remnant" : "Save Changes"}
                </button>
                {editorMode === "edit" ? (
                  <button type="button" onClick={archiveEditorRemnant} className="inline-flex h-12 items-center justify-center rounded-2xl border border-stone-300 bg-stone-100 px-6 text-sm font-semibold text-stone-900 transition hover:bg-stone-200">
                    Archive
                  </button>
                ) : null}
                <button type="button" onClick={closeEditor} className="inline-flex h-12 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-6 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {cropModal ? (
        <div className="fixed inset-0 z-[73] overflow-y-auto bg-black/60 px-4 py-8">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-white shadow-[0_30px_80px_rgba(0,0,0,0.28)]">
            <div className="flex items-center justify-between border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Crop Workspace</p>
                <h2 className="font-display text-2xl font-semibold text-[var(--brand-ink)]">Free Crop</h2>
              </div>
              <button type="button" onClick={closeCropEditor} className="h-10 w-10 rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]">
                {"\u00D7"}
              </button>
            </div>
            <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-hidden rounded-[28px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,var(--brand-white)_100%)] p-4 shadow-inner">
                <canvas
                  ref={cropCanvasRef}
                  width={CROP_CANVAS_WIDTH}
                  height={CROP_CANVAS_HEIGHT}
                  onPointerDown={handleCropPointerDown}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={endCropPointerDrag}
                  onPointerLeave={endCropPointerDrag}
                  className="h-auto w-full cursor-grab rounded-[24px] border border-[var(--brand-line)] bg-white shadow-[0_18px_40px_rgba(25,27,28,0.08)]"
                />
              </div>
              <div className="space-y-4 rounded-[28px] border border-[var(--brand-line)] bg-white p-5 shadow-[0_18px_40px_rgba(25,27,28,0.08)]">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Controls</p>
                  <h3 className="font-display mt-2 text-xl font-semibold text-[var(--brand-ink)]">Rotate and fine-tune</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-white)] px-4 py-3">
                    <span className="text-sm font-medium text-[rgba(35,35,35,0.72)]">Rotation</span>
                    <span className="rounded-full border border-[var(--brand-line)] bg-white px-3 py-1 text-sm font-semibold text-[var(--brand-ink)]">
                      {formatCropRotationLabel((cropModal.rotationBase || 0) + (cropModal.rotation || 0))}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => updateCropModal((current) => ({ ...current, rotationBase: current.rotationBase - 90 }))}
                      className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                    >
                      Rotate Left
                    </button>
                    <button
                      type="button"
                      onClick={() => updateCropModal((current) => ({ ...current, rotationBase: current.rotationBase + 90 }))}
                      className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                    >
                      Rotate Right
                    </button>
                  </div>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)]">
                    Fine rotation
                    <input
                      type="range"
                      min="-45"
                      max="45"
                      value={cropModal.rotation}
                      onChange={(event) => updateCropModal((current) => ({ ...current, rotation: Number(event.target.value || 0) }))}
                      className="mt-3 w-full accent-[var(--brand-orange)]"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => updateCropModal((current) => ({
                      ...current,
                      scale: current.baseScale,
                      offsetX: 0,
                      offsetY: 0,
                      rotationBase: 0,
                      rotation: 0,
                      cropRect: { ...DEFAULT_CROP_RECT },
                    }))}
                    className="inline-flex h-11 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-5 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={saveCropEditor}
                    className="inline-flex h-11 items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--brand-orange)]"
                  >
                    Save Crop
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {holdEditor ? (
        <div className="fixed inset-0 z-[72] overflow-y-auto bg-black/50 px-4 py-8">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-white shadow-[0_24px_70px_rgba(25,27,28,0.14)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Hold</p>
                <h2 className="font-display text-2xl font-semibold text-[var(--brand-ink)]">Manage Hold</h2>
              </div>
              <button type="button" onClick={closeHoldEditor} className="h-10 w-10 rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]">
                {"\u00D7"}
              </button>
            </div>
            <form onSubmit={saveHoldEditor} className="p-6">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]">
                <div>
                  <PrivateRemnantSummaryBlock
                    remnant={holdEditor.remnant || {}}
                    onOpenImage={() => imageSrc(holdEditor.remnant || {}) && openImageViewer(holdEditor.remnant || {})}
                  />
                </div>
                <div className="rounded-[28px] border border-[var(--brand-line)] bg-white p-5 shadow-[0_16px_38px_rgba(25,27,28,0.06)]">
                  <div className="rounded-[24px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 shadow-[0_10px_24px_rgba(25,27,28,0.04)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Hold Details</p>
                        <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
                          {holdEditor.summary}
                        </p>
                      </div>
                      <span className="rounded-full border border-[var(--brand-line)] bg-[var(--brand-white)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-ink)]">
                        {holdEditor.holdId ? "Existing Hold" : "New Hold"}
                      </span>
                    </div>
                  </div>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                    All holds expire automatically after 7 days.
                  </p>
                  {holdEditor.locked_to_other_owner ? (
                    <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      This hold belongs to {holdEditor.current_owner_name || "another sales rep"}. Only that sales rep or a manager can change it.
                    </div>
                  ) : null}

                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {holdEditor.self_only ? null : (
                      <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] lg:col-span-2">
                        Sales Rep
                        <SelectField
                          value={holdEditor.owner_user_id}
                          onChange={(event) => updateHoldField("owner_user_id", event.target.value)}
                          disabled={salesReps.length === 0}
                          wrapperClassName="relative mt-1"
                          className=""
                        >
                          <option value="">
                            {salesReps.length === 0 ? "No active sales reps available" : "Select sales rep"}
                          </option>
                          {salesReps.map((row) => (
                            <option key={row.id} value={row.id}>{row.display_name || row.full_name || row.email || "User"}</option>
                          ))}
                        </SelectField>
                      </label>
                    )}
                    <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)]">
                      Customer Name
                      <input
                        type="text"
                        value={holdEditor.customer_name}
                        onChange={(event) => updateHoldField("customer_name", event.target.value)}
                        required
                        disabled={holdEditor.locked_to_other_owner}
                        placeholder="Customer name"
                        className="mt-1 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-[var(--brand-ink)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                      />
                    </label>
                    <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)]">
                      Job Number
                      <div className="mt-1 flex overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white">
                        <span className="inline-flex items-center border-r border-[var(--brand-line)] bg-[var(--brand-white)] px-4 text-sm font-semibold text-[var(--brand-orange)]">
                          {jobNumberPrefixForRemnant(holdEditor.remnant)}
                        </span>
                        <input
                          type="text"
                          value={holdEditor.job_number}
                          onChange={(event) => updateHoldField("job_number", normalizeJobNumberInput(event.target.value))}
                          required
                          disabled={holdEditor.locked_to_other_owner}
                          placeholder="1234"
                          className="min-w-0 flex-1 bg-white px-4 py-3 text-sm text-[var(--brand-ink)] outline-none"
                        />
                      </div>
                    </label>
                    <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] lg:col-span-2">
                      Hold Notes
                      <textarea
                        rows="4"
                        value={holdEditor.notes}
                        onChange={(event) => updateHoldField("notes", event.target.value)}
                        disabled={holdEditor.locked_to_other_owner}
                        className="mt-1 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-[var(--brand-ink)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                        placeholder="Optional notes for the team"
                      />
                    </label>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-3">
                    <button type="submit" disabled={holdEditor.locked_to_other_owner} className="inline-flex h-12 items-center justify-center rounded-2xl border border-[var(--brand-orange)] bg-[rgba(247,134,57,0.12)] px-6 text-sm font-semibold text-[var(--brand-orange-deep)] transition hover:bg-[rgba(247,134,57,0.2)] disabled:cursor-not-allowed disabled:opacity-50">
                      Save Hold
                    </button>
                    {holdEditor.holdId ? (
                      <button
                        type="button"
                        onClick={releaseHoldEditor}
                        disabled={holdEditor.locked_to_other_owner}
                        className="inline-flex h-12 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-100 px-6 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Make Available
                      </button>
                    ) : null}
                    {holdEditor.holdId ? (
                      <button
                        type="button"
                        onClick={sellFromHoldEditor}
                        disabled={holdEditor.locked_to_other_owner}
                        className="inline-flex h-12 items-center justify-center rounded-2xl border border-rose-200 bg-rose-100 px-6 text-sm font-semibold text-rose-800 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Sell
                      </button>
                    ) : null}
                    <button type="button" onClick={closeHoldEditor} className="inline-flex h-12 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-6 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]">
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {soldEditor ? (
        <div className="fixed inset-0 z-[72] overflow-y-auto bg-black/50 px-4 py-8">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-white shadow-[0_24px_70px_rgba(25,27,28,0.14)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Sold</p>
                <h2 className="font-display text-2xl font-semibold text-[var(--brand-ink)]">Mark as Sold</h2>
              </div>
              <button
                type="button"
                onClick={closeSoldEditor}
                className="h-10 w-10 rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
              >
                {"\u00D7"}
              </button>
            </div>
            <form onSubmit={saveSoldEditor} className="p-6">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]">
                <div>
                  <PrivateRemnantSummaryBlock
                    remnant={soldEditor.remnant || {}}
                    onOpenImage={() => imageSrc(soldEditor.remnant || {}) && openImageViewer(soldEditor.remnant || {})}
                  />
                </div>
                <div className="rounded-[28px] border border-[var(--brand-line)] bg-white p-5 shadow-[0_16px_38px_rgba(25,27,28,0.06)]">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {soldEditor.self_only ? (
                    <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] lg:col-span-2">
                    Sales Rep
                    <div className="mt-1 flex min-h-12 items-center rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-white)] px-4 py-3 text-sm text-[var(--brand-ink)]">
                      {profileDisplayName(profile)}
                    </div>
                  </label>
                ) : (
                    <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] lg:col-span-2">
                    Sales Rep
                    <SelectField
                      value={soldEditor.sold_by_user_id}
                      onChange={(event) => updateSoldField("sold_by_user_id", event.target.value)}
                      required
                      disabled={salesReps.length === 0}
                      wrapperClassName="relative mt-1"
                      className=""
                    >
                      <option value="">
                        {salesReps.length === 0 ? "No active sales reps available" : "Select sales rep"}
                      </option>
                      {salesReps.map((row) => (
                        <option key={row.id} value={row.id}>{row.display_name || row.full_name || row.email || "User"}</option>
                      ))}
                    </SelectField>
                  </label>
                )}
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)]">
                  Job Number
                  <div className="mt-1 flex overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white">
                    <span className="inline-flex items-center border-r border-[var(--brand-line)] bg-[var(--brand-white)] px-4 text-sm font-semibold text-[var(--brand-orange)]">
                      {jobNumberPrefixForRemnant(soldEditor.remnant)}
                    </span>
                    <input
                      type="text"
                      value={soldEditor.job_number}
                      onChange={(event) => updateSoldField("job_number", normalizeJobNumberInput(event.target.value))}
                      required
                      placeholder="1234"
                      className="min-w-0 flex-1 bg-white px-4 py-3 text-sm text-[var(--brand-ink)] outline-none"
                    />
                  </div>
                </label>
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] lg:col-span-2">
                  Sold Notes
                  <textarea
                    rows="4"
                    value={soldEditor.notes}
                    onChange={(event) => updateSoldField("notes", event.target.value)}
                    className="mt-1 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-[var(--brand-ink)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                    placeholder="Optional notes"
                  />
                </label>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                    <button type="submit" className="inline-flex h-12 items-center justify-center rounded-2xl border border-rose-200 bg-rose-100 px-6 text-sm font-semibold text-rose-800 transition hover:bg-rose-200">
                  Save Sale
                </button>
                    <button type="button" onClick={closeSoldEditor} className="inline-flex h-12 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-6 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]">
                  Cancel
                </button>
              </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[74] flex justify-center sm:inset-x-auto sm:right-5 sm:justify-end">
          <div
            className={`pointer-events-auto flex w-full max-w-md items-start justify-between gap-3 rounded-[24px] border px-4 py-3 text-sm shadow-[0_18px_45px_rgba(15,23,39,0.18)] backdrop-blur ${
              messageTone === "error"
                ? "border-rose-200 bg-white/96 text-rose-800"
                : "border-emerald-200 bg-white/96 text-[#285641]"
            }`}
            role="status"
            aria-live="polite"
          >
            <p className="pr-2">{message}</p>
            <button
              type="button"
              onClick={clearMessage}
              className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold transition ${
                messageTone === "error"
                  ? "text-rose-600 hover:bg-rose-50"
                  : "text-emerald-700 hover:bg-emerald-50"
              }`}
              aria-label="Dismiss message"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
