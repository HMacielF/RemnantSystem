const MATERIALS = ["Quartz", "Granite", "Marble", "Quartzite", "Porcelain"];
const LIVE_SEARCH_DELAY_MS = 300;

let allRemnants = [];
let currentHoldInfo = {};
let debounceTimer = null;
let activeAbortController = null;

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
    if (remnant.l_shape && remnant.l_width && remnant.l_height) {
        return `${remnant.width} x ${remnant.height} + ${remnant.l_width} x ${remnant.l_height}`;
    }
    return `${remnant.width} x ${remnant.height}`;
}

function imageSrc(remnant) {
    return remnant.image || remnant.source_image_url || "";
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
            <img src="${imageSrc(remnant)}" loading="lazy" alt="Remnant Image"
                class="h-48 object-cover w-full transition-transform duration-300 hover:scale-105"
                onerror="this.src=''; this.classList.add('bg-gray-100');">

            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onclick="requestHold('${remnant.id}', '${(remnant.name || "").replace(/'/g, "\\'")}', '${(remnant.material || "").replace(/'/g, "\\'")}')"
                    class="w-10 h-10 rounded-full border-2 border-[#E78B4B] text-[#E78B4B] font-bold bg-white hover:bg-[#E78B4B] hover:text-white flex items-center justify-center shadow-md transition-all duration-300"
                    title="Request Hold"
                >+</button>
            </div>

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

function requestHold(id, stoneName, material) {
    currentHoldInfo = { id, stoneName, material };
    const modal = document.getElementById("hold-modal");
    if (!modal) return;
    document.getElementById("client-name").value = "";
    document.getElementById("client-contact").value = "";
    modal.classList.remove("hidden");
}

function closeHoldModal() {
    const modal = document.getElementById("hold-modal");
    if (modal) modal.classList.add("hidden");
}

async function submitHoldRequest() {
    const submitBtn = document.getElementById("submit-hold");
    const clientName = document.getElementById("client-name").value.trim();
    const clientContact = document.getElementById("client-contact").value.trim();

    if (!clientName || !clientContact) {
        alert("Please enter both name and contact.");
        return;
    }

    submitBtn.disabled = true;
    try {
        const res = await fetch("/api/hold_requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                remnant_id: currentHoldInfo.id,
                client_name: clientName,
                client_contact: clientContact,
            }),
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Server responded with ${res.status}: ${errorText}`);
        }

        alert("Hold request submitted.");
        closeHoldModal();
    } catch (err) {
        console.error("Failed to submit hold request:", err);
        alert("Failed to submit request. Please try again.");
    } finally {
        submitBtn.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    renderMaterialCheckboxes();
    initFormFromURL();

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

    const submitHoldButton = document.getElementById("submit-hold");
    if (submitHoldButton) {
        submitHoldButton.addEventListener("click", submitHoldRequest);
    }

    loadRemnants();
});

window.requestHold = requestHold;
window.closeHoldModal = closeHoldModal;
