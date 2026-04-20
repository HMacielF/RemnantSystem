/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";

export const MAX_BROWSER_IMAGE_PIXELS = 16_000_000;
export const CROP_CANVAS_WIDTH = 960;
export const CROP_CANVAS_HEIGHT = 640;
export const DEFAULT_CROP_RECT = {
  x: 120,
  y: 90,
  width: 720,
  height: 540,
};
export const TOAST_DURATION_MS = 3600;
export const HOLD_REQUEST_REFRESH_MS = 15_000;

export function imageSrc(remnant) {
  return remnant.image || remnant.source_image_url || "";
}

export function displayRemnantId(remnant) {
  return remnant.display_id || remnant.moraware_remnant_id || remnant.id;
}

export function isAccessDeniedError(message) {
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

export function remnantToastLabel(remnant) {
  const id = displayRemnantId(remnant);
  const name = String(remnant?.name || "").trim();
  return `#${id}${name ? ` - ${name}` : ""}`;
}

export function internalRemnantId(remnant) {
  return remnant.internal_remnant_id || remnant.id || null;
}

export function statusText(remnant) {
  const normalized = String(remnant?.status || "").trim().toLowerCase();
  if (!normalized || normalized === "available") return "Available";
  if (normalized === "hold" || normalized === "on hold") return "On Hold";
  if (normalized === "sold") return "Sold";
  return remnant?.status || "Available";
}

export function statusToastText(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "hold" || normalized === "on hold") return "on hold";
  if (normalized === "sold") return "sold";
  return "available";
}

export function statusBadgeClass(status) {
  const lc = String(status || "").toLowerCase();
  if (lc === "sold") return "bg-rose-100 text-rose-800 ring-1 ring-rose-300";
  if (lc === "hold" || lc === "on hold") return "bg-amber-100 text-amber-900 ring-1 ring-amber-300";
  return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300";
}

export function remnantJobReference(remnant) {
  const normalized = normalizeRemnantStatus(remnant);
  if (normalized === "hold") return normalizeJobNumberInput(remnant?.current_hold?.job_number || "");
  if (normalized === "sold") {
    return normalizeJobNumberInput(remnant?.sold_job_number || remnant?.current_sale?.job_number || "");
  }
  return "";
}

export function jobNumberPrefixForCompanyName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("prime")) return "P";
  return "J";
}

export function jobNumberPrefixForRemnant(remnant) {
  return jobNumberPrefixForCompanyName(companyText(remnant));
}

export function formatJobNumber(value, context) {
  const normalized = normalizeJobNumberInput(value);
  if (!normalized) return "";
  const prefix =
    typeof context === "string"
      ? jobNumberPrefixForCompanyName(context)
      : jobNumberPrefixForRemnant(context);
  return `${prefix}${normalized}`;
}

