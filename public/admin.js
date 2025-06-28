document.addEventListener("DOMContentLoaded", async () => {
    try {
        const res = await fetch("/api/me");
        const user = await res.json();
        document.getElementById("user-role").innerHTML = `
      👤 <span class="font-medium">${user.email}</span>
      <span class="ml-1 text-xs text-gray-500">(${user.role})</span>
    `;
    } catch (err) {
        window.location.href = "/login.html";
        return;
    }

    loadRemnants();
    loadHoldRequests();
});

// Load all remnants from backend (view tab)
async function loadRemnants() {
    const res = await fetch("/api/admin_remnants");
    const data = await res.json();
    const tbody = document.getElementById("remnants-table-body");
    tbody.innerHTML = "";

    data.forEach((r) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td>${r.id}</td>
      <td>${r.material_type}</td>
      <td>${r.stone_name}</td>
      <td>${r.status}</td>
      <td>${r.location}</td>
      <td>${r.owner}</td>
      <td>✏️</td>
    `;
        tbody.appendChild(tr);
    });
}

async function loadHoldRequests() {
    const res = await fetch("/api/hold_requests");
    const data = await res.json();
    const tbody = document.getElementById("holds-table-body");
    tbody.innerHTML = "";

    data.forEach((req) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td>${req.stone_name} (${req.material_type})</td>
      <td>${req.client_name}<br><small>${req.client_contact}</small></td>
      <td><strong>${req.status}</strong></td>
      <td>${new Date(req.created_at).toLocaleString()}</td>
      <td>${req.owner}</td>
      <td>
        ${req.status === "pending"
                ? `
            <button onclick="approveRequest('${req.hold_id}')">✅</button>
            <button onclick="rejectRequest('${req.hold_id}')">❌</button>
          `
                : "-"
            }
      </td>
    `;
        tbody.appendChild(tr);
    });
}

async function approveRequest(id) {
    const res = await fetch(`/api/hold_requests/${id}/approve`, { method: "POST" });
    alert(res.ok ? "✅ Approved" : "❌ Failed to approve");
    loadHoldRequests();
}

async function rejectRequest(id) {
    if (!confirm("Reject this hold request?")) return;
    const res = await fetch(`/api/hold_requests/${id}/reject`, { method: "POST" });
    alert(res.ok ? "❌ Rejected" : "❌ Failed to reject");
    loadHoldRequests();
}
