let allRemnants = [];
let visibleCount = 0;
const PAGE_SIZE = 20;

async function fetchRemnants() {
    const res = await fetch("/api/remnants");
    const data = await res.json();
    allRemnants = data;
    populateMaterialCheckboxes();
    initializeFormFromURL();
    applyFilters();
}

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

function initializeFormFromURL() {
    const params = new URLSearchParams(window.location.search);
    document.getElementById("stone-filter").value = params.get("stone") || "";
    document.getElementById("min-width").value = params.get("min-width") || "";
    document.getElementById("min-height").value = params.get("min-height") || "";
}

function getCheckedMaterials() {
    return Array.from(document.querySelectorAll('#material-checkboxes input:checked')).map(cb => cb.value);
}

function applyFilters() {
    visibleCount = 0;
    const selectedMaterials = getCheckedMaterials();
    const stone = document.getElementById("stone-filter").value.toLowerCase();
    const minWidth = parseFloat(document.getElementById("min-width").value);
    const minHeight = parseFloat(document.getElementById("min-height").value);

    const filtered = allRemnants.filter(r => {
        const nameMatch = (r.stone_name || '').toLowerCase().includes(stone);
        const materialMatch = selectedMaterials.length === 0 || selectedMaterials.includes(r.material_type);
        const width = r.width + (r.l_shape ? r.l_shape_width || 0 : 0);
        const height = r.height + (r.l_shape ? r.l_shape_height || 0 : 0);
        const sizeMatch = (!minWidth || width >= minWidth) && (!minHeight || height >= minHeight);
        return nameMatch && materialMatch && sizeMatch;
    });

    window.filteredRemnants = filtered;
    document.getElementById("remnants-container").innerHTML = "";
    renderNextBatch();
}

function renderNextBatch() {
    const container = document.getElementById("remnants-container");
    const nextItems = window.filteredRemnants.slice(visibleCount, visibleCount + PAGE_SIZE);

    nextItems.forEach(remnant => {
        const {
            id, material_type, supplier, stone_name, width, height, l_shape,
            l_shape_width, l_shape_height, status_id, image_url
        } = remnant;

        const size = l_shape
            ? `${width} x ${height} + ${l_shape_width} x ${l_shape_height}`
            : `${width} x ${height}`;

        const displayName = [supplier, stone_name].filter(Boolean).join(" ");
        const statusText = status_id || "Available";
        const lc = statusText.toLowerCase();
        const statusClass = lc.includes("sold") ? "sold" : lc.includes("hold") ? "hold" : "available";

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
      </div>
    `;
        container.appendChild(card);
    });

    visibleCount += nextItems.length;

    const loadMoreBtn = document.getElementById("load-more");
    if (visibleCount >= window.filteredRemnants.length) {
        loadMoreBtn.style.display = "none";
    } else {
        loadMoreBtn.style.display = "block";
    }
}

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

    img.addEventListener('click', () => {
        isZoomed = !isZoomed;
        if (isZoomed) {
            img.classList.add('zoomed');
            img.style.transform = 'scale(2)';
        } else {
            img.classList.remove('zoomed');
            img.style.transform = 'scale(1)';
        }
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

function closeModal() {
    const modal = document.querySelector('.image-modal');
    if (modal) modal.remove();
}

document.getElementById("load-more").addEventListener("click", renderNextBatch);
document.addEventListener('DOMContentLoaded', fetchRemnants);
