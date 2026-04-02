const LIVE_SEARCH_DELAY_MS = 300;

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
let currentProfile = null;
let nextStoneId = null;
let inventorySummary = {
    total: 0,
    available: 0,
    hold: 0,
    sold: 0,
};
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
    rotation: 0,
    cropRect: {
        x: 120,
        y: 90,
        width: 720,
        height: 540,
    },
};

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

// The backend stores compact status values, but the UI reads better with
// friendlier labels. This helper keeps that conversion in one place.
function normalizeStatus(value) {
    const normalized = String(value || "").trim().toLowerCase();

    if (!normalized || normalized === "available") return "Available";
    if (normalized === "hold" || normalized === "on hold") return "On Hold";
    if (normalized === "sold") return "Sold";

    return String(value || "Available").trim();
}

// Cards, buttons, and badges all use the same visual language for statuses.
// Centralizing the classes here keeps the markup cleaner later.
function statusBadgeClass(status) {
    const lc = status.toLowerCase();
    if (lc === "sold") return "bg-rose-100 text-rose-800 ring-1 ring-rose-200";
    if (lc === "on hold") return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
    return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
}

// Structural edits are intentionally limited to higher roles. We still show the
// management page to status users for status changes, but the heavier actions
// should disappear consistently.
function canManageStructure() {
    const role = currentProfile?.system_role;
    return role === "super_admin" || role === "manager";
}

