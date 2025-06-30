// === Globals and Constants ===
let allRemnants = [];
let visibleCount = 0;
const PAGE_SIZE = Infinity;


// === Load remnants based on URL filters using /api/remnants ===
async function loadRemnants() {
    try {
        const params = new URLSearchParams(window.location.search);

        // Get /FRV, /Prime, etc. from the path
        const path = window.location.pathname.split('/');
        const owner = path[1].toUpperCase || "QUICK"; // default to Quick
        

        const res = await fetch(`/api/remnants/${owner}?${params.toString()}`);

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Backend error (${res.status}): ${errorText}`);
        }

        const data = await res.json();

        if (!Array.isArray(data)) {
            throw new TypeError("Expected array from /api/remnants, got: " + JSON.stringify(data));
        }

        allRemnants = data;

        await populateMaterialCheckboxes();
        await populateColorFilters();
        initializeFormFromURL();
        applyFilters();
    } catch (err) {
        console.error("❌ Failed to load remnants:", err);
        document.getElementById("remnants-container").innerHTML = `
            <div class="text-red-600 text-center font-semibold">Failed to load remnants. Please try again later.</div>
        `;
    }
}

// === Hardcoded Material Checkboxes ===
async function populateMaterialCheckboxes() {
    const hardcodedMaterials = [
        "Quartz", "Granite", "Marble", "Quartzite", "Porcelain"
    ];

    const container = document.getElementById("material-checkboxes");
    const selectedMaterials = new URLSearchParams(window.location.search).getAll("material");

    container.innerHTML = hardcodedMaterials.map(mat => `
        <label class="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="material" value="${mat}" ${selectedMaterials.includes(mat) ? "checked" : ""}>
            ${mat}
        </label>
    `).join('');
}


async function populateColorFilters() {
    try {
        const colorHexMap = {
            Beige: "#fef3c7",
            Black: "#111827",
            Blue: "#60a5fa",
            Brown: "#92400e",
            Gold: "#facc15",
            Gray: "#9ca3af",
            Green: "#34d399",
            Purple: "#a78bfa",
            Red: "#f87171",
            White: "#f8fafc"
        };

        const colors = Object.keys(colorHexMap); // only hardcoded list

        const selectedColor = new URLSearchParams(window.location.search).get("color");
        const container = document.getElementById("color-swatches");

        // Add ✕ clear option
        container.innerHTML = `
            <label class="cursor-pointer relative color-swatch" data-color="">
                <input type="radio" name="color" value="" class="sr-only" ${!selectedColor ? "checked" : ""}>
                <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-white border-2 shadow"
                    style="border-color: ${!selectedColor ? 'black' : 'white'};">✕</span>
            </label>
        `;

        // Add fixed color swatches
        container.innerHTML += colors.map(name => {
            const hex = colorHexMap[name];
            const isSelected = selectedColor === name;
            return `
                <label class="cursor-pointer relative color-swatch" data-color="${name}">
                    <input type="radio" name="color" value="${name}"
                        class="sr-only" ${isSelected ? "checked" : ""}>
                    <span class="relative group w-6 h-6 rounded-full block border-2 shadow transition-all duration-150"
      style="background-color: ${hex}; border: 2px solid ${name === 'White' ? '#ccc' : isSelected ? 'black' : 'white'}"
>
  <span class="absolute -top-8 left-1/2 -translate-x-1/2 bg-black text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap pointer-events-none">
    ${name}
  </span>
</span>


                </label>
            `;
        }).join('');

        // Apply visual border immediately
        container.querySelectorAll('input[name="color"]').forEach(input => {
            input.addEventListener('change', () => {
                container.querySelectorAll('.color-swatch span').forEach(span => {
                    span.style.borderColor = 'white';
                });

                const selected = input.closest('.color-swatch')?.querySelector('span');
                if (selected) selected.style.borderColor = 'black';
            });
        });

    } catch (err) {
        console.error("❌ Failed to build color filters:", err);
    }
}

// === Initialize form inputs from URL query ===
function initializeFormFromURL() {
    const params = new URLSearchParams(window.location.search);

    const setIfExists = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value || "";
    };

    setIfExists("min-height", params.get("min-height"));
    setIfExists("max-height", params.get("max-height"));
    setIfExists("min-width", params.get("min-width"));
    setIfExists("max-width", params.get("max-width"));
    setIfExists("stone-filter", params.get("stone"));

    const selectedColor = params.get("color");
    if (selectedColor !== null) {
        const colorInput = document.querySelector(`input[name="color"][value="${selectedColor}"]`);
        if (colorInput) colorInput.checked = true;
    }
}



// === Display filtered result cards (first batch) ===
function applyFilters() {
    visibleCount = 0;
    window.filteredRemnants = allRemnants;
    document.getElementById("remnants-container").innerHTML = "";
    renderNextBatch();
}


// === Render the next batch of remnant cards ===
function renderNextBatch() {
    const container = document.getElementById("remnants-container");

    if (!Array.isArray(window.filteredRemnants)) {
        console.warn("filteredRemnants is not an array:", window.filteredRemnants);
        return;
    }

    const nextItems = window.filteredRemnants.slice(visibleCount, visibleCount + PAGE_SIZE);

    nextItems.forEach(remnant => {
        const {
            id, material_type, supplier, stone_name, width, height, l_shape,
            l_shape_width, l_shape_height, status, image_url, location
        } = remnant;

        const isLShape = l_shape && l_shape_width && l_shape_height;
        const size = isLShape
            ? `${width} x ${height} + ${l_shape_width} x ${l_shape_height}`
            : `${width} x ${height}`;

        const displayName = [supplier, stone_name].filter(Boolean).join(" ");
        const statusText = status || "Available";
        const lc = statusText.toLowerCase();

        const statusClass = lc.includes("sold") ? "bg-red-100 text-red-700"
            : lc.includes("hold") ? "bg-yellow-100 text-yellow-800"
                : lc.includes("pending") ? "bg-orange-100 text-orange-800"
                    : "bg-green-100 text-green-700";

        const isAvailable = !status || lc === "available";
        const locationText = (isAvailable && location)
            ? `<p class="text-sm text-gray-600 mt-2"><strong>Location:</strong> ${location}</p>`
            : "";

        const card = document.createElement("div");
        card.className = `
  group relative bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden
`;
        card.innerHTML = `
  <img src="${image_url}" loading="lazy" alt="Remnant Image"
    class="h-48 object-cover w-full transition-transform duration-300 hover:scale-105">

 <!-- Floating Request Hold Button -->
<div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
  <button
      onclick="requestHold('${id}', '${stone_name}', '${material_type}')"
      class="w-10 h-10 rounded-full border-2 border-[#E78B4B] text-[#E78B4B] font-bold bg-white hover:bg-[#E78B4B] hover:text-white flex items-center justify-center shadow-md transition-all duration-300"
      title="Request Hold"
  ></button>
</div>

  <div class="p-4 space-y-1 text-sm text-[#232323]">
    <p><strong>ID:</strong> ${id}</p>
    <p><strong>Material:</strong> ${material_type}</p>
    <p><strong>Stone:</strong> ${displayName}</p>
    <p><strong>Size:</strong> ${size}</p>
    <p><strong>Status:</strong>
      <span class="inline-block text-xs px-2 py-1 rounded-full font-medium ${statusClass}">
        ${statusText}
      </span>
    </p>
    ${locationText}
  </div>
`;


        container.appendChild(card);
    });

    visibleCount += nextItems.length;

    const loadMoreBtn = document.getElementById("load-more");
    if (loadMoreBtn) {
        loadMoreBtn.style.display = visibleCount >= window.filteredRemnants.length ? "none" : "block";
    }
}


let currentHoldInfo = {};

function requestHold(id, stoneName, materialType) {
    currentHoldInfo = { id, stoneName, materialType };
    document.getElementById("client-name").value = "";
    document.getElementById("client-contact").value = "";
    document.getElementById("hold-modal").classList.remove("hidden");
}


// === Image modal zoom/pan logic ===
function openModal(src) {
    const modal = document.createElement("div");
    modal.className = "image-modal fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50";
    modal.innerHTML = `
        <button class="absolute top-4 right-4 text-white text-3xl font-bold" onclick="closeModal()">✕</button>
        <img src="${src}" class="modal-zoom-image max-w-full max-h-full cursor-zoom-in transition-transform duration-300" />
    `;
    document.body.appendChild(modal);

    const img = modal.querySelector('.modal-zoom-image');
    let isZoomed = false;
    let isPanning = false, startX, startY, currentX = 0, currentY = 0;

    img.addEventListener('click', () => {
        isZoomed = !isZoomed;
        img.classList.toggle('zoomed', isZoomed);
        img.style.transform = isZoomed ? 'scale(2)' : 'scale(1)';
    });

    img.addEventListener('mousedown', e => {
        if (!isZoomed) return;
        isPanning = true;
        startX = e.clientX - currentX;
        startY = e.clientY - currentY;
        img.style.cursor = "grabbing";
    });

    document.addEventListener('mousemove', e => {
        if (!isPanning || !isZoomed) return;
        currentX = e.clientX - startX;
        currentY = e.clientY - startY;
        img.style.transform = `scale(2) translate(${currentX}px, ${currentY}px)`;
    });

    document.addEventListener('mouseup', () => {
        isPanning = false;
        img.style.cursor = "zoom-in";
    });

    document.addEventListener('keydown', function escClose(e) {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escClose);
        }
    });
}


// === Close modal
function closeModal() {
    const modal = document.querySelector('.image-modal');
    if (modal) modal.remove();
}


// === Event Listeners ===
document.addEventListener('DOMContentLoaded', () => {
    const loadMoreBtn = document.getElementById("load-more");
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener("click", renderNextBatch);
    }

    const submitBtn = document.getElementById("submit-hold");
    submitBtn.addEventListener("click", async () => {
        const name = document.getElementById("client-name").value.trim();
        const contact = document.getElementById("client-contact").value.trim();

        if (!name || !contact) {
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
                    client_name: name,
                    client_contact: contact,
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Server responded with ${res.status}: ${errText}`);
            }

            alert("✅ Hold request submitted!");
            closeHoldModal();
        } catch (err) {
            console.error("❌ Failed to submit hold:", err);
            alert("❌ Failed to submit request. Please try again.");
        } finally {
            submitBtn.disabled = false;
        }
    });

    loadRemnants();
});

function closeHoldModal() {
    document.getElementById("hold-modal").classList.add("hidden");
}
