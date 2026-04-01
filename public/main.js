const MATERIALS = ["Quartz", "Granite", "Marble", "Quartzite", "Porcelain"];
const LIVE_SEARCH_DELAY_MS = 300;

let allRemnants = [];
let debounceTimer = null;
let activeAbortController = null;
const isManagementView = document.body?.dataset?.view === "management";

function currentParams() {
    return new URLSearchParams(window.location.search);
}

function normalizeStatus(value) {
    return (value || "Available").trim();
}

function statusBadgeClass(status) {
    const lc = status.toLowerCase();
    if (lc.includes("sold")) return "bg-red-100 text-red-700";
    if (lc.includes("hold") || lc.includes("pending")) return "bg-yellow-100 text-yellow-800";
    return "bg-green-100 text-green-700";
}

function renderMaterialCheckboxes() {
    const selected = currentParams().getAll("material");
    const container = document.getElementById("material-checkboxes");

    container.innerHTML = MATERIALS.map((material) => `
        <label class="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="material" value="${material}" ${selected.includes(material) ? "checked" : ""}>
            ${material}
        </label>
    `).join("");
}

function initFormFromURL() {
    const params = currentParams();
    const stone = document.getElementById("stone-filter");
    const minWidth = document.getElementById("min-width");
    const minHeight = document.getElementById("min-height");
    const status = document.getElementById("status-filter");

    if (stone) stone.value = params.get("stone") || "";
    if (minWidth) minWidth.value = params.get("min-width") || "";
    if (minHeight) minHeight.value = params.get("min-height") || "";
    if (status) status.value = params.get("status") || "";
}

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

function sizeText(remnant) {
    if (remnant.l_shape) {
        return `${remnant.width} x ${remnant.height} + ${remnant.l_width} x ${remnant.l_height}`;
    }
    return `${remnant.width} x ${remnant.height}`;
}

function imageSrc(remnant) {
    return remnant.image || remnant.source_image_url || "";
}

function managementCardAction(remnant) {
    if (!isManagementView) return "";

    return `
        <button
            type="button"
            data-remnant-id="${remnant.id}"
            class="absolute top-3 right-3 z-20 h-11 w-11 rounded-2xl bg-[#232323]/92 text-white shadow-lg ring-1 ring-white/70 backdrop-blur-sm flex items-center justify-center text-[18px] hover:bg-[#E78B4B] hover:scale-105 transition-all"
            aria-label="Configure remnant ${remnant.id}"
            title="Configure remnant"
        >
            &#9881;
        </button>
    `;
}

function renderRemnants() {
    const container = document.getElementById("remnants-container");

    if (!Array.isArray(allRemnants) || allRemnants.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center text-gray-600">No remnants found.</div>`;
        return;
    }

    container.innerHTML = "";

    allRemnants.forEach((remnant) => {
        const status = normalizeStatus(remnant.status);
        const card = document.createElement("div");
        card.className =
            "group relative bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden";

        card.innerHTML = `
            ${managementCardAction(remnant)}
            <img src="${imageSrc(remnant)}" loading="lazy" alt="Remnant Image"
                class="h-48 object-cover w-full transition-transform duration-300 group-hover:scale-105"
                onerror="this.src=''; this.classList.add('bg-gray-100');">

            <div class="p-4 space-y-1 text-sm text-[#232323]">
                <p><strong>ID:</strong> ${remnant.id}</p>
                <p><strong>Material:</strong> ${remnant.material || "Unknown"}</p>
                <p><strong>Stone:</strong> ${remnant.name || "Unknown"}</p>
                <p><strong>Size:</strong> ${sizeText(remnant)}</p>
                <p><strong>Status:</strong>
                    <span class="inline-block text-xs px-2 py-1 rounded-full font-medium ${statusBadgeClass(status)}">
                        ${status}
                    </span>
                </p>
            </div>
        `;

        container.appendChild(card);
    });
}

function setFieldValue(id, value) {
    const field = document.getElementById(id);
    if (!field) return;

    if (field.type === "checkbox") {
        field.checked = Boolean(value);
        return;
    }

    field.value = value ?? "";
}

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

