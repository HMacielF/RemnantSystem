const LIVE_SEARCH_DELAY_MS = 300;
window.__REMNANT_APP_VERSION__ = "2026-04-02-hold-request-fix-6";
window.__holdRequestNativePending = false;

let allRemnants = [];
let debounceTimer = null;
let activeAbortController = null;
const isManagementView = document.body?.dataset?.view === "management";
let activeRemnantId = null;
let lookupData = {
    companies: [],
    materials: [],
    thicknesses: [],
};
let salesRepData = [];
let currentProfile = null;
let nextStoneId = null;
let activeHoldRequestRemnant = null;
let salesRepLoadPromise = null;
let holdRequestsData = [];
let activeQuickHoldRemnantId = null;
let activeManageHoldRemnantId = null;
let activeSoldRemnantId = null;
let activeSoldSource = "card";
let inventorySummary = {
    total: 0,
    available: 0,
    hold: 0,
    sold: 0,
};
const PUBLIC_MATERIAL_TYPES = [
    "Granite",
    "Marble",
    "Porcelain",
    "Quartz",
    "Quartzite",
    "Quick Quartz",
    "Soapstone",
];
const MAX_BROWSER_IMAGE_PIXELS = 16_000_000;
const pendingImagePayloads = {
    add: null,
    edit: null,
};
const cropState = {
    prefix: null,
    source: "",
    fileName: "cropped-image.jpg",
    contentType: "image/jpeg",
    image: null,
    baseScale: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    dragMode: null,
    activeHandle: null,
    rotationBase: 0,
    rotation: 0,
    cropRect: {
        x: 120,
        y: 90,
        width: 720,
        height: 540,
    },
};

// This single runtime powers both the public inventory page and the private
// management workspace. The branching looks heavy in places, but the upside is
// that both pages stay visually and behaviorally aligned instead of drifting
// into two unrelated apps.

// The UI now has a few summary panels above the cards. We keep their state
// derived from the fetched remnants instead of storing duplicate counters.
const STATUS_META = {
    available: {
        label: "Available",
        chipClass: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
    },
    hold: {
        label: "On Hold",
        chipClass: "bg-amber-100 text-amber-900 ring-1 ring-amber-200",
    },
    sold: {
        label: "Sold",
        chipClass: "bg-rose-100 text-rose-800 ring-1 ring-rose-200",
    },
};

// Read the current URL every time instead of caching it so filters stay in sync
// with the browser address bar during live updates.
function currentParams() {
    return new URLSearchParams(window.location.search);
}

// Card text can contain user-entered names from the database. Escaping keeps
// the generated markup safe while still letting us build cards with template
// strings for readability.
function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function displayText(value, fallback = "Unknown") {
    const trimmed = String(value ?? "").trim();
    return trimmed || fallback;
}

function prettyDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

function prettyDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function defaultHoldExpirationInputValue() {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date.toISOString().slice(0, 10);
}

function holdSummaryLines(remnant) {
    // Cards only show the most immediately useful hold details. Deeper context
    // like notes and full ownership controls lives in the hold modal/inbox.
    const hold = remnant.current_hold;
    if (!hold) return [];

    const lines = [];
    const jobNumber = String(hold.job_number || "").trim();
    const jobSuffix = jobNumber ? ` - J#${jobNumber}` : "";
    if (hold.status === "active") {
        lines.push(`until ${prettyDate(hold.expires_at) || "Unknown date"}${jobSuffix}`);
    } else if (hold.status === "expired") {
        lines.push(`expired on ${prettyDate(hold.expires_at) || "Unknown date"}${jobSuffix}`);
    }
    return lines;
}

function statusDetailLines(remnant) {
    // Management cards get one extra status-specific line so the grid remains
    // easy to scan without opening every modal.
    const status = String(remnant?.status || "").trim().toLowerCase();

    if (status === "hold") {
        return holdSummaryLines(remnant).map((line, index) => ({
            label: index === 0 ? "Hold" : "",
            value: line,
        }));
    }

    if (status === "sold") {
        const jobNumber = String(remnant?.sold_job_number || "").trim();
        return [{
            label: "Sold",
            value: `on ${prettyDate(remnant?.sold_at) || "Unknown date"}${jobNumber ? ` - J#${jobNumber}` : ""}`,
        }];
    }

    return [];
}

// The backend stores compact status values, but the UI reads better with
// friendlier labels. This helper keeps that conversion in one place.
function normalizeStatus(value) {
    const normalized = String(value || "").trim().toLowerCase();

    if (!normalized || normalized === "available") return "Available";
    if (normalized === "hold" || normalized === "on hold") return "On Hold";
    if (normalized === "sold") return "Sold";

    return String(value || "Available").trim();
}

function statusText(remnant) {
    return normalizeStatus(remnant?.status);
}

// Cards, buttons, and badges all use the same visual language for statuses.
// Centralizing the classes here keeps the markup cleaner later.
function statusBadgeClass(status) {
    const lc = status.toLowerCase();
    if (lc === "sold") return "bg-rose-100 text-rose-800 ring-1 ring-rose-300";
    if (lc === "on hold") return "bg-amber-100 text-amber-900 ring-1 ring-amber-300";
    return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300";
}

// Structural edits are intentionally limited to higher roles. We still show the
// management page to status users for status changes, but the heavier actions
// should disappear consistently.
function canManageStructure() {
    const role = currentProfile?.system_role;
    return role === "super_admin" || role === "manager";
}

function isPrivilegedProfile(profile) {
    const role = profile?.system_role;
    return role === "super_admin" || role === "manager";
}

function isOwnCompanyStatusUser(profile, remnant) {
    return profile?.system_role === "status_user"
        && profile?.company_id !== null
        && Number(profile.company_id) === Number(remnant?.company_id);
}

function isStatusUserView() {
    return isManagementView && currentProfile?.system_role === "status_user";
}

function canStatusUserManageRemnant(remnant) {
    return isStatusUserView() && isOwnCompanyStatusUser(currentProfile, remnant);
}

function canCurrentUserControlHold(remnant) {
    // status_user permissions depend on both company ownership and hold
    // ownership. This helper keeps that rule in one place for the card UI.
    const hold = remnant?.current_hold;
    if (!hold || !["active", "expired"].includes(String(hold.status || "").toLowerCase())) {
        return canStatusUserManageRemnant(remnant);
    }

    if (isPrivilegedProfile(currentProfile)) return true;
    return String(hold.hold_owner_user_id || "") === String(currentProfile?.id || "");
}

function currentStatusActor(remnant) {
    return remnant?.current_status_actor || null;
}

function currentStatusActorName(remnant, fallback = "sales rep") {
    const soldByName = String(remnant?.sold_by_name || "").trim();
    if (soldByName) return soldByName;

    const actor = currentStatusActor(remnant);
    const name = String(actor?.actor_name || "").trim();
    return name || fallback;
}

// Materials come from the database, so the checkbox list is rebuilt after the
// lookup payload arrives. We also re-read the current query string so checked
// states survive refreshes and live filtering.
function renderMaterialCheckboxes() {
    const selected = new Set(currentParams().getAll("material"));
    const container = document.getElementById("material-checkboxes");
    if (!container) return;

    const materials = isManagementView
        ? lookupData.materials
        : PUBLIC_MATERIAL_TYPES.map((name) => ({ id: name, name }));

    container.innerHTML = materials.map((material) => `
        <label class="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:border-[#ead8ca] hover:bg-[#fff7f1]">
            <input type="checkbox" name="material" value="${material.id}" ${selected.has(String(material.id)) ? "checked" : ""}>
            ${material.name}
        </label>
    `).join("");
}

// The add/edit forms share the same lookup sources. This helper lets us fill
// any select by ID while preserving the current selection if one already exists.
function renderSelectOptions(selectId, rows, placeholder) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = `
        <option value="">${placeholder}</option>
        ${rows.map((row) => `<option value="${row.id}">${row.name}</option>`).join("")}
    `;

    if (currentValue) select.value = currentValue;
}

function renderSalesRepOptions(selectId, rows, placeholder) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = `
        <option value="">${placeholder}</option>
        ${rows.map((row) => `<option value="${row.id}">${row.display_name || row.full_name || row.email || "User"}</option>`).join("")}
    `;
    if (currentValue) select.value = currentValue;
}

function renderWelcomeUser() {
    const target = document.getElementById("welcome-user");
    if (!target) return;

    const preferredName = currentProfile?.full_name?.trim()
        || currentProfile?.email?.split("@")[0]
        || "User";

    target.textContent = `WELCOME, ${String(preferredName).toUpperCase()}`;
}

