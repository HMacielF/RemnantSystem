const MATERIALS = ["Quartz", "Granite", "Marble", "Quartzite", "Porcelain"];
const LIVE_SEARCH_DELAY_MS = 300;

let allRemnants = [];
let debounceTimer = null;
let activeAbortController = null;
const isManagementView = document.body?.dataset?.view === "management";
let activeRemnantId = null;

function currentParams() {
    return new URLSearchParams(window.location.search);
}

function normalizeStatus(value) {
    const normalized = String(value || "").trim().toLowerCase();

    if (!normalized || normalized === "available") return "Available";
    if (normalized === "hold" || normalized === "on hold") return "On Hold";
    if (normalized === "sold") return "Sold";
    if (normalized === "deleted") return "Deleted";

    return String(value || "Available").trim();
}

function statusBadgeClass(status) {
    const lc = status.toLowerCase();
    if (lc === "sold") return "bg-rose-100 text-rose-800 ring-1 ring-rose-200";
    if (lc === "on hold") return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
    if (lc === "deleted") return "bg-stone-200 text-stone-900 ring-1 ring-stone-300";
    return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
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
            class="absolute top-3 right-3 z-20 h-11 w-11 rounded-2xl bg-[#232323]/92 text-white shadow-lg ring-1 ring-white/70 backdrop-blur-sm flex items-center justify-center text-[18px] transition-all hover:bg-[#E78B4B] hover:scale-105 active:brightness-90 active:scale-95"
            aria-label="Configure remnant ${remnant.id}"
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
    activeRemnantId = String(remnantId);
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

    activeRemnantId = null;
    openModal("add-remnant-modal");
}

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

function serializeForm(prefix) {
    return {
        id: document.getElementById(`${prefix}-id`)?.value.trim(),
        name: document.getElementById(`${prefix}-name`)?.value.trim(),
        material: document.getElementById(`${prefix}-material`)?.value.trim(),
        width: document.getElementById(`${prefix}-width`)?.value,
        height: document.getElementById(`${prefix}-height`)?.value,
        thickness: document.getElementById(`${prefix}-thickness`)?.value.trim(),
        l_shape: document.getElementById(`${prefix}-l-shape`)?.checked,
        l_width: document.getElementById(`${prefix}-l-width`)?.value,
        l_height: document.getElementById(`${prefix}-l-height`)?.value,
    };
}

async function updateStatus(status) {
    if (!activeRemnantId) return;

    const res = await fetch(`/api/remnants/${activeRemnantId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to update status");
    }

    await loadRemnants();
    closeModal("edit-remnant-modal");
    showActionMessage(`Status updated to ${status}.`);
}

async function modifyRemnant() {
    if (!activeRemnantId) return;

    const payload = serializeForm("edit");
    const imageFile = document.getElementById("edit-image-file")?.files?.[0];
    if (imageFile) {
        payload.image_file = await fileToPayload(imageFile);
    }

    const res = await fetch(`/api/remnants/${activeRemnantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to modify remnant");
    }

    await loadRemnants();
    closeModal("edit-remnant-modal");
    showActionMessage("Remnant updated.");
}

async function deleteRemnant() {
    if (!activeRemnantId) return;

    const res = await fetch(`/api/remnants/${activeRemnantId}`, {
        method: "DELETE",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to delete remnant");
    }

    await loadRemnants();
    closeModal("edit-remnant-modal");
    showActionMessage("Remnant deleted.");
}

async function createRemnant() {
    const payload = serializeForm("add");
    const imageFile = document.getElementById("add-image-file")?.files?.[0];
    if (imageFile) {
        payload.image_file = await fileToPayload(imageFile);
    }

    const res = await fetch("/api/remnants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to create remnant");
    }

    await loadRemnants();
    closeModal("add-remnant-modal");
    showActionMessage("Remnant created.");
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

    document.getElementById("edit-mark-available")?.addEventListener("click", async () => {
        try {
            await updateStatus("Available");
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("edit-mark-hold")?.addEventListener("click", async () => {
        try {
            await updateStatus("Hold");
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("edit-mark-sold")?.addEventListener("click", async () => {
        try {
            await updateStatus("Sold");
        } catch (error) {
            showActionMessage(error.message, true);
        }
    });

    document.getElementById("edit-delete")?.addEventListener("click", async () => {
           try {
            await updateStatus("Deleted");
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
