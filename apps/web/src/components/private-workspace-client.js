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

function statusBadgeText(remnant) {
  const normalized = normalizeRemnantStatus(remnant);
  const jobReference = remnantJobReference(remnant);

  if (normalized === "hold") {
    const owner = firstName(remnant?.current_hold?.owner_name || "");
    const until = remnant?.current_hold?.expires_at ? `Until ${formatShortDateLabel(remnant.current_hold.expires_at)}` : "";
    return [owner || "On Hold", jobReference ? `J${jobReference}` : "", until].filter(Boolean).join(" · ");
  }

  if (normalized === "sold") {
    const soldBy = firstName(remnant?.sold_by_name || remnant?.current_sale?.sold_by_name || "");
    return [soldBy || "Sold", jobReference ? `J${jobReference}` : ""].filter(Boolean).join(" · ");
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
    .replace(/^\s*j\s*#?\s*/i, "")
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
  const [lookups, setLookups] = useState({ companies: [], materials: [], thicknesses: [] });
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
  const [myHoldsLoading, setMyHoldsLoading] = useState(false);
  const [pendingReviewId, setPendingReviewId] = useState("");
  const [holdRequestDrafts, setHoldRequestDrafts] = useState({});
  const [workingRemnantId, setWorkingRemnantId] = useState("");
  const [editorMode, setEditorMode] = useState("");
  const [editorForm, setEditorForm] = useState(null);
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
  const materialFilterOptions = useMemo(() => {
    return uniqueMaterialOptions([...availableMaterialOptions, ...filters.materials]);
  }, [availableMaterialOptions, filters.materials]);
  const filterGridClass = canStructure
    ? "mt-2 grid grid-cols-2 gap-3 lg:grid-cols-[fit-content(44rem)_minmax(240px,1fr)_110px_110px_140px_56px] lg:items-end"
    : "mt-2 grid grid-cols-2 gap-3 lg:grid-cols-[fit-content(44rem)_minmax(280px,1fr)_110px_110px_140px] lg:items-end";
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
        queueTitle: "Your request queue",
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

        const [requestsPayload, myHoldsPayload, lookupPayload, salesRepPayload, stonePayload, remnantRows] = await Promise.all([
          apiFetch("/api/hold-requests?status=pending", { cache: "no-store" }),
          apiFetch("/api/my-holds", { cache: "no-store" }),
          apiFetch("/api/lookups", { cache: "no-store" }),
          nextProfile.system_role === "status_user" ? Promise.resolve([]) : apiFetch("/api/sales-reps", { cache: "no-store" }),
          canManageStructure(nextProfile) ? apiFetch("/api/next-stone-id", { cache: "no-store" }) : Promise.resolve({ nextStoneId: null }),
          apiFetch("/api/remnants?enrich=0", { cache: "no-store" }),
        ]);

        if (!mounted) return;
        setHoldRequests(Array.isArray(requestsPayload) ? requestsPayload : []);
        setMyHolds(Array.isArray(myHoldsPayload) ? myHoldsPayload : []);
        setLookups({
          companies: Array.isArray(lookupPayload.companies) ? lookupPayload.companies : [],
          materials: Array.isArray(lookupPayload.materials) ? lookupPayload.materials : [],
          thicknesses: Array.isArray(lookupPayload.thicknesses) ? lookupPayload.thicknesses : [],
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

  async function reloadHoldRequests() {
    const requestsPayload = await apiFetch("/api/hold-requests?status=pending");
    setHoldRequests(Array.isArray(requestsPayload) ? requestsPayload : []);
  }

  async function reloadMyHolds() {
    const holdsPayload = await apiFetch("/api/my-holds");
    setMyHolds(Array.isArray(holdsPayload) ? holdsPayload : []);
  }

  async function openMyHoldsPanel() {
    setQueueOpen(false);
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
      company_id: profile.system_role === "status_user" ? String(profile.company_id || "") : "",
      material_id: "",
      thickness_id: "",
      width: "",
      height: "",
      l_shape: false,
      l_width: "",
      l_height: "",
      image_preview: "",
      original_image_preview: "",
      image_file: null,
    });
    if (editorImageInputRef.current) editorImageInputRef.current.value = "";
  }

  function openEditEditor(remnant) {
    if (!profile || !canManageStructure(profile)) return;
    setEditorMode("edit");
    setEditorForm({
      id: remnant.id,
      moraware_remnant_id: remnant.moraware_remnant_id || "",
      name: remnant.name || "",
      company_id: String(remnant.company_id || ""),
      material_id: String(remnant.material_id || ""),
      thickness_id: String(remnant.thickness_id || ""),
      width: remnant.width || "",
      height: remnant.height || "",
      l_shape: Boolean(remnant.l_shape),
      l_width: remnant.l_width || "",
      l_height: remnant.l_height || "",
      image_preview: imageSrc(remnant),
      original_image_preview: imageSrc(remnant),
      image_file: null,
    });
    if (editorImageInputRef.current) editorImageInputRef.current.value = "";
  }

  function closeEditor() {
    setEditorMode("");
    setEditorForm(null);
    setCropModal(null);
    cropImageRef.current = null;
    if (editorImageInputRef.current) editorImageInputRef.current.value = "";
  }

  function updateEditorField(key, value) {
    setEditorForm((current) => ({
      ...(current || {}),
      [key]: value,
      ...(key === "l_shape" && !value ? { l_width: "", l_height: "" } : {}),
    }));
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
        company_id: editorForm.company_id,
        material_id: editorForm.material_id,
        thickness_id: editorForm.thickness_id,
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

  function resetEditorImage() {
    setEditorForm((current) => current ? ({
      ...current,
      image_file: null,
      image_preview: current.original_image_preview || "",
    }) : current);
    if (editorImageInputRef.current) editorImageInputRef.current.value = "";
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
        ? `${hold.status === "active" ? "Active" : "Expired"} hold${hold.customer_name ? ` for ${hold.customer_name}` : ""}${hold.job_number ? ` · J${normalizeJobNumberInput(hold.job_number)}` : ""}${hold.expires_at ? ` · Expires ${formatDateLabel(hold.expires_at)}` : ""}`
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
    <main className="min-h-screen bg-[linear-gradient(180deg,#0f1727_0%,#152238_18%,#203454_36%,#eaf0f6_36%,#edf1f6_100%)] text-[#172230]">
      <div className="mx-auto max-w-[1800px] px-6 py-5">
        <section className="mb-4 overflow-hidden rounded-[32px] border border-white/15 bg-[linear-gradient(135deg,rgba(12,23,43,0.92),rgba(23,40,69,0.84))] px-6 py-5 text-white shadow-[0_28px_90px_rgba(8,15,32,0.18)]">
          <div className={`grid gap-5 lg:items-start ${isStatusUser ? "lg:grid-cols-[minmax(0,1fr)_520px]" : "lg:grid-cols-[minmax(0,1.1fr)_640px]"}`}>
            <div className={`${isStatusUser ? "max-w-3xl" : "max-w-4xl"}`}>
              <h1 className={`mt-3 font-semibold leading-tight text-white ${isStatusUser ? "max-w-2xl text-[1.7rem] md:text-[2.05rem]" : "max-w-3xl text-[1.9rem] md:text-[2.35rem]"}`}>
                {workspaceCopy.title}
              </h1>
              <p className={`mt-2 text-sm text-slate-300 ${isStatusUser ? "max-w-2xl leading-5.5" : "max-w-3xl leading-6"}`}>
                {workspaceCopy.description}
              </p>
            </div>

            <div className="rounded-[22px] border border-white/12 bg-white/8 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-white">
                    {profile?.full_name || profile?.email || "User"}
                  </h2>
                  <span className="inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200">
                    {roleDisplay}
                  </span>
                </div>
              </div>
              <div className="mt-3.5 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setMyHoldsOpen(false);
                    setQueueOpen(true);
                  }}
                  className={`inline-flex h-10 items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/16 ${
                    isStatusUser ? "min-w-0 flex-1 whitespace-nowrap" : "whitespace-nowrap"
                  }`}
                >
                  <span className={isStatusUser ? "truncate" : ""}>Request Queue</span>
                  <span className="inline-flex min-w-7 shrink-0 items-center justify-center rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(244,63,94,0.32)]">
                    {holdRequests.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openMyHoldsPanel}
                  className={`inline-flex h-10 items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/16 ${
                    isStatusUser ? "min-w-0 flex-1 whitespace-nowrap" : "whitespace-nowrap"
                  }`}
                >
                  <span className={isStatusUser ? "truncate" : ""}>My Holds</span>
                  <span className="inline-flex min-w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-[#3d2918] shadow-[0_8px_18px_rgba(251,191,36,0.28)]">
                    {myHolds.length}
                  </span>
                </button>
                {profile?.system_role === "super_admin" ? (
                  <>
                    <Link
                      href="/admin"
                      className={`inline-flex h-10 items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/16 ${
                        isStatusUser ? "shrink-0 whitespace-nowrap px-3.5" : "whitespace-nowrap"
                      }`}
                    >
                      Admin
                    </Link>
                    <Link
                      href="/slabs"
                      className={`inline-flex h-10 items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/16 ${
                        isStatusUser ? "shrink-0 whitespace-nowrap px-3.5" : "whitespace-nowrap"
                      }`}
                    >
                      Slabs
                    </Link>
                  </>
                ) : null}
                <form method="POST" action="/api/auth/logout" className="shrink-0">
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/12 bg-white/5 px-3.5 text-sm font-semibold text-slate-100 transition hover:bg-white/12 whitespace-nowrap"
                  >
                    Log Out
                  </button>
                </form>
              </div>
            </div>
          </div>

        </section>

        <div className="space-y-4">
          <section className="space-y-4">
            <div className="rounded-[30px] border border-[#d9e2ec] bg-white/94 p-4 shadow-[0_24px_70px_rgba(44,29,18,0.10)] backdrop-blur">
              {activeFilterCount ? (
                <div className="mb-1.5 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setFilters(emptyFilters())}
                    className="inline-flex h-8 items-center justify-center rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-semibold text-[#56483f] transition hover:bg-[#fff7f1]"
                  >
                    Clear filters
                  </button>
                </div>
              ) : null}

              <div className={filterGridClass}>
                <div className="col-span-2 min-w-0 lg:col-span-1 lg:max-w-[44rem]">
                  <p className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                    Material Types
                  </p>
                  <div className="flex h-12 snap-x snap-mandatory items-center gap-2 overflow-x-auto whitespace-nowrap rounded-2xl border border-[#d8c7b8] bg-white px-3 py-2 text-sm text-[#2d2623] shadow-sm xl:w-fit [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
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

                <label className="col-span-2 block min-w-0 lg:col-span-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                  Stone / ID #
                  <div className="relative mt-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#b38f76]"
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
                      placeholder="Stone name or #741"
                      className="h-12 w-full rounded-2xl border border-[#d8c7b8] bg-white pl-10 pr-4 text-sm font-medium text-[#2d2623] placeholder:text-[#a5968a] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
                    />
                  </div>
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

                {canStructure ? (
                  <div className="flex items-end justify-center lg:col-span-1">
                    <div className="flex w-12 flex-col items-center">
                      <p className="mb-2 hidden w-full text-center text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355] lg:block">
                        Add
                      </p>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={openCreateEditor}
                          className="peer inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#152238] text-white shadow-[0_14px_30px_rgba(21,34,56,0.18)] transition-all hover:-translate-y-0.5 hover:bg-[#f08b49]"
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
                  const useSideActions = isStatusUser && showStatusActions && !showEditAction;
                  const actionCount = [
                    showAvailableAction,
                    showSoldAction,
                    showHoldAction,
                    showEditAction,
                  ].filter(Boolean).length;
                  const actionColumns =
                    actionCount >= 4 ? "grid-cols-4" : actionCount === 3 ? "grid-cols-3" : actionCount === 2 ? "grid-cols-2" : "grid-cols-1";
                  const actionButtonBaseClass =
                    "inline-flex h-11 items-center justify-center rounded-[18px] border px-3 text-[11px] font-semibold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50";
                  const availableActionClass = `${actionButtonBaseClass} border-emerald-300 bg-emerald-100 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-200`;
                  const holdActionClass = `${actionButtonBaseClass} border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-400 hover:bg-amber-200`;
                  const soldActionClass = `${actionButtonBaseClass} border-rose-300 bg-rose-100 text-rose-800 hover:border-rose-400 hover:bg-rose-200`;
                  const editActionClass = `${actionButtonBaseClass} border-slate-300 bg-slate-100 text-slate-800 hover:border-slate-400 hover:bg-slate-200`;
                  return (
                    <article
                      key={String(remnant.id)}
                      className="group overflow-hidden rounded-[26px] border border-white/30 bg-white/96 shadow-[0_14px_30px_rgba(15,23,39,0.10)] transition-transform [contain-intrinsic-size:430px] [content-visibility:auto] hover:-translate-y-1"
                    >
                      <button type="button" className="block w-full text-left" onClick={() => imageSrc(remnant) && openImageViewer(remnant)}>
                        <div className="relative aspect-[4/3] overflow-hidden bg-[linear-gradient(180deg,#f7efe6_0%,#efe4d7_100%)]">
                          <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-24 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.45),transparent_72%)]" />
                          <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex items-start justify-between gap-2 p-3">
                            <span className="inline-flex items-center rounded-full border border-white/70 bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8c6040] shadow-sm backdrop-blur">
                              ID #{displayRemnantId(remnant)}
                            </span>
                            <span
                              className={`inline-flex max-w-[72%] items-center justify-end rounded-full px-2.5 py-1 text-[10px] font-semibold leading-tight tracking-[0.02em] shadow-sm backdrop-blur ${statusBadgeClass(normalizedStatus)}`}
                            >
                              {statusBadge}
                            </span>
                          </div>
                          {imageSrc(remnant) ? (
                            <img
                              src={imageSrc(remnant)}
                              alt={`Remnant ${displayRemnantId(remnant)}`}
                              className="h-full w-full object-cover transition-transform duration-300 motion-safe:md:group-hover:scale-[1.02]"
                              decoding="async"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-[#f4ece4] text-sm font-semibold uppercase tracking-[0.16em] text-[#9c7355]">
                              No Image
                            </div>
                          )}
                        </div>
                      </button>
                      <div className="space-y-2.5 p-3.5 text-sm text-[#232323]">
                        <div className={`gap-3 ${useSideActions ? "grid grid-cols-[minmax(0,1fr)_108px] items-start" : ""}`}>
                          <div className="space-y-2 rounded-[22px] bg-[#fbf8f4] px-3 py-3 text-[#4d3d34]">
                            <h3 className="text-[15px] font-semibold leading-snug text-[#2d2623]">
                              {cardTitleText(remnant)}
                            </h3>
                            <p className="text-[13px] font-medium text-[#5f4c42]">
                              Size: {cardSizeText(remnant)}
                            </p>
                          </div>
                          {useSideActions ? (
                            <div className="grid gap-2 self-stretch">
                              {showAvailableAction ? (
                                <button
                                  type="button"
                                  disabled={isWorking}
                                  onClick={() => changeRemnantStatus(remnant, "available")}
                                  className={availableActionClass}
                                >
                                  {isWorking ? "Working..." : "Available"}
                                </button>
                              ) : null}
                              {showHoldAction ? (
                                <button
                                  type="button"
                                  onClick={() => openHoldEditor(remnant)}
                                  className={holdActionClass}
                                >
                                  Hold
                                </button>
                              ) : null}
                              {showSoldAction ? (
                                <button
                                  type="button"
                                  disabled={isWorking}
                                  onClick={() => changeRemnantStatus(remnant, "sold")}
                                  className={soldActionClass}
                                >
                                  {isWorking ? "Working..." : "Sell"}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        {showStatusActions && !useSideActions ? (
                          <div className={`grid gap-2 pt-2 ${actionColumns}`}>
                            {showAvailableAction ? (
                              <button
                                type="button"
                                disabled={isWorking}
                                onClick={() => changeRemnantStatus(remnant, "available")}
                                className={availableActionClass}
                              >
                                {isWorking ? "Working..." : "Available"}
                              </button>
                            ) : null}
                            {showHoldAction ? (
                              <button
                                type="button"
                                onClick={() => openHoldEditor(remnant)}
                                className={holdActionClass}
                              >
                                Hold
                              </button>
                            ) : null}
                            {showSoldAction ? (
                              <button
                                type="button"
                                disabled={isWorking}
                                onClick={() => changeRemnantStatus(remnant, "sold")}
                                className={soldActionClass}
                              >
                                {isWorking ? "Working..." : "Sell"}
                              </button>
                            ) : null}
                            {showEditAction ? (
                              <button
                                type="button"
                                onClick={() => openEditEditor(remnant)}
                                className={editActionClass}
                              >
                                Edit
                              </button>
                            ) : null}
                          </div>
                        ) : null}
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
        <div className="mx-auto max-w-[1800px] rounded-[24px] border border-white/60 bg-white/70 px-4 py-5 text-center shadow-sm backdrop-blur sm:rounded-[28px] sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#5b6f87]">Internal Workspace</p>
          <p className="mt-2 text-sm text-[#617286]">Built to keep remnant inventory, hold review, and status updates clear for the team.</p>
        </div>
      </footer>

      {selectedImageRemnant ? (
        <div className="fixed inset-0 z-[73] bg-black/75 px-4 py-6" onClick={closeImageViewer}>
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
                  {selectedImageRemnant.material_name || "Unknown"} · {sizeText(selectedImageRemnant)}
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
            <div className="flex min-h-0 flex-1 items-center justify-center" onClick={(event) => event.stopPropagation()}>
              <img
                src={imageSrc(selectedImageRemnant)}
                alt={`Remnant ${displayRemnantId(selectedImageRemnant)}`}
                className="max-h-full max-w-full rounded-[28px] border border-white/15 bg-white/5 object-contain shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
              />
            </div>
          </div>
        </div>
      ) : null}

      {queueOpen ? (
        <div className="fixed inset-0 z-[71] overflow-y-auto bg-black/50 px-4 py-8">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-white/75 bg-white shadow-[0_24px_70px_rgba(44,29,18,0.10)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e4ebf2] bg-[linear-gradient(135deg,#fffaf6_0%,#f7efe8_100%)] px-6 py-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#5b6f87]">Queue</p>
                  <span className="inline-flex items-center rounded-full border border-[#ecd6c4] bg-white/85 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8d6547]">
                    {holdRequests.length} Pending
                  </span>
                </div>
                <h2 className="mt-1 text-2xl font-semibold text-[#172230]">{workspaceCopy.queueTitle}</h2>
                <p className="mt-2 text-sm text-[#617286]">{workspaceCopy.queueDescription}</p>
              </div>
              <button
                type="button"
                onClick={() => setQueueOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d8c7b8] bg-white text-xl text-[#6d584b] transition hover:bg-[#fff7f1]"
                aria-label="Close request queue"
              >
                {"\u00D7"}
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-6">
              {holdRequests.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-[#d7c4b6] bg-[#fff9f4] px-5 py-10 text-center text-[#6d584b]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9c7355]">No Requests</p>
                  <p className="mt-2 text-sm">There are no hold requests to review right now.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {holdRequests.map((request) => {
                    const isPending = pendingReviewId === String(request.id);
                    const requestRemnant = request.remnant || {};
                    const requestMaterial = requestRemnant.material?.name || requestRemnant.material_name || "Unknown";
                    const requestStoneName = String(requestRemnant.name || "").trim() || "Unnamed";
                    const requestSize = compactSizeText(requestRemnant);
                    const requestMessage = String(request.notes || "").trim();
                    const requestDisplayId =
                      requestRemnant.display_id || requestRemnant.moraware_remnant_id || requestRemnant.id || request.remnant_id;
                    return (
                      <article key={request.id} className={`rounded-[26px] border border-[#eadfd7] bg-[#fffaf6] p-4 shadow-sm ${isPending ? "opacity-60 saturate-75" : ""}`}>
                        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                          <button
                            type="button"
                            onClick={() => imageSrc(requestRemnant) && openImageViewer(requestRemnant)}
                            className="overflow-hidden rounded-[22px] border border-[#eadfd7] bg-[#f6ede5] text-left transition-transform hover:-translate-y-0.5"
                          >
                            {imageSrc(requestRemnant) ? (
                              <img
                                src={imageSrc(requestRemnant)}
                                alt={`Remnant ${requestDisplayId}`}
                                className="h-44 w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-44 items-center justify-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                                No Image
                              </div>
                            )}
                          </button>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-300">
                                    Pending
                                  </span>
                                  <span className="inline-flex items-center rounded-full bg-[#f5ede6] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#956746]">
                                    ID #{requestDisplayId}
                                  </span>
                                </div>
                                <h3 className="mt-2 text-xl font-semibold text-[#2d2623]">
                                  {requestStoneName}
                                </h3>
                                <p className="mt-1 text-sm text-[#7d6759]">
                                  {requestMaterial} · {requestSize}
                                </p>
                              </div>
                              <div className="grid gap-2 text-sm text-[#4d3d34] sm:grid-cols-2">
                                <p><strong>Name:</strong> {request.requester_name || "Unknown"}</p>
                                <p><strong>Email:</strong> {request.requester_email || "Unknown"}</p>
                              </div>
                            </div>

                            <div className="mt-4 rounded-[22px] border border-[#eadfd7] bg-white/85 p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">Customer message</p>
                              <p className="mt-2 text-sm leading-6 text-[#4d3d34]">
                                {requestMessage || "No message provided."}
                              </p>
                            </div>

                            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_160px] lg:items-end">
                              <label className="block text-sm font-medium text-[#4d3d34]">
                                Job Number
                                <div className="mt-1 flex overflow-hidden rounded-2xl border border-[#d8c7b8] bg-white shadow-sm">
                                  <span className="inline-flex items-center border-r border-[#d8c7b8] bg-[#f7f1ea] px-4 text-sm font-semibold text-[#6d584b]">
                                    J
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
                                    className="min-w-0 flex-1 bg-white px-4 py-3 text-sm text-[#2d2623] outline-none"
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
          <div className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-white/75 bg-white shadow-[0_24px_70px_rgba(44,29,18,0.10)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e4ebf2] bg-[linear-gradient(135deg,#fffaf6_0%,#f7efe8_100%)] px-6 py-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#5b6f87]">Holds</p>
                  <span className="inline-flex items-center rounded-full border border-[#ecd6c4] bg-white/85 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8d6547]">
                    {myHolds.length} Active
                  </span>
                </div>
                <h2 className="mt-1 text-2xl font-semibold text-[#172230]">My Holds</h2>
                <p className="mt-2 text-sm text-[#617286]">
                  View the stones currently under your hold, when they expire, and the original requester details.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMyHoldsOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d8c7b8] bg-white text-xl text-[#6d584b] transition hover:bg-[#fff7f1]"
                aria-label="Close my holds"
              >
                {"\u00D7"}
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-6">
              {myHoldsLoading ? (
                <div className="rounded-[24px] border border-dashed border-[#d7c4b6] bg-[#fff9f4] px-5 py-10 text-center text-[#6d584b]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9c7355]">Loading</p>
                  <p className="mt-2 text-sm">Refreshing your active holds.</p>
                </div>
              ) : myHolds.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-[#d7c4b6] bg-[#fff9f4] px-5 py-10 text-center text-[#6d584b]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9c7355]">No Holds</p>
                  <p className="mt-2 text-sm">You do not have any active holds right now.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {myHolds.map((hold) => {
                    const holdRemnant = hold.remnant || {};
                    const holdMaterial = holdRemnant.material_name || holdRemnant.material?.name || "Unknown";
                    const holdStoneName = String(holdRemnant.name || "").trim() || "Unnamed";
                    const holdSize = compactSizeText(holdRemnant);
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
                      <article key={hold.id} className="rounded-[26px] border border-[#eadfd7] bg-[#fffaf6] p-4 shadow-sm">
                        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                          <button
                            type="button"
                            onClick={() => imageSrc(holdRemnant) && openImageViewer(holdRemnant)}
                            className="overflow-hidden rounded-[22px] border border-[#eadfd7] bg-[#f6ede5] text-left transition-transform hover:-translate-y-0.5"
                          >
                            {imageSrc(holdRemnant) ? (
                              <img
                                src={imageSrc(holdRemnant)}
                                alt={`Remnant ${holdDisplayId}`}
                                className="h-44 w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-44 items-center justify-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                                No Image
                              </div>
                            )}
                          </button>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${holdStatusClass}`}>
                                    {holdStatus === "expired" ? "Expired" : "On Hold"}
                                  </p>
                                  <span className="inline-flex items-center rounded-full bg-[#f5ede6] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#956746]">
                                    ID #{holdDisplayId}
                                  </span>
                                </div>
                                <h3 className="mt-2 text-xl font-semibold text-[#2d2623]">
                                  {holdStoneName}
                                </h3>
                                <p className="mt-1 text-sm text-[#7d6759]">
                                  {holdMaterial} · {holdSize}
                                </p>
                              </div>
                              <div className="rounded-[20px] border border-[#eadfd7] bg-white/85 px-4 py-3 text-sm text-[#4d3d34]">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">Expires</p>
                                <p className="mt-1 font-semibold text-[#2d2623]">{formatDateLabel(hold.expires_at)}</p>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                              <div className="rounded-[20px] border border-[#eadfd7] bg-white/85 px-4 py-3 text-sm text-[#4d3d34]">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">Customer</p>
                                <p className="mt-1 break-words font-medium text-[#2d2623]">{requesterName}</p>
                              </div>
                              <div className="rounded-[20px] border border-[#eadfd7] bg-white/85 px-4 py-3 text-sm text-[#4d3d34]">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">Email</p>
                                <p className="mt-1 break-all font-medium text-[#2d2623]">{requesterEmail}</p>
                              </div>
                              <div className="rounded-[20px] border border-[#eadfd7] bg-white/85 px-4 py-3 text-sm text-[#4d3d34]">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">Job</p>
                                <p className="mt-1 font-medium text-[#2d2623]">{hold.job_number ? `J${normalizeJobNumberInput(hold.job_number)}` : "Unknown"}</p>
                              </div>
                              <div className="rounded-[20px] border border-[#eadfd7] bg-white/85 px-4 py-3 text-sm text-[#4d3d34]">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">Status</p>
                                <p className="mt-1 font-medium text-[#2d2623]">{statusText(holdRemnant)}</p>
                              </div>
                            </div>

                            <div className="mt-4 rounded-[22px] border border-[#eadfd7] bg-white/85 p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">Message</p>
                              <p className="mt-2 break-words text-sm leading-6 text-[#4d3d34]">{requesterMessage}</p>
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

      {editorMode && editorForm ? (
        <div className="fixed inset-0 z-[72] overflow-y-auto bg-black/50 px-4 py-8">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-white/70 bg-white shadow-[0_24px_70px_rgba(44,29,18,0.10)]">
            <div className="flex items-center justify-between border-b border-[#eadfd7] bg-[linear-gradient(135deg,#fffaf6_0%,#f7efe8_100%)] px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[#8a6a54]">Inventory</p>
                <h2 className="text-2xl font-semibold text-[#2c211c]">{editorMode === "create" ? "Add Remnant" : "Edit Remnant"}</h2>
                <p className="mt-1 text-sm text-[#7d6759]">
                  Upload, crop, and save the remnant image alongside the core dimensions.
                </p>
              </div>
              <button type="button" onClick={closeEditor} className="h-10 w-10 rounded-full border border-gray-300 text-xl transition-colors active:bg-gray-200">
                {"\u00D7"}
              </button>
            </div>
            <form onSubmit={saveEditor} className="grid gap-4 p-6 md:grid-cols-2">
              <div className="md:col-span-2 grid gap-4 rounded-[28px] border border-[#eadfd7] bg-[linear-gradient(135deg,#fffbf8_0%,#f8efe7_100%)] p-4 lg:grid-cols-[minmax(0,1.15fr)_320px]">
                <div className="overflow-hidden rounded-[24px] border border-white/80 bg-white shadow-[0_16px_38px_rgba(44,29,18,0.08)]">
                  {editorForm.image_preview ? (
                    <img
                      src={editorForm.image_preview}
                      alt="Remnant preview"
                      className="h-72 w-full bg-[#f4ece4] object-contain"
                    />
                  ) : (
                    <div className="flex h-72 items-center justify-center bg-[linear-gradient(135deg,#f4e7db_0%,#efe2d4_100%)] px-6 text-center text-sm font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                      Add an image to preview and crop it here
                    </div>
                  )}
                </div>
                <div className="flex flex-col justify-between gap-4 rounded-[24px] border border-[#eadfd7] bg-white/80 p-5">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9c7355]">Image Tools</p>
                    <h3 className="mt-2 text-xl font-semibold text-[#2c211c]">
                      {editorMode === "create" ? "Prepare the new card image" : "Refresh the card image"}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[#6d584b]">
                      Load a photo, crop the clean frame you want, then save the remnant when everything looks right.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-gray-700">
                      Choose image
                      <input
                        ref={editorImageInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleEditorImageChange}
                        className="mt-2 block w-full rounded-2xl border border-[#d8c7b8] bg-white px-4 py-3 text-sm text-[#2d2623] file:mr-4 file:rounded-full file:border-0 file:bg-[#152238] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                      />
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={openCropEditor}
                        disabled={!editorForm.image_preview}
                        className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#152238] px-5 text-sm font-semibold text-white transition hover:bg-[#f08b49] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Crop Image
                      </button>
                      <button
                        type="button"
                        onClick={resetEditorImage}
                        disabled={!editorForm.image_preview && !editorForm.original_image_preview}
                        className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d8c7b8] bg-white px-5 text-sm font-semibold text-[#56483f] transition hover:bg-[#fff7f1] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Reset Image
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <label className="block text-sm font-medium text-gray-700">
                Stone ID #
                <input
                  type="number"
                  value={editorForm.moraware_remnant_id}
                  onChange={(event) => updateEditorField("moraware_remnant_id", event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Stone Name
                <input
                  type="text"
                  value={editorForm.name}
                  onChange={(event) => updateEditorField("name", event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Company
                <select
                  value={String(editorForm.company_id ?? "")}
                  onChange={(event) => updateEditorField("company_id", event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                >
                  <option value="">Select company</option>
                  {lookups.companies.map((row) => (
                    <option key={row.id} value={String(row.id)}>{row.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Material
                <select
                  value={String(editorForm.material_id ?? "")}
                  onChange={(event) => updateEditorField("material_id", event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                >
                  <option value="">Select material</option>
                  {lookups.materials.map((row) => (
                    <option key={row.id} value={String(row.id)}>{row.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Width
                <input
                  type="number"
                  value={editorForm.width}
                  onChange={(event) => updateEditorField("width", event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Height
                <input
                  type="number"
                  value={editorForm.height}
                  onChange={(event) => updateEditorField("height", event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Thickness
                <select
                  value={String(editorForm.thickness_id ?? "")}
                  onChange={(event) => updateEditorField("thickness_id", event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                >
                  <option value="">Select thickness</option>
                  {lookups.thicknesses.map((row) => (
                    <option key={row.id} value={String(row.id)}>{row.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={Boolean(editorForm.l_shape)}
                  onChange={(event) => updateEditorField("l_shape", event.target.checked)}
                />
                L-Shape
              </label>
              {editorForm.l_shape ? (
                <>
                  <label className="block text-sm font-medium text-gray-700">
                    L Width
                    <input
                      type="number"
                      value={editorForm.l_width}
                      onChange={(event) => updateEditorField("l_width", event.target.value)}
                      className="mt-1 w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
                    />
                  </label>
                  <label className="block text-sm font-medium text-gray-700">
                    L Height
                    <input
                      type="number"
                      value={editorForm.l_height}
                      onChange={(event) => updateEditorField("l_height", event.target.value)}
                      className="mt-1 w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
                    />
                  </label>
                </>
              ) : null}
              <div className="md:col-span-2 flex flex-wrap gap-3 pt-2">
                <button type="submit" className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#152238] px-6 text-sm font-semibold text-white transition hover:bg-[#f08b49]">
                  {editorMode === "create" ? "Create Remnant" : "Save Changes"}
                </button>
                {editorMode === "edit" ? (
                  <button type="button" onClick={archiveEditorRemnant} className="inline-flex h-12 items-center justify-center rounded-2xl border border-stone-300 bg-stone-100 px-6 text-sm font-semibold text-stone-900 transition hover:bg-stone-200">
                    Archive
                  </button>
                ) : null}
                <button type="button" onClick={closeEditor} className="inline-flex h-12 items-center justify-center rounded-2xl border border-gray-300 bg-white px-6 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {cropModal ? (
        <div className="fixed inset-0 z-[73] overflow-y-auto bg-black/60 px-4 py-8">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-[32px] border border-white/20 bg-[#fff9f4] shadow-[0_30px_80px_rgba(0,0,0,0.28)]">
            <div className="flex items-center justify-between border-b border-[#eadfd7] bg-[linear-gradient(135deg,#fffaf6_0%,#f7efe8_100%)] px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[#8a6a54]">Crop Workspace</p>
                <h2 className="text-2xl font-semibold text-[#2c211c]">Free Crop</h2>
                <p className="mt-1 text-sm text-[#7d6759]">Drag the image, move the frame, resize the corners, or rotate before saving.</p>
              </div>
              <button type="button" onClick={closeCropEditor} className="h-10 w-10 rounded-full border border-gray-300 text-xl transition-colors active:bg-gray-200">
                {"\u00D7"}
              </button>
            </div>
            <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-hidden rounded-[28px] border border-[#eadfd7] bg-[linear-gradient(180deg,#f4eadf_0%,#efe3d6_100%)] p-4 shadow-inner">
                <canvas
                  ref={cropCanvasRef}
                  width={CROP_CANVAS_WIDTH}
                  height={CROP_CANVAS_HEIGHT}
                  onPointerDown={handleCropPointerDown}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={endCropPointerDrag}
                  onPointerLeave={endCropPointerDrag}
                  className="h-auto w-full cursor-grab rounded-[24px] border border-white/80 bg-[#efe4d8] shadow-[0_18px_40px_rgba(44,29,18,0.08)]"
                />
              </div>
              <div className="space-y-4 rounded-[28px] border border-[#eadfd7] bg-white p-5 shadow-[0_18px_40px_rgba(44,29,18,0.08)]">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9c7355]">Controls</p>
                  <h3 className="mt-2 text-xl font-semibold text-[#2c211c]">Rotate and fine-tune</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-2xl border border-[#eadfd7] bg-[#fff9f4] px-4 py-3">
                    <span className="text-sm font-medium text-[#6f594a]">Rotation</span>
                    <span className="rounded-full border border-[#e7d4c4] bg-white px-3 py-1 text-sm font-semibold text-[#6f594a]">
                      {formatCropRotationLabel((cropModal.rotationBase || 0) + (cropModal.rotation || 0))}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => updateCropModal((current) => ({ ...current, rotationBase: current.rotationBase - 90 }))}
                      className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-semibold text-[#56483f] transition hover:bg-[#fff7f1]"
                    >
                      Rotate Left
                    </button>
                    <button
                      type="button"
                      onClick={() => updateCropModal((current) => ({ ...current, rotationBase: current.rotationBase + 90 }))}
                      className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl border border-[#d8c7b8] bg-white px-4 text-sm font-semibold text-[#56483f] transition hover:bg-[#fff7f1]"
                    >
                      Rotate Right
                    </button>
                  </div>
                  <label className="block text-sm font-medium text-[#6f594a]">
                    Fine rotation
                    <input
                      type="range"
                      min="-45"
                      max="45"
                      value={cropModal.rotation}
                      onChange={(event) => updateCropModal((current) => ({ ...current, rotation: Number(event.target.value || 0) }))}
                      className="mt-3 w-full accent-[#f08b49]"
                    />
                  </label>
                </div>
                <div className="rounded-2xl border border-[#eadfd7] bg-[#fff9f4] p-4 text-sm leading-6 text-[#6d584b]">
                  Move image:
                  Click and drag outside the crop frame.
                  Move crop:
                  Drag inside the frame.
                  Resize:
                  Drag one of the orange corner handles.
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
                    className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d8c7b8] bg-white px-5 text-sm font-semibold text-[#56483f] transition hover:bg-[#fff7f1]"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={saveCropEditor}
                    className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#152238] px-5 text-sm font-semibold text-white transition hover:bg-[#f08b49]"
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
          <div className="mx-auto max-w-4xl overflow-hidden rounded-[32px] border border-white/75 bg-white shadow-[0_24px_70px_rgba(44,29,18,0.10)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#eadfd7] bg-[linear-gradient(135deg,#fffaf6_0%,#f7efe8_100%)] px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[#8a6a54]">Hold</p>
                <h2 className="text-2xl font-semibold text-[#2c211c]">Manage Hold</h2>
                <p className="mt-1 text-sm text-[#7d6759]">{holdEditor.remnantLabel}</p>
              </div>
              <button type="button" onClick={closeHoldEditor} className="h-10 w-10 rounded-full border border-gray-300 text-xl transition-colors active:bg-gray-200">
                {"\u00D7"}
              </button>
            </div>
            <form onSubmit={saveHoldEditor} className="p-6">
              <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-[24px] border border-[#eadfd7] bg-[#f6ede5]">
                    {imageSrc(holdEditor.remnant || {}) ? (
                      <img
                        src={imageSrc(holdEditor.remnant || {})}
                        alt={`Remnant ${displayRemnantId(holdEditor.remnant || {})}`}
                        className="h-52 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-52 items-center justify-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                        No Image
                      </div>
                    )}
                  </div>
                  <div className="rounded-[24px] border border-[#eadfd7] bg-[#fffaf6] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-[#f5ede6] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#956746]">
                        ID #{displayRemnantId(holdEditor.remnant || {})}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-[#f5ede6] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#956746]">
                        {(holdEditor.remnant || {}).material_name || "Unknown"}
                      </span>
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-[#2d2623]">
                      {String(holdEditor.remnant?.name || "").trim() || "Unnamed"}
                    </h3>
                    <p className="mt-1 text-sm text-[#7d6759]">
                      {compactSizeText(holdEditor.remnant || {})}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">Hold Details</p>
                    <span className="rounded-full bg-[#f5ede6] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#956746]">
                      {holdEditor.holdId ? "Existing Hold" : "New Hold"}
                    </span>
                  </div>
                  <div className="mt-3 rounded-[24px] border border-[#eadfd7] bg-[#fbf5ef] px-4 py-4 text-sm text-[#6f594a]">
                    {holdEditor.summary}
                  </div>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7355]">
                    All holds expire automatically after 7 days.
                  </p>
                  {holdEditor.locked_to_other_owner ? (
                    <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      This hold belongs to {holdEditor.current_owner_name || "another sales rep"}. Only that sales rep or a manager can change it.
                    </div>
                  ) : null}

                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {holdEditor.self_only ? (
                      <label className="block text-sm font-medium text-gray-700 lg:col-span-2">
                        Sales Rep
                        <div className="mt-1 flex min-h-12 items-center rounded-2xl border border-gray-300 bg-[#f7f1ea] px-4 py-3 text-sm text-[#4d3d34]">
                          {profileDisplayName(profile)}
                        </div>
                      </label>
                    ) : (
                      <label className="block text-sm font-medium text-gray-700 lg:col-span-2">
                        Sales Rep
                        <select
                          value={holdEditor.owner_user_id}
                          onChange={(event) => updateHoldField("owner_user_id", event.target.value)}
                          disabled={salesReps.length === 0}
                          className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                        >
                          <option value="">
                            {salesReps.length === 0 ? "No active sales reps available" : "Select sales rep"}
                          </option>
                          {salesReps.map((row) => (
                            <option key={row.id} value={row.id}>{row.display_name || row.full_name || row.email || "User"}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="block text-sm font-medium text-gray-700">
                      Customer Name
                      <input
                        type="text"
                        value={holdEditor.customer_name}
                        onChange={(event) => updateHoldField("customer_name", event.target.value)}
                        required
                        disabled={holdEditor.locked_to_other_owner}
                        placeholder="Customer name"
                        className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                      />
                    </label>
                    <label className="block text-sm font-medium text-gray-700">
                      Job Number
                      <div className="mt-1 flex overflow-hidden rounded-2xl border border-gray-300 bg-white">
                        <span className="inline-flex items-center border-r border-gray-300 bg-[#f7f1ea] px-4 text-sm font-semibold text-[#6d584b]">
                          J
                        </span>
                        <input
                          type="text"
                          value={holdEditor.job_number}
                          onChange={(event) => updateHoldField("job_number", normalizeJobNumberInput(event.target.value))}
                          required
                          disabled={holdEditor.locked_to_other_owner}
                          placeholder="1234"
                          className="min-w-0 flex-1 bg-white px-4 py-3 text-sm outline-none"
                        />
                      </div>
                    </label>
                    <label className="block text-sm font-medium text-gray-700 lg:col-span-2">
                      Hold Notes
                      <textarea
                        rows="4"
                        value={holdEditor.notes}
                        onChange={(event) => updateHoldField("notes", event.target.value)}
                        disabled={holdEditor.locked_to_other_owner}
                        className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                        placeholder="Optional notes for the team"
                      />
                    </label>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <button type="submit" disabled={holdEditor.locked_to_other_owner} className="inline-flex h-12 items-center justify-center rounded-2xl border border-amber-200 bg-amber-100 px-6 text-sm font-semibold text-amber-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50">
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
                    <button type="button" onClick={closeHoldEditor} className="inline-flex h-12 items-center justify-center rounded-2xl border border-[#d8c7b8] bg-white px-6 text-sm font-semibold text-[#6d584b] transition hover:border-[#E78B4B]">
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
          <div className="mx-auto max-w-2xl overflow-hidden rounded-[32px] border border-white/75 bg-white shadow-[0_24px_70px_rgba(44,29,18,0.10)]">
            <div className="flex items-center justify-between border-b border-[#eadfd7] bg-[linear-gradient(135deg,#fffaf6_0%,#f7efe8_100%)] px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[#8a6a54]">Sold Workspace</p>
                <h2 className="text-2xl font-semibold text-[#2c211c]">Mark as sold</h2>
                <p className="mt-1 text-sm text-[#7d6759]">{soldEditor.remnantLabel}</p>
              </div>
              <button type="button" onClick={closeSoldEditor} className="h-10 w-10 rounded-full border border-gray-300 text-xl transition-colors active:bg-gray-200">
                {"\u00D7"}
              </button>
            </div>
            <form onSubmit={saveSoldEditor} className="p-6">
              <div className="grid grid-cols-1 gap-3">
                {soldEditor.self_only ? (
                  <label className="block text-sm font-medium text-gray-700">
                    Sales Rep
                    <div className="mt-1 flex min-h-12 items-center rounded-2xl border border-gray-300 bg-[#f7f1ea] px-4 py-3 text-sm text-[#4d3d34]">
                      {profileDisplayName(profile)}
                    </div>
                  </label>
                ) : (
                  <label className="block text-sm font-medium text-gray-700">
                    Sales Rep
                    <select
                      value={soldEditor.sold_by_user_id}
                      onChange={(event) => updateSoldField("sold_by_user_id", event.target.value)}
                      required
                      disabled={salesReps.length === 0}
                      className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                    >
                      <option value="">
                        {salesReps.length === 0 ? "No active sales reps available" : "Select sales rep"}
                      </option>
                      {salesReps.map((row) => (
                        <option key={row.id} value={row.id}>{row.display_name || row.full_name || row.email || "User"}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block text-sm font-medium text-gray-700">
                  Job Number
                  <div className="mt-1 flex overflow-hidden rounded-2xl border border-gray-300 bg-white">
                    <span className="inline-flex items-center border-r border-gray-300 bg-[#f7f1ea] px-4 text-sm font-semibold text-[#6d584b]">
                      J
                    </span>
                    <input
                      type="text"
                      value={soldEditor.job_number}
                      onChange={(event) => updateSoldField("job_number", normalizeJobNumberInput(event.target.value))}
                      required
                      placeholder="1234"
                      className="min-w-0 flex-1 bg-white px-4 py-3 text-sm outline-none"
                    />
                  </div>
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Sold Notes
                  <textarea
                    rows="3"
                    value={soldEditor.notes}
                    onChange={(event) => updateSoldField("notes", event.target.value)}
                    className="mt-1 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm"
                    placeholder="Optional notes"
                  />
                </label>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="submit" className="inline-flex h-12 items-center justify-center rounded-2xl border border-rose-200 bg-rose-100 px-6 text-sm font-semibold uppercase tracking-[0.08em] text-rose-800 transition hover:bg-rose-200">
                  Save Sold
                </button>
                <button type="button" onClick={closeSoldEditor} className="inline-flex h-12 items-center justify-center rounded-2xl border border-[#d8c7b8] bg-white px-6 text-sm font-semibold text-[#6d584b] transition hover:border-[#E78B4B]">
                  Cancel
                </button>
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