function renderHoldRequests() {
    const container = document.getElementById("hold-requests-list");
    if (!container) return;

    if (!holdRequestsData.length) {
        container.innerHTML = `
            <div class="rounded-[24px] border border-dashed border-[#d7c4b6] bg-[#fff9f4] px-5 py-8 text-center text-[#6d584b]">
                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9c7355]">No Requests</p>
                <p class="mt-2 text-sm">There are no hold requests to review right now.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = holdRequestsData.map((request) => {
        const repName = request.sales_rep?.full_name || request.sales_rep?.email || "Unassigned";
        const reviewedBy = request.reviewed_by?.full_name || request.reviewed_by?.email || "";
        const remnantId = request.remnant?.moraware_remnant_id || request.remnant?.id || request.remnant_id;
        const remnantName = request.remnant?.name || "Remnant";
        return `
            <article class="rounded-[24px] border border-[#eadfd7] bg-[#fffaf6] p-5 shadow-sm">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9c7355]">${escapeHtml(request.status || "pending")}</p>
                        <h3 class="mt-1 text-lg font-semibold text-[#2d2623]">Remnant #${escapeHtml(remnantId)} - ${escapeHtml(remnantName)}</h3>
                        <p class="mt-1 text-sm text-[#6d584b]">${escapeHtml(request.requester_name)} · ${escapeHtml(request.requester_email)}</p>
                    </div>
                    <div class="rounded-full bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#8f5a36] shadow-sm">
                        ${escapeHtml(prettyDateTime(request.created_at) || "Just now")}
                    </div>
                </div>
                <div class="mt-4 grid gap-2 text-sm text-[#4d3d34] sm:grid-cols-2">
                    <p><strong>Sales Rep:</strong> ${escapeHtml(repName)}</p>
                    <p><strong>Project:</strong> ${escapeHtml(request.project_reference || "Not provided")}</p>
                    <p><strong>Notes:</strong> ${escapeHtml(request.notes || "Not provided")}</p>
                    <label class="block">
                        <strong>Job Number:</strong>
                        <input
                            type="text"
                            data-request-job-number="${request.id}"
                            value="${escapeHtml(request.job_number || "")}"
                            placeholder="Required for approval"
                            class="mt-1 w-full rounded-2xl border border-[#d8c7b8] bg-white px-4 py-2.5 text-sm text-[#2d2623] shadow-sm outline-none transition focus:border-[#E78B4B] focus:ring-4 focus:ring-[#E78B4B]/10"
                        />
                    </label>
                </div>
                ${String(request.status || "").toLowerCase() === "pending" ? `
                    <div class="mt-4 grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            data-hold-request-action="approved"
                            data-hold-request-id="${request.id}"
                            class="rounded-2xl bg-emerald-100 text-emerald-800 py-3 text-sm font-semibold border border-emerald-200 transition-colors active:bg-emerald-200"
                        >
                            Approve
                        </button>
                        <button
                            type="button"
                            data-hold-request-action="rejected"
                            data-hold-request-id="${request.id}"
                            class="rounded-2xl bg-rose-100 text-rose-800 py-3 text-sm font-semibold border border-rose-200 transition-colors active:bg-rose-200"
                        >
                            Deny
                        </button>
                    </div>
                ` : ""}
                ${reviewedBy ? `<p class="mt-3 text-xs text-[#8a6a54]">Reviewed by ${escapeHtml(reviewedBy)}.</p>` : ""}
            </article>
        `;
    }).join("");
}

function renderHoldRequestCount() {
    const badge = document.getElementById("hold-requests-count");
    if (!badge) return;

    const count = holdRequestsData.length;
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
}

function cropCanvas() {
    return document.getElementById("crop-canvas");
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

// The management UI is permission-aware. Instead of sprinkling conditionals
// everywhere, we enable/disable whole sections from one function.
function applyRoleVisibility() {
    if (!isManagementView) return;

    const addButton = document.getElementById("open-add-remnant");
    const modifyButton = document.getElementById("edit-modify");
    const deleteButton = document.getElementById("edit-delete");
    const editImageInput = document.getElementById("edit-image-file");
    const editCropButton = document.getElementById("edit-open-crop");
    const addCropButton = document.getElementById("add-open-crop");
    const holdOwnerSelect = document.getElementById("edit-hold-owner");
    const editForm = document.getElementById("edit-remnant-form");
    const addForm = document.getElementById("add-remnant-form");
    const structureAllowed = canManageStructure();

    if (addButton) addButton.classList.toggle("hidden", !structureAllowed);
    if (modifyButton) modifyButton.classList.toggle("hidden", !structureAllowed);
    if (deleteButton) deleteButton.classList.toggle("hidden", !structureAllowed);
    if (editCropButton) editCropButton.classList.toggle("hidden", !structureAllowed);
    if (addCropButton) addCropButton.classList.toggle("hidden", !structureAllowed);
    if (editImageInput) editImageInput.disabled = !structureAllowed;
    if (holdOwnerSelect) holdOwnerSelect.disabled = !structureAllowed;

    if (editForm) {
        editForm.querySelectorAll("input, select").forEach((field) => {
            if (field.id === "edit-id" || field.id === "edit-image-file") return;
            if (field.id === "edit-l-shape") return;
            field.disabled = !structureAllowed;
        });
    }

    ["edit-l-shape-toggle", "add-l-shape-toggle"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !structureAllowed;
    });

    if (addForm) {
        addForm.querySelectorAll("input, select, button").forEach((field) => {
            field.disabled = !structureAllowed;
        });
    }
}

// Filters are reflected into the URL so people can refresh or share a filtered
// view. This function hydrates the form back from those params.
function initFormFromURL() {
    const params = currentParams();
    const stone = document.getElementById("stone-filter");
    const minWidth = document.getElementById("min-width");
    const minHeight = document.getElementById("min-height");
    const status = document.getElementById("status-filter");

    if (stone) stone.value = params.get("stone") || "";
    if (minWidth) minWidth.value = params.get("min-width") || "";
    if (minHeight) minHeight.value = params.get("min-height") || "";
    if (status) status.value = (params.get("status") || "").toLowerCase();
}

// Build the query string from whatever the user currently has filled in. Empty
// values are skipped so the URL stays short and readable.
function buildQueryFromForm(form) {
    const formData = new FormData(form);
    const query = new URLSearchParams();

    for (const [key, value] of formData.entries()) {
        const trimmed = String(value).trim();
        if (!trimmed) continue;
        query.append(key, trimmed);
    }

    return query;
}

function statusKey(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "on hold") return "hold";
    if (normalized === "sold") return "sold";
    return "available";
}

// L-shaped remnants need a slightly different measurement string than simple
// rectangles, so we keep the formatting logic in one spot.
function sizeText(remnant) {
    if (remnant.l_shape) {
        return `${remnant.width} x ${remnant.height} + ${remnant.l_width} x ${remnant.l_height}`;
    }
    return `${remnant.width} x ${remnant.height}`;
}

function imageSrc(remnant) {
    return remnant.image || remnant.source_image_url || "";
}

// The public-facing ID should be the Moraware/Systemize value when it exists.
// Internal database IDs remain a fallback for manual rows.
function displayRemnantId(remnant) {
    return remnant.display_id || remnant.moraware_remnant_id || remnant.id;
}

function internalRemnantId(remnant) {
    return remnant.internal_remnant_id || null;
}

// "unknown" thickness is useful as a database fallback but noisy in the card
// UI, so we hide it unless we have a real value to show.
function hasKnownThickness(remnant) {
    const thickness = String(remnant.thickness_name || remnant.thickness?.name || "").trim().toLowerCase();
    return Boolean(thickness) && thickness !== "unknown";
}

function cardDetail(label, value) {
    if (!label) return `<p>${escapeHtml(value)}</p>`;
    return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

function defaultSummaryCounts() {
    return {
        total: 0,
        available: 0,
        hold: 0,
        sold: 0,
    };
}

function summaryCounts(remnants) {
    return remnants.reduce((acc, remnant) => {
        const key = statusKey(remnant.status);
        acc.total += 1;
        acc[key] += 1;
        return acc;
    }, defaultSummaryCounts());
}

// The top summary gives a quick operational read before someone even scans the
// cards. That matters a lot on the management page where the user is deciding
// what needs attention first.
function renderInventorySummary() {
    const target = document.getElementById("inventory-summary");
    if (!target) return;
    target.innerHTML = "";
}

function renderStatusSummary() {
    const container = document.getElementById("status-summary");
    if (!container) return;

    const activeStatus = String(currentParams().get("status") || "").trim().toLowerCase();

    const counts = inventorySummary;
    container.innerHTML = Object.entries(STATUS_META).map(([key, meta]) => `
        <button
            type="button"
            data-status-chip="${key}"
            aria-pressed="${activeStatus === key}"
            class="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-[#4d3d34] shadow-sm ring-1 transition-all ${
                activeStatus === key
                    ? "bg-[#232323] text-white ring-[#232323]"
                    : "bg-white/80 ring-white/80 hover:-translate-y-0.5 hover:bg-white"
            }"
        >
            <span class="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${meta.chipClass}">
                ${meta.label}
            </span>
            <span class="font-semibold">${counts[key]}</span>
        </button>
    `).join("");
}

function loadingMarkup() {
    return Array.from({ length: 4 }).map(() => `
        <div class="overflow-hidden rounded-[26px] border border-white/80 bg-white/70 shadow-[0_18px_40px_rgba(58,37,22,0.07)]">
            <div class="h-52 animate-pulse bg-[linear-gradient(90deg,#f3ebe4,#ece1d7,#f3ebe4)]"></div>
            <div class="space-y-3 p-4">
                <div class="h-4 w-24 animate-pulse rounded-full bg-[#efe2d7]"></div>
                <div class="h-4 w-3/4 animate-pulse rounded-full bg-[#f4e9df]"></div>
                <div class="h-4 w-2/3 animate-pulse rounded-full bg-[#f4e9df]"></div>
                <div class="h-4 w-1/2 animate-pulse rounded-full bg-[#f4e9df]"></div>
            </div>
        </div>
    `).join("");
}

function buildRemnantCardMarkup(remnant, status, index = 0) {
    const image = imageSrc(remnant);
    const displayCompany = displayText(remnant.company_name || remnant.company?.name);
    const displayMaterial = displayText(remnant.material_name || remnant.material?.name);
    const displayStoneName = displayText(remnant.name);
    const displayThickness = displayText(remnant.thickness_name || remnant.thickness?.name);
    const displayId = displayRemnantId(remnant);
    const statusLines = isManagementView ? statusDetailLines(remnant) : [];

    const detailLines = [
        !isManagementView || !currentProfile?.company_id ? cardDetail("Company", displayCompany) : "",
        cardDetail("Material", displayMaterial),
        cardDetail("Stone", displayStoneName),
        isManagementView && hasKnownThickness(remnant)
            ? cardDetail("Thickness", displayThickness)
            : "",
        cardDetail("Size", sizeText(remnant)),
        ...statusLines.map((line) => cardDetail(line.label, line.value)),
    ].filter(Boolean).join("");

    const holdRequestButton = !isManagementView && String(remnant.status || "").toLowerCase() === "available"
        ? `
            <div class="absolute top-3 left-3 z-20">
                <button
                    type="button"
                    data-request-hold="${displayId}"
                    class="peer inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/92 text-[#8f4c1a] shadow-lg ring-1 ring-white/70 backdrop-blur-sm transition-colors hover:bg-[#fff8f1] active:scale-95"
                    aria-label="Request hold for remnant ${escapeHtml(displayId)}"
                >
                    &#128278;
                </button>
                <span class="pointer-events-none absolute left-1/2 bottom-[calc(100%+8px)] hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-[#232323] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white shadow-lg peer-hover:block">
                    Request Hold
                </span>
            </div>
        `
        : "";

    const eagerImage = index < 8;

    return `
        ${managementCardAction(remnant)}
        ${holdRequestButton}
        <div class="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(35,35,35,0.42),transparent)] pointer-events-none"></div>
        <button
            type="button"
            class="block w-full text-left"
            data-open-image="${escapeHtml(image)}"
            aria-label="Open image for remnant ${escapeHtml(displayId)}"
        >
        <img src="${escapeHtml(image)}" loading="${eagerImage ? "eager" : "lazy"}" fetchpriority="${eagerImage ? "high" : "auto"}" decoding="async" alt="Remnant ${escapeHtml(displayId)}"
            class="h-44 w-full object-contain bg-[#f4ece4] md:h-48"
            onerror="this.src=''; this.classList.add('bg-gray-100');">
        </button>

        <div class="p-4 space-y-2 text-sm text-[#232323]">
            <div class="flex items-center justify-between gap-3">
                <span class="inline-flex items-center rounded-full bg-[#f5ede6] px-2.5 py-1.5 text-sm font-semibold uppercase tracking-[0.16em] text-[#956746]">
                    Remnant #${escapeHtml(displayId)}
                </span>
                <span class="inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusBadgeClass(status)}">
                    ${escapeHtml(status)}
                </span>
            </div>
            <div class="space-y-1.5 px-2.5">${detailLines}</div>
            ${statusUserCardActions(remnant)}
        </div>
    `;
}

function managementCardAction(remnant) {
    if (!isManagementView || !canManageStructure()) return "";

    return `
        <div class="absolute top-3 left-3 z-20">
            <button
                type="button"
                data-hold-remnant-id="${remnant.id}"
                class="peer inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/92 text-[#8f4c1a] shadow-lg ring-1 ring-white/70 backdrop-blur-sm transition-colors hover:bg-[#fff8f1] active:scale-95"
                aria-label="Manage hold for remnant ${remnant.id}"
            >
                &#128278;
            </button>
            <span class="pointer-events-none absolute left-1/2 bottom-[calc(100%+8px)] hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-[#232323] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white shadow-lg peer-hover:block">
                Hold
            </span>
        </div>
        <div class="absolute top-3 right-3 z-20">
            <button
                type="button"
                data-remnant-id="${remnant.id}"
                class="peer h-11 w-11 rounded-2xl bg-[#232323]/92 text-white shadow-lg ring-1 ring-white/70 backdrop-blur-sm flex items-center justify-center text-[18px] transition-all hover:bg-[#E78B4B] hover:scale-105 active:brightness-90 active:scale-95"
                aria-label="Configure remnant ${remnant.id}"
            >
                &#9881;
            </button>
            <span class="pointer-events-none absolute right-0 bottom-[calc(100%+8px)] hidden whitespace-nowrap rounded-full bg-[#232323] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white shadow-lg peer-hover:block">
                Modify
            </span>
        </div>
    `;
}

function statusUserCardActions(remnant) {
    if (!canStatusUserManageRemnant(remnant)) return "";

    const hold = remnant.current_hold || null;
    const holdStatus = String(hold?.status || "").toLowerCase();
    const currentStatus = String(remnant.status || "").toLowerCase();
    const soldByOtherUser = currentStatus === "sold"
        && remnant.sold_by_user_id
        && String(remnant.sold_by_user_id || "") !== String(currentProfile?.id || "");
    if (soldByOtherUser) {
        return `
            <div class="mt-3 px-2.5">
                <div class="inline-flex w-full items-center justify-center rounded-2xl border border-[#ead8ca] bg-[#fff7f1] px-4 py-3 text-sm font-semibold text-[#8f5a36]">
                    Sold by ${escapeHtml(currentStatusActorName(remnant))}
                </div>
            </div>
        `;
    }

    const isLockedHold = ["active", "expired"].includes(holdStatus) && !canCurrentUserControlHold(remnant);
    if (isLockedHold) {
        return `
            <div class="mt-3 px-2.5">
                <div class="inline-flex w-full items-center justify-center rounded-2xl border border-[#ead8ca] bg-[#fff7f1] px-4 py-3 text-sm font-semibold text-[#8f5a36]">
                    On hold for ${escapeHtml(hold.owner_name || "sales rep")}
                </div>
            </div>
        `;
    }

    const controls = [];

    if (currentStatus === "available") {
        controls.push({
            kind: "hold",
            label: "Hold",
            action: "create",
            classes: "border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-400 hover:bg-amber-200",
        });
        controls.push({
            kind: "status",
            label: "Sold",
            action: "sold",
            classes: "border-rose-300 bg-rose-100 text-rose-800 hover:border-rose-400 hover:bg-rose-200",
        });
    } else if (currentStatus === "hold") {
        controls.push({
            kind: "status",
            label: "Available",
            action: "available",
            classes: "border-emerald-300 bg-emerald-100 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-200",
        });
        controls.push({
            kind: "status",
            label: "Sold",
            action: "sold",
            classes: "border-rose-300 bg-rose-100 text-rose-800 hover:border-rose-400 hover:bg-rose-200",
        });
    } else if (currentStatus === "sold") {
        controls.push({
            kind: "hold",
            label: "On Hold",
            action: "create",
            classes: "border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-400 hover:bg-amber-200",
        });
        controls.push({
            kind: "status",
            label: "Available",
            action: "available",
            classes: "border-emerald-300 bg-emerald-100 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-200",
        });
    }

    return `
        <div class="mt-3 grid grid-cols-2 gap-2 px-2.5">
            ${controls.map((control) => `
                <button
                    type="button"
                    ${control.kind === "status"
                        ? `data-quick-status="${control.action}"`
                        : `data-quick-hold="${control.action}"`}
                    data-remnant-id="${remnant.id}"
                    class="inline-flex h-10 items-center justify-center rounded-2xl border text-[11px] font-semibold uppercase tracking-[0.14em] transition ${control.classes}"
                >
                    ${control.label}
                </button>
            `).join("")}
        </div>
    `;
}

// Card rendering is intentionally data-driven so future layout changes stay
// local to the card helper instead of mixed into fetch logic.
function renderRemnants() {
    const container = document.getElementById("remnants-container");
    if (!container) return;

    if (!Array.isArray(allRemnants) || allRemnants.length === 0) {
        container.innerHTML = `
            <div class="col-span-full rounded-[28px] border border-dashed border-[#d7c4b6] bg-white/75 px-6 py-12 text-center text-[#6d584b] shadow-sm">
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9c7355]">No Matches</p>
                <h3 class="mt-2 text-2xl font-semibold text-[#2d2623]">No remnants match these filters.</h3>
                <p class="mt-2 text-sm">Try changing the stone name, ID, material, or size filters to widen the search.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = allRemnants.map((remnant, index) => {
        const status = statusText(remnant);
        return `
            <div class="group relative bg-white/92 border border-white/80 rounded-[26px] shadow-[0_20px_45px_rgba(58,37,22,0.08)] flex flex-col overflow-visible backdrop-blur">
                ${buildRemnantCardMarkup(remnant, status, index)}
            </div>
        `;
    }).join("");
}