function populateEditModal(remnant) {
    setFieldValue("edit-id", remnant.id);
    setFieldValue("edit-name", remnant.name);
    setFieldValue("edit-material", remnant.material);
    setFieldValue("edit-width", remnant.width);
    setFieldValue("edit-height", remnant.height);
    setFieldValue("edit-thickness", remnant.thickness);
    setFieldValue("edit-l-shape", remnant.l_shape);
    setFieldValue("edit-l-width", remnant.l_width);
    setFieldValue("edit-l-height", remnant.l_height);
    toggleLShapeFields("edit", Boolean(remnant.l_shape));

    const preview = document.getElementById("edit-image-preview");
    if (preview) {
        const src = imageSrc(remnant);
        preview.src = src;
        preview.classList.toggle("hidden", !src);
    }

    const emptyState = document.getElementById("edit-image-empty");
    if (emptyState) {
        emptyState.classList.toggle("hidden", Boolean(imageSrc(remnant)));
    }

    const imageInput = document.getElementById("edit-image-file");
    if (imageInput) imageInput.value = "";
}

function openEditModal(remnantId) {
    const remnant = allRemnants.find((item) => String(item.id) === String(remnantId));
    if (!remnant) return;
    populateEditModal(remnant);
    openModal("edit-remnant-modal");
}

function openAddModal() {
    const form = document.getElementById("add-remnant-form");
    if (form) form.reset();
    toggleLShapeFields("add", false);

    const preview = document.getElementById("add-image-preview");
    const emptyState = document.getElementById("add-image-empty");
    if (preview) {
        preview.src = "";
        preview.classList.add("hidden");
    }
    if (emptyState) emptyState.classList.remove("hidden");

    openModal("add-remnant-modal");
}

function bindManagementActions() {
    if (!isManagementView) return;

    document.addEventListener("click", (event) => {
        const trigger = event.target.closest("[data-remnant-id]");
        if (trigger) {
            openEditModal(trigger.dataset.remnantId);
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

    const addButton = document.getElementById("open-add-remnant");
    if (addButton) {
        addButton.addEventListener("click", openAddModal);
    }

    ["edit", "add"].forEach((prefix) => {
        const checkbox = document.getElementById(`${prefix}-l-shape`);
        const toggle = document.getElementById(`${prefix}-l-shape-toggle`);
        if (toggle) {
            toggle.addEventListener("click", () => {
                toggleLShapeFields(prefix, !checkbox?.checked);
            });
        }
    });

    const addImageInput = document.getElementById("add-image-file");
    if (addImageInput) {
        addImageInput.addEventListener("change", (event) => {
            const [file] = event.target.files || [];
            const preview = document.getElementById("add-image-preview");
            const emptyState = document.getElementById("add-image-empty");
            if (!preview) return;

            if (!file) {
                preview.src = "";
                preview.classList.add("hidden");
                if (emptyState) emptyState.classList.remove("hidden");
                return;
            }

            preview.src = URL.createObjectURL(file);
            preview.classList.remove("hidden");
            if (emptyState) emptyState.classList.add("hidden");
        });
    }

    const editImageInput = document.getElementById("edit-image-file");
    if (editImageInput) {
        editImageInput.addEventListener("change", (event) => {
            const [file] = event.target.files || [];
            const preview = document.getElementById("edit-image-preview");
            const emptyState = document.getElementById("edit-image-empty");
            if (!preview) return;

            if (!file) {
                if (emptyState && !preview.src) emptyState.classList.remove("hidden");
                return;
            }

            preview.src = URL.createObjectURL(file);
            preview.classList.remove("hidden");
            if (emptyState) emptyState.classList.add("hidden");
        });
    }
}

async function loadRemnants() {
    const container = document.getElementById("remnants-container");
    container.innerHTML = "Loading...";

    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();

    try {
        const query = currentParams().toString();
        const res = await fetch(`/api/remnants?${query}`, {
            signal: activeAbortController.signal,
        });

        if (!res.ok) {
            const errorText = await res.text();
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
            `<div class="col-span-full text-center text-red-600 font-semibold">Failed to load remnants. Please try again later.</div>`;
    }
}

function applyFiltersFromForm() {
    const form = document.getElementById("filter-form");
    const query = buildQueryFromForm(form);
    const nextUrl = `${window.location.pathname}?${query.toString()}`;
    window.history.replaceState({}, "", nextUrl);
    loadRemnants();
}

function queueLiveApply() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(applyFiltersFromForm, LIVE_SEARCH_DELAY_MS);
}

document.addEventListener("DOMContentLoaded", () => {
    renderMaterialCheckboxes();
    initFormFromURL();
    bindManagementActions();
    if (isManagementView) {
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

    loadRemnants();
});
