let allRemnants = [];      // Data from backend (already filtered)
let visibleCount = 0;      // Tracks how many items are shown
const PAGE_SIZE = 20;      // Number of items to load per batch

// Fetch data from backend based on URL filters
async function fetchRemnants() {
    const params = new URLSearchParams(window.location.search);
    const res = await fetch(`/api/remnants?${params.toString()}`);
    const data = await res.json();
    allRemnants = data;
    populateMaterialCheckboxes(); // Set material checkboxes
    initializeFormFromURL();      // Set input fields based on URL
    applyFilters();               // Display results (backend already filtered)
}

// Build material checkboxes from dataset
function populateMaterialCheckboxes() {
    const materials = Array.from(new Set(allRemnants.map(r => r.material_type).filter(Boolean)));
    const container = document.getElementById("material-checkboxes");

    const urlParams = new URLSearchParams(window.location.search);
    const selectedMaterials = urlParams.getAll("material");

    container.innerHTML = materials.map(mat => {
        const checked = selectedMaterials.includes(mat) ? "checked" : "";
        return `<label><input type="checkbox" name="material" value="${mat}" ${checked}/> ${mat}</label>`;
    }).join('');
}

// Set input fields (stone name, size filters) based on URL
function initializeFormFromURL() {
    const params = new URLSearchParams(window.location.search);
    document.getElementById("stone-filter").value = params.get("stone") || "";
    document.getElementById("min-width").value = params.get("min-width") || "";
    document.getElementById("min-height").value = params.get("min-height") || "";
}

// Just pass backend-filtered data to render
function applyFilters() {
    visibleCount = 0;
    window.filteredRemnants = allRemnants;
    document.getElementById("remnants-container").innerHTML = "";
    renderNextBatch(); // Render first batch of results
}

// Render cards (20 at a time)
function renderNextBatch() {
    const container = document.getElementById("remnants-container");
    const nextItems = window.filteredRemnants.slice(visibleCount, visibleCount + PAGE_SIZE);

    nextItems.forEach(remnant => {
        const {
            id, material_type, supplier, stone_name, width, height, l_shape,
            l_shape_width, l_shape_height, status_id, image_url, location
        } = remnant;

        const size = l_shape
            ? `${width} x ${height} + ${l_shape_width} x ${l_shape_height}`
            : `${width} x ${height}`;

        const displayName = [supplier, stone_name].filter(Boolean).join(" ");
        const statusText = status_id || "Available";
        const lc = statusText.toLowerCase();
        const statusClass = lc.includes("sold") ? "sold" : lc.includes("hold") ? "hold" : "available";

        // Show location only if available or empty
        const isAvailable = !status_id || lc === "available";
        const locationText = (isAvailable && location)
            ? `<p><strong>Location:</strong> ${location}</p>`
            : "";

        const card = document.createElement("div");
        card.className = "remnant";
        card.innerHTML = `
            <img src="${image_url}" loading="lazy" alt="Remnant Image" class="remnant-img" onclick="openModal('${image_url}')">
            <div class="remnant-info">
                <p><strong>ID:</strong> ${id}</p>
                <p><strong>Material:</strong> ${material_type}</p>
                <p><strong>Stone:</strong> ${displayName}</p>
                <p><strong>Status:</strong> <span class="status-badge ${statusClass}">${statusText}</span></p>
                <p><strong>Size:</strong> ${size}</p>
                ${locationText}
            </div>
        `;
        container.appendChild(card);
    });

    visibleCount += nextItems.length;

    // Show or hide Load More button
    const loadMoreBtn = document.getElementById("load-more");
    loadMoreBtn.style.display = visibleCount >= window.filteredRemnants.length ? "none" : "block";
}

// Open image modal with zoom and pan
function openModal(src) {
    const modal = document.createElement("div");
    modal.className = "image-modal";
    modal.innerHTML = `
        <button class="close-button" onclick="closeModal()">✕</button>
        <div class="modal-overlay"></div>
        <img src="${src}" class="modal-zoom-image" />
    `;
    document.body.appendChild(modal);

    const img = modal.querySelector('.modal-zoom-image');
    let isZoomed = false;
    let isPanning = false, startX, startY, currentX = 0, currentY = 0;

    // Toggle zoom
    img.addEventListener('click', () => {
        isZoomed = !isZoomed;
        img.classList.toggle('zoomed', isZoomed);
        img.style.transform = isZoomed ? 'scale(2)' : 'scale(1)';
    });

    // Drag to pan
    img.addEventListener('mousedown', e => {
        if (!isZoomed) return;
        isPanning = true;
        startX = e.clientX - currentX;
        startY = e.clientY - currentY;
        img.style.cursor = "grabbing";
    });

    // Pan image while dragging
    document.addEventListener('mousemove', e => {
        if (!isPanning || !isZoomed) return;
        currentX = e.clientX - startX;
        currentY = e.clientY - startY;
        img.style.transform = `scale(2) translate(${currentX}px, ${currentY}px)`;
    });

    // Stop panning
    document.addEventListener('mouseup', () => {
        isPanning = false;
        img.style.cursor = "zoom-in";
    });

    // Close modal with Escape
    document.addEventListener('keydown', function escClose(e) {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escClose);
        }
    });
}

// Close modal
function closeModal() {
    const modal = document.querySelector('.image-modal');
    if (modal) modal.remove();
}

// Set up event listeners
document.getElementById("load-more").addEventListener("click", renderNextBatch);
document.addEventListener('DOMContentLoaded', fetchRemnants);