// Generic field setter used by both modals. Keeping checkbox handling here
// prevents repetitive branching in modal hydration code.
function setFieldValue(id, value) {
    const field = document.getElementById(id);
    if (!field) return;

    if (field.type === "checkbox") {
        field.checked = Boolean(value);
        return;
    }

    field.value = value ?? "";
}

function setPreviewImage(prefix, src) {
    const preview = document.getElementById(`${prefix}-image-preview`);
    const emptyState = document.getElementById(`${prefix}-image-empty`);
    const cropButton = document.getElementById(`${prefix}-open-crop`);
    const hasImage = Boolean(src);

    if (preview) {
        preview.src = src || "";
        preview.classList.toggle("hidden", !hasImage);
    }

    if (emptyState) {
        emptyState.classList.toggle("hidden", hasImage);
    }

    if (cropButton) {
        cropButton.disabled = !hasImage;
        cropButton.classList.toggle("opacity-50", !hasImage);
        cropButton.classList.toggle("cursor-not-allowed", !hasImage);
    }
}

// The custom L-shape switch controls both visual state and whether the extra
// L-dimension fields are visible.
function toggleLShapeFields(prefix, isVisible) {
    const row = document.getElementById(`${prefix}-l-dimensions`);
    const toggle = document.getElementById(`${prefix}-l-shape-toggle`);
    const knob = document.getElementById(`${prefix}-l-shape-knob`);
    const checkbox = document.getElementById(`${prefix}-l-shape`);
    if (!row) return;
    row.classList.toggle("hidden", !isVisible);

    if (checkbox) checkbox.checked = isVisible;
    if (toggle) {
        toggle.setAttribute("aria-pressed", String(isVisible));
        toggle.classList.toggle("bg-[#E78B4B]", isVisible);
        toggle.classList.toggle("bg-gray-300", !isVisible);
    }
    if (knob) {
        knob.classList.toggle("translate-x-5", isVisible);
    }
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
}