export function statusBadgeText(remnant) {
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

export function normalizeMaterialName(value) {
  return String(value || "").trim().toLowerCase();
}

export function uniqueMaterialOptions(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter((value) => {
    const normalized = normalizeMaterialName(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function materialOptionsFromRows(rows) {
  return uniqueMaterialOptions(
    (Array.isArray(rows) ? rows : [])
      .map((row) => row?.material_name || row?.material?.name || row?.material)
      .filter(Boolean),
  );
}

export function normalizeStoneLookupName(value) {
  return String(value || "").trim().toLowerCase();
}

export function stoneNameWithoutBrandPrefix(stoneName, brandName) {
  const stone = String(stoneName || "").trim();
  const brand = String(brandName || "").trim();
  if (!stone || !brand) return stone;

  const normalizedStone = normalizeStoneLookupName(stone);
  const normalizedBrand = normalizeStoneLookupName(brand);
  if (!normalizedStone.startsWith(`${normalizedBrand} `)) return stone;

  return stone.slice(brand.length).trim();
}

export function supportsBrandField(materialName) {
  const normalized = normalizeStoneLookupName(materialName);
  return normalized === "quartz" || normalized === "porcelain";
}

export function colorListIncludes(values, target) {
  const normalizedTarget = normalizeStoneLookupName(target);
  return (Array.isArray(values) ? values : []).some((value) => normalizeStoneLookupName(value) === normalizedTarget);
}

export function stoneLookupMatchesName(row, stoneName) {
  const normalizedName = normalizeStoneLookupName(stoneName);
  if (!normalizedName || !row) return false;

  return [row.display_name, row.stone_name, row.name].some(
    (value) => normalizeStoneLookupName(value) === normalizedName,
  );
}

export function sharedStoneColorsForEditor(stoneProducts, materialId, stoneName) {
  const numericMaterialId = Number(materialId);
  const match = (Array.isArray(stoneProducts) ? stoneProducts : []).find((row) => {
    return Number(row?.material_id) === numericMaterialId && stoneLookupMatchesName(row, stoneName);
  });

  if (!match) {
    return [];
  }

  return Array.isArray(match.colors) ? match.colors : [];
}

export function sizeText(remnant) {
  if (remnant.l_shape) {
    return `${remnant.width} x ${remnant.height} + ${remnant.l_width} x ${remnant.l_height}`;
  }
  return `${remnant.width} x ${remnant.height}`;
}

export function cardSizeText(remnant) {
  if (remnant.l_shape) {
    return `${remnant.width}" x ${remnant.height}" + ${remnant.l_width}" x ${remnant.l_height}"`;
  }
  return `${remnant.width}" x ${remnant.height}"`;
}

export function cardTitleText(remnant) {
  const material = String(remnant.material_name || "").trim();
  const stone = String(remnant.name || "").trim();
  if (material && stone) return `${material} | ${stone}`;
  return material || stone || "Unnamed";
}

export function brandText(remnant) {
  return String(remnant?.brand_name || "").trim();
}

export function stoneNameText(remnant) {
  return String(remnant?.name || "").trim();
}

export function companyText(remnant) {
  return String(remnant?.company_name || remnant?.company || "").trim();
}

export function thicknessText(remnant) {
  const value = String(remnant?.thickness_name || remnant?.thickness || "").trim();
  if (!value) return "";
  const normalized = value.toLowerCase();
  if (normalized === "unknown" || normalized === "n/a" || normalized === "na") return "";
  return value;
}

export function finishText(remnant) {
  return String(remnant?.finish_name || "").trim();
}

export function priceText(remnant) {
  const numeric = Number(remnant?.price_per_sqft);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const formatted = Number.isInteger(numeric)
    ? String(numeric)
    : numeric.toFixed(numeric >= 100 ? 0 : 2).replace(/\.?0+$/, "");
  return `$${formatted}`;
}

export function privateCardHeading(remnant) {
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

export function privateCardSubheading(remnant) {
  const material = String(remnant?.material_name || remnant?.material || "").trim();
  const company = companyText(remnant);
  return [material, company].filter(Boolean).join(" · ");
}

export function privateCardMetricEntries(remnant) {
  return [
    { label: "Size", value: cardSizeText(remnant) },
    ...(priceText(remnant) ? [{ label: "Price", value: priceText(remnant), title: "Open slab price per sqft" }] : []),
    ...(thicknessText(remnant) ? [{ label: "Thick", value: thicknessText(remnant), title: "Thickness" }] : []),
    ...(finishText(remnant) ? [{ label: "Finish", value: finishText(remnant) }] : []),
  ];
}

export function privateModalSummaryEntries(remnant) {
  return [
    { label: "Material", value: String(remnant?.material_name || remnant?.material || "").trim() },
    { label: "Size", value: cardSizeText(remnant) },
    ...(priceText(remnant) ? [{ label: "Price", value: priceText(remnant), title: "Open slab price per sqft" }] : []),
    { label: "Thick", value: thicknessText(remnant), title: "Thickness" },
    { label: "Finish", value: finishText(remnant) },
  ].filter((entry) => String(entry.value || "").trim());
}

export function PrivateRemnantSummaryBlock({ remnant, className = "", onOpenImage }) {
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
            className={`overflow-hidden rounded-[22px] border border-white/80 bg-white text-left shadow-[0_12px_24px_rgba(25,27,28,0.08)] transition-transform ${image ? "hover:-translate-y-0.5" : "cursor-default"}`}
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

export function remnantColors(remnant) {
  return Array.isArray(remnant?.colors) ? remnant.colors.filter(Boolean) : [];
}

export function colorSwatchStyle(colorName) {
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

export function SelectField({ wrapperClassName = "relative mt-2", className = "", children, ...props }) {
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

export function InAppSelect({
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
        className={`flex h-12 w-full items-center justify-between gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-left text-sm font-medium shadow-[0_1px_0_rgba(255,255,255,0.75),0_10px_24px_rgba(25,27,28,0.05)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] ${selected ? "text-[var(--brand-ink)]" : "text-[rgba(35,35,35,0.48)]"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <span className="truncate">{buttonText}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-[var(--brand-orange)] transition-transform ${open ? "rotate-180" : ""}`}
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
                  className={`flex w-full items-center rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--brand-white)] ${isSelected ? "bg-[var(--brand-white)]" : ""}`}
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

export function compactSizeText(remnant) {
  if (!remnant?.width || !remnant?.height) return "Unknown";
  return `${remnant.width} x ${remnant.height}`;
}

export function formatDateLabel(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatShortDateLabel(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(date);
}

export function currentFiltersFromSearch(searchParams) {
  return {
    materials: searchParams.getAll("material"),
    stone: searchParams.get("stone") || "",
    minWidth: searchParams.get("min-width") || "",
    minHeight: searchParams.get("min-height") || "",
    status: searchParams.get("status") || "",
  };
}

export function emptyFilters() {
  return {
    materials: [],
    stone: "",
    minWidth: "",
    minHeight: "",
    status: "",
  };
}

export function buildSearchQuery(filters) {
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

export function cropSourceUrl(src) {
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

let webpEncodingSupport = null;

function supportsWebpEncoding() {
  if (webpEncodingSupport !== null) return webpEncodingSupport;
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    webpEncodingSupport = probe.toDataURL("image/webp").startsWith("data:image/webp");
  } catch (_error) {
    webpEncodingSupport = false;
  }
  return webpEncodingSupport;
}

export function preferredCropType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized === "image/png") return normalized;
  if (normalized === "image/webp") {
    return supportsWebpEncoding() ? normalized : "image/jpeg";
  }
  return supportsWebpEncoding() ? "image/webp" : "image/jpeg";
}

export function preferredCropExtension(contentType) {
  switch (preferredCropType(contentType)) {
    case "image/png": return "png";
    case "image/webp": return "webp";
    default: return "jpg";
  }
}

export function imagePayloadFromDataUrl(dataUrl, fileName, type) {
  return {
    name: fileName,
    type: preferredCropType(type),
    dataUrl,
  };
}

export function formatCropRotationLabel(value) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}deg`;
}

export function canvasPointFromPointer(event, canvas) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
    y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
  };
}

export function cropHandles(rect) {
  return [
    { key: "nw", x: rect.x, y: rect.y },
    { key: "ne", x: rect.x + rect.width, y: rect.y },
    { key: "sw", x: rect.x, y: rect.y + rect.height },
    { key: "se", x: rect.x + rect.width, y: rect.y + rect.height },
  ];
}

export function pointInCropRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function normalizeCropDraft(draft, image, canvasWidth = CROP_CANVAS_WIDTH, canvasHeight = CROP_CANVAS_HEIGHT) {
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

export function PrivateWorkspaceSkeletonCard({ showActions = false }) {
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

export function cropGeometry(cropModal, image) {
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

export function renderCropCanvas(canvas, image, cropModal) {
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

export async function loadImageElement(src) {
  const image = new Image();
  image.src = src;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Failed to load image for cropping"));
  });
  return image;
}

export async function normalizeImageFile(file) {
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
    const outputExt = preferredCropExtension(contentType);
    return {
      name: file.name.replace(/\.[^.]+$/, "") + "." + outputExt,
      type: outputType,
      dataUrl: canvas.toDataURL(outputType, 0.86),
    };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function fileToPayload(file) {
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

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

/**
 * Build a fetch init for a remnant-writing request. When the payload has
 * an image_file carrying a data URL, send multipart/form-data with the
 * image as a real file (no base64 inflation). Otherwise send plain JSON.
 */
export async function buildRemnantRequestInit(method, payload) {
  const imageFile = payload?.image_file;
  const hasImage = imageFile && (imageFile.dataUrl || imageFile instanceof Blob);

  if (!hasImage) {
    const { image_file: _image, ...rest } = payload || {};
    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest),
    };
  }

  const blob = imageFile instanceof Blob
    ? imageFile
    : await dataUrlToBlob(imageFile.dataUrl);
  const fileName = imageFile.name || "image";
  const fileType = imageFile.type || blob.type || "application/octet-stream";
  const { image_file: _image, ...rest } = payload;
  const form = new FormData();
  form.append("data", JSON.stringify(rest));
  form.append("image", new File([blob], fileName, { type: fileType }));
  return { method, body: form };
}

export async function apiFetch(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (networkError) {
    if (networkError?.name === "AbortError") throw networkError;
    const raw = String(networkError?.message || "").toLowerCase();
    const looksTransport =
      raw.includes("load failed") ||
      raw.includes("network request failed") ||
      raw.includes("failed to fetch");
    const hint = looksTransport
      ? "Check your connection. If you're uploading a photo, try a smaller one."
      : networkError?.message || "Network error";
    const error = new Error(`Couldn't reach ${path}. ${hint}`);
    error.cause = networkError;
    throw error;
  }

  if (!res.ok) {
    let message = "Request failed";
    try {
      const payload = await res.json();
      const base = payload?.error || message;
      const extra = payload?.details || payload?.hint || "";
      message = extra ? `${base} — ${extra}` : base;
    } catch (_error) {
      message = (await res.text().catch(() => "")) || `${res.status} ${res.statusText || "Request failed"}`;
    }
    throw new Error(message);
  }

  try {
    return await res.json();
  } catch (_parseError) {
    throw new Error("Server sent an empty or invalid response");
  }
}

export function canManageStructure(profile) {
  return ["super_admin", "manager"].includes(profile?.system_role || "");
}

export function canManageRemnant(profile, remnant) {
  if (!profile) return false;
  if (["super_admin", "manager"].includes(profile.system_role)) return true;
  return (
    profile.system_role === "status_user" &&
    profile.company_id !== null &&
    Number(profile.company_id) === Number(remnant.company_id)
  );
}

export function normalizeRemnantStatus(remnant) {
  return String(remnant?.status || "").trim().toLowerCase();
}

export function statusOwnedByProfile(profile, remnant) {
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

export function humanizeRole(role) {
  if (role === "status_user") return "Sales Rep";
  if (role === "super_admin") return "Super Admin";
  return String(role || "user")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function profileDisplayName(profile) {
  return profile?.full_name || profile?.display_name || profile?.email || "User";
}

export function firstName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.split(/\s+/)[0] || text;
}

export function normalizeJobNumberInput(value) {
  return String(value || "")
    .replace(/^\s*[jp]\s*#?\s*/i, "")
    .trim();
}