// Materials come from the database, so the checkbox list is rebuilt after the
// lookup payload arrives. We also re-read the current query string so checked
// states survive refreshes and live filtering.
function renderMaterialCheckboxes() {
    const selected = new Set(currentParams().getAll("material"));
    const container = document.getElementById("material-checkboxes");
    if (!container) return;

    container.innerHTML = lookupData.materials.map((material) => `
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

function renderWelcomeUser() {
    const target = document.getElementById("welcome-user");
    if (!target) return;

    const preferredName = currentProfile?.full_name?.trim()
        || currentProfile?.email?.split("@")[0]
        || "User";

    target.textContent = `WELCOME, ${String(preferredName).toUpperCase()}`;
}

function cropCanvas() {
    return document.getElementById("crop-canvas");
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
    const editForm = document.getElementById("edit-remnant-form");
    const addForm = document.getElementById("add-remnant-form");
    const structureAllowed = canManageStructure();

    if (addButton) addButton.classList.toggle("hidden", !structureAllowed);
    if (modifyButton) modifyButton.classList.toggle("hidden", !structureAllowed);
    if (deleteButton) deleteButton.classList.toggle("hidden", !structureAllowed);
    if (editCropButton) editCropButton.classList.toggle("hidden", !structureAllowed);
    if (addCropButton) addCropButton.classList.toggle("hidden", !structureAllowed);
    if (editImageInput) editImageInput.disabled = !structureAllowed;

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

// "unknown" thickness is useful as a database fallback but noisy in the card
// UI, so we hide it unless we have a real value to show.
function hasKnownThickness(remnant) {
    const thickness = String(remnant.thickness_name || remnant.thickness?.name || "").trim().toLowerCase();
    return Boolean(thickness) && thickness !== "unknown";
}

function cardDetail(label, value) {
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

function buildRemnantCardMarkup(remnant, status) {
    const image = imageSrc(remnant);
    const displayCompany = displayText(remnant.company_name || remnant.company?.name);
    const displayMaterial = displayText(remnant.material_name || remnant.material?.name);
    const displayStoneName = displayText(remnant.name);
    const displayThickness = displayText(remnant.thickness_name || remnant.thickness?.name);
    const displayId = displayRemnantId(remnant);

    const detailLines = [
        isManagementView ? cardDetail("Company", displayCompany) : "",
        cardDetail("Material", displayMaterial),
        cardDetail("Stone", displayStoneName),
        hasKnownThickness(remnant)
            ? cardDetail("Thickness", displayThickness)
            : "",
        cardDetail("Size", sizeText(remnant)),
    ].filter(Boolean).join("");

    return `
        ${managementCardAction(remnant)}
        <div class="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(35,35,35,0.42),transparent)] pointer-events-none"></div>
        <button
            type="button"
            class="block w-full text-left"
            data-open-image="${escapeHtml(image)}"
            aria-label="Open image for remnant ${escapeHtml(displayId)}"
        >
        <img src="${escapeHtml(image)}" loading="lazy" alt="Remnant ${escapeHtml(displayId)}"
            class="h-44 w-full object-contain bg-[#f4ece4] transition-transform duration-500 group-hover:scale-[1.02] md:h-48"
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
        </div>
    `;
}

function managementCardAction(remnant) {
    if (!isManagementView) return "";

    return `
        <button
            type="button"
            data-remnant-id="${remnant.id}"
            class="absolute top-3 right-3 z-20 h-11 w-11 rounded-2xl bg-[#232323]/92 text-white shadow-lg ring-1 ring-white/70 backdrop-blur-sm flex items-center justify-center text-[18px] transition-all hover:bg-[#E78B4B] hover:scale-105 active:brightness-90 active:scale-95"
            aria-label="Configure remnant ${remnant.id}"
        >
            &#9881;
        </button>
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

    container.innerHTML = "";

    allRemnants.forEach((remnant) => {
        const status = normalizeStatus(remnant.status);
        const card = document.createElement("div");
        card.className =
            "group relative bg-white/92 border border-white/80 rounded-[26px] shadow-[0_20px_45px_rgba(58,37,22,0.08)] hover:shadow-[0_28px_60px_rgba(58,37,22,0.12)] transition-all duration-300 flex flex-col overflow-hidden backdrop-blur";

        card.innerHTML = buildRemnantCardMarkup(remnant, status);

        container.appendChild(card);
    });
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
    return ["image/png", "image/webp", "image/jpeg"].includes(contentType)
        ? contentType
        : "image/jpeg";
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

function updateRotationControls() {
    const slider = document.getElementById("crop-rotation");
    const label = document.getElementById("crop-rotation-label");
    if (slider) slider.value = String(cropState.rotation);
    if (label) label.textContent = `${cropState.rotation.toFixed(1)}°`;
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
    context.rotate((cropState.rotation * Math.PI) / 180);
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
    image.crossOrigin = "anonymous";
    image.src = src;

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
    sourceContext.rotate((cropState.rotation * Math.PI) / 180);
    sourceContext.drawImage(
        cropState.image,
        -geometry.drawWidth / 2,
        -geometry.drawHeight / 2,
        geometry.drawWidth,
        geometry.drawHeight
    );
    sourceContext.restore();

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = Math.round(rect.width);
    outputCanvas.height = Math.round(rect.height);
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

function openEditModal(remnantId) {
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

// File inputs return Blob/File objects. The API expects JSON, so we convert the
// chosen image into a data URL before sending it.
async function fileToPayload(file) {
    if (!file) return null;

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
async function updateStatus(status) {
    if (!activeRemnantId) return;

    const res = await fetch(`/api/remnants/${activeRemnantId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
    });

    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update status"));

    await loadRemnants();
    await loadInventorySummary();
    closeModal("edit-remnant-modal");
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
    if (!isManagementView) return;

    document.addEventListener("click", (event) => {
        const trigger = event.target.closest("[data-remnant-id]");
        if (trigger) {
            openEditModal(trigger.dataset.remnantId);
        }
    });

    const addButton = document.getElementById("open-add-remnant");
    if (addButton) {
        addButton.addEventListener("click", openAddModal);
    }

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

    document.getElementById("crop-rotate-left")?.addEventListener("click", () => {
        cropState.rotation = Math.max(-20, Number((cropState.rotation - 1).toFixed(1)));
        updateRotationControls();
        renderCropCanvas();
    });

    document.getElementById("crop-rotate-right")?.addEventListener("click", () => {
        cropState.rotation = Math.min(20, Number((cropState.rotation + 1).toFixed(1)));
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

    document.getElementById("edit-mark-available")?.addEventListener("click", async () => {
        try {
            await updateStatus("available");
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("edit-mark-hold")?.addEventListener("click", async () => {
        try {
            await updateStatus("hold");
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("edit-mark-sold")?.addEventListener("click", async () => {
        try {
            await updateStatus("sold");
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
// 2. load lookups/profile metadata
// 3. attach live interactions
// 4. fetch and render remnants
document.addEventListener("DOMContentLoaded", async () => {
    try {
        initFormFromURL();
        bindModalInteractions();
        bindManagementActions();
        bindGlobalShortcuts();
        bindSummaryActions();

        await loadLookups();
        await loadInventorySummary();
        if (isManagementView) {
            await loadProfile();
            await loadNextStoneId();
            toggleLShapeFields("edit", false);
            toggleLShapeFields("add", false);
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