function openImageLightbox(src) {
    if (!src) return;

    const image = document.getElementById("lightbox-image");
    if (!image) return;

    image.src = src;
    openModal("image-lightbox");
}

function preferredCropType(contentType) {
    return "image/webp";
}

function imagePayloadFromDataUrl(dataUrl, fileName, contentType) {
    return {
        name: fileName,
        type: preferredCropType(contentType),
        dataUrl,
    };
}

function clampCropOffsets() {
    const canvas = cropCanvas();
    const image = cropState.image;
    if (!canvas || !image) return;

    const scaledWidth = image.width * cropState.scale;
    const scaledHeight = image.height * cropState.scale;
    const maxOffsetX = Math.max(0, (scaledWidth - canvas.width) / 2);
    const maxOffsetY = Math.max(0, (scaledHeight - canvas.height) / 2);

    cropState.offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, cropState.offsetX));
    cropState.offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, cropState.offsetY));
}

function cropGeometry() {
    const canvas = cropCanvas();
    const image = cropState.image;
    if (!canvas || !image) return null;

    const drawWidth = image.width * cropState.scale;
    const drawHeight = image.height * cropState.scale;
    const drawX = (canvas.width - drawWidth) / 2 + cropState.offsetX;
    const drawY = (canvas.height - drawHeight) / 2 + cropState.offsetY;

    return { canvas, image, drawX, drawY, drawWidth, drawHeight };
}

function totalCropRotation() {
    return cropState.rotationBase + cropState.rotation;
}

function formatCropRotationLabel(value) {
    const rounded = Number(value.toFixed(1));
    return Number.isInteger(rounded) ? `${rounded}°` : `${rounded.toFixed(1)}°`;
}

function updateRotationControls() {
    const slider = document.getElementById("crop-rotation");
    const label = document.getElementById("crop-rotation-label");
    if (slider) slider.value = String(cropState.rotation);
    if (label) label.textContent = formatCropRotationLabel(totalCropRotation());
}

function clampCropRect() {
    const canvas = cropCanvas();
    if (!canvas) return;

    const minSize = 80;
    const rect = cropState.cropRect;
    rect.width = Math.max(minSize, rect.width);
    rect.height = Math.max(minSize, rect.height);
    rect.x = Math.max(0, Math.min(canvas.width - rect.width, rect.x));
    rect.y = Math.max(0, Math.min(canvas.height - rect.height, rect.y));
}

function drawCropOverlay(context, canvas) {
    const rect = cropState.cropRect;
    const handleSize = 12;

    context.save();
    context.fillStyle = "rgba(24, 18, 14, 0.45)";
    context.beginPath();
    context.rect(0, 0, canvas.width, canvas.height);
    context.rect(rect.x, rect.y, rect.width, rect.height);
    context.fill("evenodd");

    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);

    context.fillStyle = "#E78B4B";
    cropHandles().forEach((handle) => {
        context.fillRect(
            handle.x - handleSize / 2,
            handle.y - handleSize / 2,
            handleSize,
            handleSize
        );
    });
    context.restore();
}

function cropHandles() {
    const rect = cropState.cropRect;
    return [
        { key: "nw", x: rect.x, y: rect.y },
        { key: "ne", x: rect.x + rect.width, y: rect.y },
        { key: "sw", x: rect.x, y: rect.y + rect.height },
        { key: "se", x: rect.x + rect.width, y: rect.y + rect.height },
    ];
}

function canvasPoint(event) {
    const canvas = cropCanvas();
    if (!canvas) return null;

    const bounds = canvas.getBoundingClientRect();
    return {
        x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
        y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
}

function handleHitTest(point) {
    const radius = 14;
    return cropHandles().find((handle) => (
        Math.abs(point.x - handle.x) <= radius && Math.abs(point.y - handle.y) <= radius
    )) || null;
}

function pointInCropRect(point) {
    const rect = cropState.cropRect;
    return (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
    );
}

function renderCropCanvas() {
    const canvas = cropCanvas();
    if (!canvas || !cropState.image) return;

    clampCropOffsets();
    clampCropRect();

    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#efe4d8";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const { drawX, drawY, drawWidth, drawHeight } = cropGeometry();
    const centerX = drawX + drawWidth / 2;
    const centerY = drawY + drawHeight / 2;
    context.save();
    context.translate(centerX, centerY);
    context.rotate((totalCropRotation() * Math.PI) / 180);
    context.drawImage(cropState.image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    context.restore();
    drawCropOverlay(context, canvas);
}

function resetCropState() {
    cropState.offsetX = 0;
    cropState.offsetY = 0;
    cropState.scale = cropState.baseScale;
    cropState.cropRect = {
        x: 120,
        y: 90,
        width: 720,
        height: 540,
    };
    cropState.dragMode = null;
    cropState.activeHandle = null;
    cropState.rotationBase = 0;
    cropState.rotation = 0;

    updateRotationControls();
    renderCropCanvas();
}

async function openCropModal(prefix) {
    const preview = document.getElementById(`${prefix}-image-preview`);
    const src = preview?.src || "";
    if (!src) {
        showActionMessage("Choose or load an image before cropping.", true);
        return;
    }

    const image = new Image();
    image.src = cropSourceUrl(src);

    try {
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error("Failed to load image for cropping"));
        });
    } catch (error) {
        showActionMessage(error.message, true);
        return;
    }

    const canvas = cropCanvas();
    if (!canvas) return;

    cropState.prefix = prefix;
    cropState.source = src;
    cropState.image = image;
    cropState.fileName = pendingImagePayloads[prefix]?.name
        || document.getElementById(`${prefix}-image-file`)?.files?.[0]?.name
        || `remnant-${prefix}.jpg`;
    cropState.contentType = pendingImagePayloads[prefix]?.type
        || document.getElementById(`${prefix}-image-file`)?.files?.[0]?.type
        || "image/jpeg";
    cropState.baseScale = Math.min(canvas.width / image.width, canvas.height / image.height);
    resetCropState();
    openModal("crop-image-modal");
}

async function persistEditedCrop(imagePayload) {
    if (!activeRemnantId) return;

    const res = await fetch(`/api/remnants/${activeRemnantId}/image`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_file: imagePayload }),
    });

    if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to save cropped image"));
    }

    await loadRemnants();
    await loadInventorySummary();
}

async function saveCropImage() {
    const geometry = cropGeometry();
    if (!geometry || !cropState.prefix) return;

    const rect = cropState.cropRect;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = geometry.canvas.width;
    sourceCanvas.height = geometry.canvas.height;
    const sourceContext = sourceCanvas.getContext("2d");
    sourceContext.fillStyle = "#efe4d8";
    sourceContext.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    const centerX = geometry.drawX + geometry.drawWidth / 2;
    const centerY = geometry.drawY + geometry.drawHeight / 2;
    sourceContext.save();
    sourceContext.translate(centerX, centerY);
    sourceContext.rotate((totalCropRotation() * Math.PI) / 180);
    sourceContext.drawImage(
        cropState.image,
        -geometry.drawWidth / 2,
        -geometry.drawHeight / 2,
        geometry.drawWidth,
        geometry.drawHeight
    );
    sourceContext.restore();

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = Math.max(1, Math.round(rect.width));
    outputCanvas.height = Math.max(1, Math.round(rect.height));
    const outputContext = outputCanvas.getContext("2d");
    outputContext.drawImage(
        sourceCanvas,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        outputCanvas.width,
        outputCanvas.height
    );

    const outputType = preferredCropType(cropState.contentType);
    const dataUrl = outputCanvas.toDataURL(outputType, 0.92);
    pendingImagePayloads[cropState.prefix] = imagePayloadFromDataUrl(
        dataUrl,
        cropState.fileName,
        outputType
    );
    setPreviewImage(cropState.prefix, dataUrl);

    if (cropState.prefix === "edit") {
        await persistEditedCrop(pendingImagePayloads[cropState.prefix]);
        closeModal("crop-image-modal");
        showActionMessage("Cropped image saved.");
        return;
    }

    closeModal("crop-image-modal");
    showActionMessage("Cropped image ready to save.");
}

function clearPendingImage(prefix) {
    pendingImagePayloads[prefix] = null;
}

// Some modal interactions are shared by both the public and management pages,
// like image preview, close buttons, and clicking the backdrop to dismiss.
function bindModalInteractions() {
    document.addEventListener("click", (event) => {
        const imageTrigger = event.target.closest("[data-open-image]");
        if (imageTrigger) {
            openImageLightbox(imageTrigger.dataset.openImage);
            return;
        }

        const holdRequestTrigger = event.target.closest("[data-request-hold]");
        if (holdRequestTrigger) {
            openHoldRequestModal(holdRequestTrigger.dataset.requestHold)
                .catch((error) => showActionMessage(error.message, true));
            return;
        }

        const closeTrigger = event.target.closest("[data-close-modal]");
        if (closeTrigger) {
            closeModal(closeTrigger.dataset.closeModal);
            return;
        }

        const overlay = event.target.closest("[data-modal-overlay]");
        if (overlay && event.target === overlay) {
            closeModal(overlay.dataset.modalOverlay);
        }
    });
}

function populateEditModal(remnant) {
    setFieldValue("edit-id", displayRemnantId(remnant));
    setFieldValue("edit-name", remnant.name);
    setFieldValue("edit-company", remnant.company_id);
    setFieldValue("edit-material", remnant.material_id);
    setFieldValue("edit-width", remnant.width);
    setFieldValue("edit-height", remnant.height);
    setFieldValue("edit-thickness", remnant.thickness_id);
    setFieldValue("edit-l-shape", remnant.l_shape);
    setFieldValue("edit-l-width", remnant.l_width);
    setFieldValue("edit-l-height", remnant.l_height);
    toggleLShapeFields("edit", Boolean(remnant.l_shape));

    clearPendingImage("edit");
    setPreviewImage("edit", imageSrc(remnant));
    const imageInput = document.getElementById("edit-image-file");
    if (imageInput) imageInput.value = "";

}

function populateManageHoldModal(remnant) {
    const hold = remnant.current_hold || null;
    const badge = document.getElementById("manage-hold-badge");
    const summary = document.getElementById("manage-hold-summary");
    const owner = document.getElementById("manage-hold-owner");
    const expiresAt = document.getElementById("manage-hold-expires-at");
    const project = document.getElementById("manage-hold-project-reference");
    const jobNumber = document.getElementById("manage-hold-job-number");
    const notes = document.getElementById("manage-hold-notes");
    const title = document.getElementById("manage-hold-title");
    const subtitle = document.getElementById("manage-hold-subtitle");

    if (title) title.textContent = `Manage hold for #${displayRemnantId(remnant)}`;
    if (subtitle) {
        subtitle.textContent = remnant.name
            ? `${remnant.name} hold details and status actions.`
            : "Hold details and status actions for this remnant.";
    }

    if (badge) {
        badge.textContent = hold
            ? hold.status === "active"
                ? "Active Hold"
                : `${normalizeStatus(hold.status)} Hold`
            : "No Active Hold";
    }

    if (summary) {
        summary.innerHTML = hold
            ? holdSummaryLines(remnant).map((line) => `<p>${escapeHtml(line)}</p>`).join("")
            : "No hold is linked to this remnant yet.";
    }

    if (owner) owner.value = hold?.hold_owner_user_id || currentProfile?.id || "";
    if (expiresAt) expiresAt.value = hold?.expires_at ? String(hold.expires_at).slice(0, 10) : defaultHoldExpirationInputValue();
    if (project) project.value = hold?.project_reference || "";
    if (jobNumber) jobNumber.value = hold?.job_number || "";
    if (notes) notes.value = hold?.notes || "";
}

function openManageHoldModal(remnantId) {
    // Managers/admins got a separate hold modal so hold logic and structural
    // remnant edits do not compete for space inside one overloaded panel.
    const remnant = allRemnants.find((item) => String(item.id) === String(remnantId));
    if (!remnant) return;
    activeManageHoldRemnantId = String(remnantId);
    populateManageHoldModal(remnant);
    openModal("manage-hold-modal");
}

function openEditModal(remnantId) {
    // Structural edit modal used by manager/admin flows.
    const remnant = allRemnants.find((item) => String(item.id) === String(remnantId));
    if (!remnant) return;
    activeRemnantId = String(remnantId);
    populateEditModal(remnant);
    applyRoleVisibility();
    openModal("edit-remnant-modal");
}

function openAddModal() {
    const form = document.getElementById("add-remnant-form");
    if (form) form.reset();
    toggleLShapeFields("add", false);
    clearPendingImage("add");

    if (nextStoneId !== null) {
        setFieldValue("add-external-id", nextStoneId);
    }

    const defaultCompanyId = currentProfile?.system_role === "status_user" ? currentProfile.company_id : "";
    if (defaultCompanyId) {
        setFieldValue("add-company", defaultCompanyId);
    }

    setPreviewImage("add", "");

    activeRemnantId = null;
    openModal("add-remnant-modal");
}

// Temporary toast-style feedback keeps the workflow fast without forcing full
// page refreshes or alert dialogs.
function showActionMessage(message, isError = false) {
    // Fast toast-style feedback keeps the UI moving without blocking the user
    // with alert() popups after every small action.
    let el = document.getElementById("action-feedback");
    if (!el) {
        el = document.createElement("div");
        el.id = "action-feedback";
        el.className = "fixed bottom-5 right-5 z-[60] rounded-2xl px-4 py-3 text-sm font-medium shadow-lg";
        document.body.appendChild(el);
    }

    el.textContent = message;
    el.className = `fixed bottom-5 right-5 z-[60] rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ${
        isError ? "bg-rose-600 text-white" : "bg-[#232323] text-white"
    }`;

    window.clearTimeout(showActionMessage.timeoutId);
    showActionMessage.timeoutId = window.setTimeout(() => {
        el.remove();
    }, 2400);
}

window.showActionMessage = showActionMessage;

// File inputs return Blob/File objects. The API expects JSON, so we convert the
// chosen image into a data URL before sending it.
async function fileToPayload(file) {
    if (!file) return null;

    const normalizedImage = await normalizeImageFile(file);
    if (normalizedImage) {
        return normalizedImage;
    }

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

async function normalizeImageFile(file) {
    const contentType = String(file.type || "").toLowerCase();
    if (!contentType.startsWith("image/")) return null;
    if (contentType === "image/gif") return null;

    const imageUrl = URL.createObjectURL(file);

    try {
        const image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Failed to load image for compression"));
            img.src = imageUrl;
        });

        // We preserve original dimensions for normal uploads, but extremely
        // large photos can blow up browser memory when drawn to a canvas. In
        // that case we scale down just enough to stay under a safe pixel budget
        // while keeping the aspect ratio intact.
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

        const compressedType = preferredCropType(contentType);
        const dataUrl = canvas.toDataURL(compressedType, 0.86);

        return {
            name: file.name.replace(/\.[^.]+$/, "") + ".webp",
            type: compressedType,
            dataUrl,
        };
    } finally {
        URL.revokeObjectURL(imageUrl);
    }
}

async function resolveImagePayload(prefix) {
    if (pendingImagePayloads[prefix]) return pendingImagePayloads[prefix];

    const imageFile = document.getElementById(`${prefix}-image-file`)?.files?.[0];
    if (!imageFile) return null;

    return fileToPayload(imageFile);
}

// Add and edit share almost all fields. This function normalizes both forms
// into the same payload shape expected by the API.
function serializeForm(prefix) {
    const payload = {
        name: document.getElementById(`${prefix}-name`)?.value.trim(),
        company_id: document.getElementById(`${prefix}-company`)?.value,
        material_id: document.getElementById(`${prefix}-material`)?.value,
        width: document.getElementById(`${prefix}-width`)?.value,
        height: document.getElementById(`${prefix}-height`)?.value,
        thickness_id: document.getElementById(`${prefix}-thickness`)?.value,
        l_shape: document.getElementById(`${prefix}-l-shape`)?.checked,
        l_width: document.getElementById(`${prefix}-l-width`)?.value,
        l_height: document.getElementById(`${prefix}-l-height`)?.value,
    };

    if (prefix === "add") {
        payload.moraware_remnant_id = document.getElementById("add-external-id")?.value;
    }

    return payload;
}

// Status updates are their own API route because status_user users are allowed
// to do this even when they cannot perform structural edits.
async function updateStatus(status, extraPayload = {}) {
    // Edit-modal version of status changes. extraPayload is mainly used by the
    // sold flow to send the required job number alongside the status itself.
    if (!activeRemnantId) return;

    const res = await fetch(`/api/remnants/${activeRemnantId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extraPayload }),
    });

    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update status"));

    await loadRemnants();
    await loadInventorySummary();
    closeModal("edit-remnant-modal");
    showActionMessage(`Status updated to ${normalizeStatus(status)}.`);
}

async function updateStatusFromCard(remnantId, status, extraPayload = {}) {
    // Card-level version of the same status route. status_user relies on this
    // heavily so they can work directly from the grid.
    const res = await fetch(`/api/remnants/${remnantId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extraPayload }),
    });

    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update status"));

    await loadRemnants();
    await loadInventorySummary();
    showActionMessage(`Status updated to ${normalizeStatus(status)}.`);
}

// Edit flow for manager/admin users.
async function modifyRemnant() {
    if (!activeRemnantId) return;

    const payload = serializeForm("edit");
    const imagePayload = await resolveImagePayload("edit");
    if (imagePayload) payload.image_file = imagePayload;

    const res = await fetch(`/api/remnants/${activeRemnantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to modify remnant"));

    await loadRemnants();
    closeModal("edit-remnant-modal");
    showActionMessage("Remnant updated.");
}

async function deleteRemnant() {
    if (!activeRemnantId) return;

    const res = await fetch(`/api/remnants/${activeRemnantId}`, {
        method: "DELETE",
    });

    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to delete remnant"));

    await loadRemnants();
    await loadInventorySummary();
    closeModal("edit-remnant-modal");
    showActionMessage("Remnant archived.");
}

// Add flow for manager/admin users. After a successful create we also fetch the
// next suggested stone ID so the next entry is ready immediately.
async function createRemnant() {
    const payload = serializeForm("add");
    const imagePayload = await resolveImagePayload("add");
    if (imagePayload) payload.image_file = imagePayload;

    const res = await fetch("/api/remnants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to create remnant"));

    await loadRemnants();
    await loadInventorySummary();
    await loadNextStoneId();
    closeModal("add-remnant-modal");
    showActionMessage("Remnant created.");
}

async function saveHold() {
    const targetRemnantId = activeManageHoldRemnantId || activeRemnantId;
    if (!targetRemnantId) return;
    const ownerFieldId = activeManageHoldRemnantId ? "manage-hold-owner" : "edit-hold-owner";
    const expiresFieldId = activeManageHoldRemnantId ? "manage-hold-expires-at" : "edit-hold-expires-at";
    const projectFieldId = activeManageHoldRemnantId ? "manage-hold-project-reference" : "edit-hold-project-reference";
    const jobNumberFieldId = activeManageHoldRemnantId ? "manage-hold-job-number" : "edit-hold-job-number";
    const notesFieldId = activeManageHoldRemnantId ? "manage-hold-notes" : "edit-hold-notes";
    const jobNumber = document.getElementById(jobNumberFieldId)?.value.trim() || "";
    if (!jobNumber) throw new Error("Job number is required");

    const payload = {
        hold_owner_user_id: document.getElementById(ownerFieldId)?.value || currentProfile?.id || "",
        expires_at: document.getElementById(expiresFieldId)?.value,
        project_reference: document.getElementById(projectFieldId)?.value.trim(),
        job_number: jobNumber,
        notes: document.getElementById(notesFieldId)?.value.trim(),
    };

    const res = await fetch(`/api/remnants/${targetRemnantId}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to save hold"));

    await loadRemnants();
    await loadInventorySummary();
    if (activeManageHoldRemnantId) {
        closeModal("manage-hold-modal");
        activeManageHoldRemnantId = null;
    } else {
        closeModal("edit-remnant-modal");
    }
    showActionMessage("Hold saved.");
}

async function quickCreateHold(remnantId, payload) {
    const res = await fetch(`/api/remnants/${remnantId}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to create hold"));

    await loadRemnants();
    await loadInventorySummary();
    showActionMessage("Hold created for 7 days.");
}

function openQuickHoldModal(remnantId) {
    activeQuickHoldRemnantId = String(remnantId);
    const remnant = allRemnants.find((item) => String(item.id) === String(remnantId));
    const form = document.getElementById("quick-hold-form");
    if (form) form.reset();

    const title = document.getElementById("quick-hold-title");
    const subtitle = document.getElementById("quick-hold-subtitle");
    const displayId = remnant ? displayRemnantId(remnant) : remnantId;

    if (title) title.textContent = `Create hold for #${displayId}`;
    if (subtitle) {
        subtitle.textContent = remnant?.name
            ? `${remnant.name} will be held for 7 days once saved.`
            : "This remnant will be held for 7 days once saved.";
    }

    openModal("quick-hold-modal");
}

function openSoldModal(remnantId, source = "card") {
    // "Sold" needs an extra required field, so we collect it in a small modal
    // instead of silently marking sold with incomplete information.
    activeSoldRemnantId = String(remnantId);
    activeSoldSource = source;

    const remnant = allRemnants.find((item) => String(item.id) === String(remnantId));
    const displayId = remnant ? displayRemnantId(remnant) : remnantId;
    const title = document.getElementById("sold-project-title");
    const subtitle = document.getElementById("sold-project-subtitle");
    const input = document.getElementById("sold-job-number");
    const form = document.getElementById("sold-project-form");

    if (form) form.reset();
    if (title) title.textContent = `Mark remnant #${displayId} as sold`;
    if (subtitle) {
        subtitle.textContent = remnant?.name
            ? `${remnant.name} will be marked sold to this project.`
            : "This remnant will be marked sold to this project.";
    }
    if (input) input.value = "";

    openModal("sold-project-modal");
}

async function submitSoldStatus() {
    // Shared sold-submit path for both:
    // - status_user card actions
    // - manager/admin edit modal action
    if (!activeSoldRemnantId) return;

    const soldJobNumber = document.getElementById("sold-job-number")?.value.trim() || "";
    if (!soldJobNumber) {
        throw new Error("Sold job number is required");
    }

    if (activeSoldSource === "edit") {
        await updateStatus("sold", { sold_job_number: soldJobNumber });
    } else {
        await updateStatusFromCard(activeSoldRemnantId, "sold", { sold_job_number: soldJobNumber });
    }

    closeModal("sold-project-modal");
    activeSoldRemnantId = null;
    activeSoldSource = "card";
}

async function releaseHold() {
    const targetRemnantId = activeManageHoldRemnantId || activeRemnantId;
    if (!targetRemnantId) return;

    const remnant = allRemnants.find((item) => String(item.id) === String(targetRemnantId));
    const holdId = remnant?.current_hold?.id;
    if (!holdId) throw new Error("No hold is linked to this remnant");

    const res = await fetch(`/api/holds/${holdId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to release hold"));

    await loadRemnants();
    await loadInventorySummary();
    if (activeManageHoldRemnantId) {
        closeModal("manage-hold-modal");
        activeManageHoldRemnantId = null;
    } else {
        closeModal("edit-remnant-modal");
    }
    showActionMessage("Hold released.");
}

async function quickReleaseHold(remnantId) {
    const remnant = allRemnants.find((item) => String(item.id) === String(remnantId));
    const holdId = remnant?.current_hold?.id;
    if (!holdId) throw new Error("No hold is linked to this remnant");

    const res = await fetch(`/api/holds/${holdId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to release hold"));

    await loadRemnants();
    await loadInventorySummary();
    showActionMessage("Hold released.");
}

async function openHoldRequestModal(remnantId) {
    // Public visitors request holds from inside the browsing flow instead of
    // being sent to a separate page, which keeps the experience lightweight.
    const remnant = allRemnants.find((item) => String(displayRemnantId(item)) === String(remnantId));
    if (!remnant) return;

    if (!salesRepData.length) {
        await loadSalesReps();
    }

    activeHoldRequestRemnant = remnant;
    const form = document.getElementById("hold-request-form");
    if (form) form.reset();
    setFieldValue("hold-request-internal-id", internalRemnantId(remnant));
    setFieldValue("hold-request-external-id", displayRemnantId(remnant));

    const label = document.getElementById("hold-request-remnant-label");
    if (label) {
        label.textContent = `Request a hold for Remnant #${displayRemnantId(remnant)}${remnant.name ? ` - ${remnant.name}` : ""}.`;
    }

    openModal("hold-request-modal");
}

// Load the lookup tables that feed filters and form selects.
async function loadLookups() {
    const res = await fetch("/api/lookups");
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load lookups"));

    lookupData = await res.json();
    renderMaterialCheckboxes();
    renderSelectOptions("edit-company", lookupData.companies, "Select company");
    renderSelectOptions("add-company", lookupData.companies, "Select company");
    renderSelectOptions("edit-material", lookupData.materials, "Select material");
    renderSelectOptions("add-material", lookupData.materials, "Select material");
    renderSelectOptions("edit-thickness", lookupData.thicknesses, "Select thickness");
    renderSelectOptions("add-thickness", lookupData.thicknesses, "Select thickness");
}

async function loadSalesReps() {
    // Sales reps are lazy-loaded because the public page does not need them
    // until someone actually opens the hold-request modal.
    if (salesRepLoadPromise) return salesRepLoadPromise;

    salesRepLoadPromise = (async () => {
        const endpoint = isManagementView ? "/api/sales-reps" : "/api/public/sales-reps";
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load sales reps"));

        salesRepData = await res.json();
        renderSalesRepOptions("edit-hold-owner", salesRepData, "Select hold owner");
        renderSalesRepOptions("manage-hold-owner", salesRepData, "Select hold owner");
        renderSalesRepOptions("hold-request-sales-rep", salesRepData, "Select sales rep");
        return salesRepData;
    })();

    try {
        return await salesRepLoadPromise;
    } catch (error) {
        salesRepLoadPromise = null;
        throw error;
    }
}

async function loadInventorySummary() {
    const res = await fetch("/api/remnants/summary");
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load remnant summary"));

    const data = await res.json();
    inventorySummary = {
        ...defaultSummaryCounts(),
        ...data,
    };

    renderInventorySummary();
    renderStatusSummary();
}

async function loadHoldRequests() {
    if (!isManagementView) return [];

    const res = await fetch("/api/hold-requests?status=pending");
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load hold requests"));

    holdRequestsData = await res.json();
    renderHoldRequests();
    renderHoldRequestCount();
    return holdRequestsData;
}

async function reviewHoldRequest(requestId, status) {
    const jobNumberInput = document.querySelector(`[data-request-job-number="${requestId}"]`);
    const jobNumber = jobNumberInput instanceof HTMLInputElement ? jobNumberInput.value.trim() : "";

    const res = await fetch(`/api/hold-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            status,
            job_number: jobNumber,
        }),
    });

    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update hold request"));

    await Promise.all([
        loadHoldRequests(),
        loadRemnants(),
        loadInventorySummary(),
    ]);
    showActionMessage(status === "approved" ? "Hold request approved." : "Hold request denied.");
}

// Load the current user's profile so the management UI can adapt itself by role.
async function loadProfile() {
    if (!isManagementView) return;

    const res = await fetch("/api/me");
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load profile"));

    const data = await res.json();
    currentProfile = data.profile || null;
    renderWelcomeUser();
    applyRoleVisibility();
}

// The add modal suggests the next external stone ID but still allows manual
// override. This keeps data entry fast without making it rigid.
async function loadNextStoneId() {
    if (!isManagementView || !canManageStructure()) return;

    const res = await fetch("/api/next-stone-id");
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load next stone ID"));

    const data = await res.json();
    nextStoneId = data.nextStoneId ?? null;

    const helper = document.getElementById("add-external-id-helper");
    if (helper) {
        helper.textContent = nextStoneId ? `Suggested next ID: #${nextStoneId}` : "";
    }
}

// All management-only click handlers live here so the public page keeps a
// lighter startup path.
function bindManagementActions() {
    // All management-only listeners are grouped here so the public page does
    // not carry extra event wiring for controls it never renders.
    if (!isManagementView) return;

    document.addEventListener("click", (event) => {
        const holdManagementTrigger = event.target.closest("[data-hold-remnant-id]");
        if (holdManagementTrigger) {
            openManageHoldModal(holdManagementTrigger.dataset.holdRemnantId);
            return;
        }

        const holdRequestAction = event.target.closest("[data-hold-request-action]");
        if (holdRequestAction) {
            reviewHoldRequest(
                holdRequestAction.dataset.holdRequestId,
                holdRequestAction.dataset.holdRequestAction
            ).catch((error) => showActionMessage(error.message, true));
            return;
        }

        const quickStatusTrigger = event.target.closest("[data-quick-status]");
        if (quickStatusTrigger) {
            if (quickStatusTrigger.dataset.quickStatus === "sold") {
                openSoldModal(quickStatusTrigger.dataset.remnantId, "card");
                return;
            }
            updateStatusFromCard(
                quickStatusTrigger.dataset.remnantId,
                quickStatusTrigger.dataset.quickStatus
            ).catch((error) => showActionMessage(error.message, true));
            return;
        }

        const quickHoldTrigger = event.target.closest("[data-quick-hold]");
        if (quickHoldTrigger) {
            const action = quickHoldTrigger.dataset.quickHold;
            const remnantId = quickHoldTrigger.dataset.remnantId;
            const task = action === "release"
                ? quickReleaseHold(remnantId)
                : (openQuickHoldModal(remnantId), Promise.resolve());
            Promise.resolve(task).catch((error) => showActionMessage(error.message, true));
            return;
        }

        const trigger = event.target.closest("[data-remnant-id]");
        if (trigger) {
            if (!canManageStructure()) return;
            openEditModal(trigger.dataset.remnantId);
        }
    });

    const addButton = document.getElementById("open-add-remnant");
    if (addButton) {
        addButton.addEventListener("click", openAddModal);
    }

    document.getElementById("open-hold-requests")?.addEventListener("click", async () => {
        try {
            const title = document.getElementById("hold-requests-title");
            if (title) {
                title.textContent = currentProfile?.system_role === "status_user"
                    ? "Your hold requests"
                    : "Pending hold requests";
            }
            const container = document.getElementById("hold-requests-list");
            if (container) container.innerHTML = "Loading...";
            openModal("hold-requests-modal");
            await loadHoldRequests();
        } catch (error) {
            closeModal("hold-requests-modal");
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("quick-hold-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (!activeQuickHoldRemnantId) {
            showActionMessage("Remnant selection was lost. Please try again.", true);
            return;
        }

        const jobNumber = document.getElementById("quick-hold-job-number")?.value.trim() || "";
        if (!jobNumber) {
            showActionMessage("Job number is required", true);
            return;
        }

        try {
            await quickCreateHold(activeQuickHoldRemnantId, {
                hold_owner_user_id: currentProfile?.id || "",
                expires_at: defaultHoldExpirationInputValue(),
                job_number: jobNumber,
                project_reference: document.getElementById("quick-hold-project-reference")?.value.trim() || "",
                notes: document.getElementById("quick-hold-notes")?.value.trim() || "",
            });
            closeModal("quick-hold-modal");
            activeQuickHoldRemnantId = null;
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    ["edit", "add"].forEach((prefix) => {
        const checkbox = document.getElementById(`${prefix}-l-shape`);
        const toggle = document.getElementById(`${prefix}-l-shape-toggle`);
        if (toggle) {
            toggle.addEventListener("click", () => {
                if (toggle.disabled) return;
                toggleLShapeFields(prefix, !checkbox?.checked);
            });
        }
    });

    const addImageInput = document.getElementById("add-image-file");
    if (addImageInput) {
        addImageInput.addEventListener("change", (event) => {
            const [file] = event.target.files || [];
            clearPendingImage("add");

            if (!file) {
                setPreviewImage("add", "");
                return;
            }

            setPreviewImage("add", URL.createObjectURL(file));
        });
    }

    const editImageInput = document.getElementById("edit-image-file");
    if (editImageInput) {
        editImageInput.addEventListener("change", (event) => {
            const [file] = event.target.files || [];
            clearPendingImage("edit");

            if (!file) {
                const currentRemnant = allRemnants.find((item) => String(item.id) === String(activeRemnantId));
                setPreviewImage("edit", imageSrc(currentRemnant));
                return;
            }

            setPreviewImage("edit", URL.createObjectURL(file));
        });
    }

    document.getElementById("add-open-crop")?.addEventListener("click", async () => {
        await openCropModal("add");
    });

    document.getElementById("edit-open-crop")?.addEventListener("click", async () => {
        await openCropModal("edit");
    });

    const canvas = cropCanvas();
    if (canvas) {
        canvas.addEventListener("mousedown", (event) => {
            if (!cropState.image) return;
            const point = canvasPoint(event);
            if (!point) return;
            const handle = handleHitTest(point);

            cropState.dragging = true;
            cropState.dragStartX = point.x;
            cropState.dragStartY = point.y;
            cropState.startOffsetX = cropState.offsetX;
            cropState.startOffsetY = cropState.offsetY;
            cropState.startCropRect = { ...cropState.cropRect };
            cropState.activeHandle = handle?.key || null;
            cropState.dragMode = handle
                ? "resize"
                : pointInCropRect(point)
                    ? "move-crop"
                    : "move-image";
            canvas.classList.add("cursor-grabbing");
            canvas.classList.remove("cursor-grab");
        });

        window.addEventListener("mousemove", (event) => {
            if (!cropState.dragging) return;
            const point = canvasPoint(event);
            if (!point) return;
            const dx = point.x - cropState.dragStartX;
            const dy = point.y - cropState.dragStartY;

            if (cropState.dragMode === "move-image") {
                cropState.offsetX = cropState.startOffsetX + dx;
                cropState.offsetY = cropState.startOffsetY + dy;
            } else if (cropState.dragMode === "move-crop") {
                cropState.cropRect.x = cropState.startCropRect.x + dx;
                cropState.cropRect.y = cropState.startCropRect.y + dy;
            } else if (cropState.dragMode === "resize") {
                const rect = { ...cropState.startCropRect };

                if (cropState.activeHandle.includes("n")) {
                    rect.y = cropState.startCropRect.y + dy;
                    rect.height = cropState.startCropRect.height - dy;
                }
                if (cropState.activeHandle.includes("s")) {
                    rect.height = cropState.startCropRect.height + dy;
                }
                if (cropState.activeHandle.includes("w")) {
                    rect.x = cropState.startCropRect.x + dx;
                    rect.width = cropState.startCropRect.width - dx;
                }
                if (cropState.activeHandle.includes("e")) {
                    rect.width = cropState.startCropRect.width + dx;
                }

                cropState.cropRect = rect;
            }

            renderCropCanvas();
        });

        window.addEventListener("mouseup", () => {
            cropState.dragging = false;
            cropState.dragMode = null;
            cropState.activeHandle = null;
            canvas.classList.add("cursor-grab");
            canvas.classList.remove("cursor-grabbing");
        });
    }

    document.getElementById("crop-rotation")?.addEventListener("input", (event) => {
        cropState.rotation = Number(event.target.value || 0);
        updateRotationControls();
        renderCropCanvas();
    });

    document.getElementById("crop-rotate-90-left")?.addEventListener("click", () => {
        cropState.rotationBase -= 90;
        updateRotationControls();
        renderCropCanvas();
    });

    document.getElementById("crop-rotate-90-right")?.addEventListener("click", () => {
        cropState.rotationBase += 90;
        updateRotationControls();
        renderCropCanvas();
    });

    document.getElementById("crop-reset")?.addEventListener("click", () => {
        if (!cropState.image) return;
        resetCropState();
    });

    document.getElementById("crop-save")?.addEventListener("click", async () => {
        if (!cropState.image) return;
        try {
            await saveCropImage();
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("edit-save-hold")?.addEventListener("click", async () => {
        try {
            await saveHold();
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("edit-release-hold")?.addEventListener("click", async () => {
        try {
            await releaseHold();
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("manage-hold-save")?.addEventListener("click", async () => {
        try {
            await saveHold();
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("edit-mark-available")?.addEventListener("click", async () => {
        try {
            await updateStatus("available");
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("edit-mark-sold")?.addEventListener("click", async () => {
        openSoldModal(activeRemnantId, "edit");
    });

    document.getElementById("sold-project-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            await submitSoldStatus();
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("edit-delete")?.addEventListener("click", async () => {
        try {
            await deleteRemnant();
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("hold-request-form")?.addEventListener("submit", (event) => {
        // Public hold requests still submit through a hidden iframe so the page
        // can stay on the inventory view instead of navigating to raw API JSON.
        const form = event.currentTarget;
        if (!(form instanceof HTMLFormElement)) return;

        if (activeHoldRequestRemnant) {
            setFieldValue("hold-request-internal-id", internalRemnantId(activeHoldRequestRemnant));
            setFieldValue("hold-request-external-id", displayRemnantId(activeHoldRequestRemnant));
        }

        const externalId = document.getElementById("hold-request-external-id")?.value;
        const internalId = document.getElementById("hold-request-internal-id")?.value;
        if (!externalId && !internalId) {
            event.preventDefault();
            showActionMessage("Remnant selection was lost. Please reopen the hold request.", true);
            return;
        }

        window.__holdRequestNativePending = true;
        closeModal("hold-request-modal");
        activeHoldRequestRemnant = null;
    });

    window.addEventListener("message", (event) => {
        // The iframe response posts a small payload back to the main window.
        // We translate that into the visible success/error toast here.
        if (event.origin !== window.location.origin) return;
        if (!window.__holdRequestNativePending) return;

        const payload = event.data;
        if (!payload || payload.type !== "hold-request") return;

        window.__holdRequestNativePending = false;

        if (payload.success === true) {
            closeModal("hold-request-modal");
            activeHoldRequestRemnant = null;
            showActionMessage("Hold request received. A sales rep will review it soon.");
            return;
        }

        const errorMessage = payload.error || "Failed to submit hold request";
        showActionMessage(errorMessage, true);
    });

    document.getElementById("edit-modify")?.addEventListener("click", async () => {
        try {
            await modifyRemnant();
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("add-create")?.addEventListener("click", async () => {
        try {
            await createRemnant();
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });
}

// API errors sometimes come back as plain text and sometimes as JSON. This
// helper keeps the UI error messages clean no matter which route responds.
async function readErrorMessage(response, fallbackMessage) {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
        const payload = await response.json().catch(() => null);
        if (payload?.error && payload?.details) return `${payload.error}: ${payload.details}`;
        if (payload?.error) return payload.error;
    }

    const text = await response.text().catch(() => "");
    return text || fallbackMessage;
}

// Fetch the current remnant list from the API based on URL filters. Abort
// previous in-flight requests so fast typing does not render stale results.
async function loadRemnants() {
    // The grid is the main thing users came to see, so we render a skeleton
    // immediately and abort stale in-flight requests when filters change fast.
    const container = document.getElementById("remnants-container");
    if (!container) return;
    container.innerHTML = loadingMarkup();

    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();

    try {
        const query = currentParams().toString();
        const res = await fetch(`/api/remnants?${query}`, {
            signal: activeAbortController.signal,
        });

        if (!res.ok) {
            const errorText = await readErrorMessage(res, "Failed to load remnants");
            throw new Error(`Backend error (${res.status}): ${errorText}`);
        }

        const data = await res.json();
        if (!Array.isArray(data)) throw new TypeError("Expected array from /api/remnants");

        allRemnants = data;
        renderRemnants();
    } catch (err) {
        if (err.name === "AbortError") return;
        console.error("Failed to load remnants:", err);
        container.innerHTML =
            `<div class="col-span-full rounded-[28px] border border-rose-200 bg-white/80 px-6 py-10 text-center text-rose-700 shadow-sm">
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-500">Load Failed</p>
                <h3 class="mt-2 text-xl font-semibold text-rose-800">We couldn't load the remnants right now.</h3>
                <p class="mt-2 text-sm">${escapeHtml(err.message || "Please try again later.")}</p>
            </div>`;
    }
}

function applyFiltersFromForm() {
    const form = document.getElementById("filter-form");
    const query = buildQueryFromForm(form);
    const queryString = query.toString();
    const nextUrl = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
    loadRemnants();
    renderStatusSummary();
}

function queueLiveApply() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(applyFiltersFromForm, LIVE_SEARCH_DELAY_MS);
}

function applyStatusChipFilter(statusKey) {
    const statusField = document.getElementById("status-filter");
    if (!statusField) return;

    const currentStatus = String(currentParams().get("status") || "").trim().toLowerCase();
    statusField.value = currentStatus === statusKey ? "" : statusKey;
    applyFiltersFromForm();
}

function bindGlobalShortcuts() {
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        ["image-lightbox", "edit-remnant-modal", "add-remnant-modal"].forEach((modalId) => {
            const modal = document.getElementById(modalId);
            if (modal && !modal.classList.contains("hidden")) {
                closeModal(modalId);
            }
        });
    });
}

function bindSummaryActions() {
    document.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-status-chip]");
        if (!chip) return;

        applyStatusChipFilter(chip.dataset.statusChip);
    });
}

// Page bootstrap:
// 1. hydrate form state from the URL
// 2. attach shared interactions
// 3. load whichever metadata the current page needs
// 4. fetch and render the remnant grid
//
// Public and private share this same startup path. The main difference is that
// management mode loads extra role/profile/sales-rep/hold-request data first.
document.addEventListener("DOMContentLoaded", async () => {
    try {
        initFormFromURL();
        bindModalInteractions();
        bindManagementActions();
        bindGlobalShortcuts();
        bindSummaryActions();

        if (isManagementView) {
            await Promise.all([
                loadLookups(),
                loadSalesReps(),
                loadInventorySummary(),
                loadProfile(),
                loadHoldRequests(),
            ]);
            await loadNextStoneId();
            toggleLShapeFields("edit", false);
            toggleLShapeFields("add", false);
        } else {
            await Promise.all([
                loadLookups(),
                loadInventorySummary(),
            ]);
        }

        const form = document.getElementById("filter-form");
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            applyFiltersFromForm();
        });

        const textInputs = ["stone-filter", "min-width", "min-height"];
        textInputs.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener("input", queueLiveApply);
        });

        const status = document.getElementById("status-filter");
        if (status) status.addEventListener("change", queueLiveApply);

        document.querySelectorAll('input[name="material"]').forEach((checkbox) => {
            checkbox.addEventListener("change", queueLiveApply);
        });

        await loadRemnants();
    } catch (err) {
        console.error("Initialization failed:", err);
        showActionMessage(err.message || "Failed to initialize page", true);
    }
});
