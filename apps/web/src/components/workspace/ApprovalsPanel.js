/* eslint-disable @next/next/no-img-element */
"use client";

export function ApprovalsPanel({
 open,
 onClose,
 pendingApprovals,
 approvingId,
 handleApproveRemnant,
 onEdit,
}) {
 if (!open) return null;

 return (
 <div className="fixed inset-0 z-[71] overflow-y-auto bg-black/50 px-4 py-8">
 <div className="mx-auto max-w-3xl overflow-hidden rounded-sm border border-[color:var(--qc-line)] bg-white ">
 <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--qc-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-500">Pending Approvals</p>
 <span className="inline-flex items-center rounded-full border border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--qc-ink-1)]">
 {pendingApprovals.length} Waiting
 </span>
 </div>
 <h2 className="font-inter mt-1 text-2xl font-semibold text-[color:var(--qc-ink-1)]">Remnants Awaiting Approval</h2>
 <p className="mt-2 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">Review each remnant submitted by managers. Approve to make it available publicly.</p>
 </div>
 <button
 type="button"
 onClick={onClose}
 className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--qc-line)] bg-white text-xl text-[color:var(--qc-ink-1)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[color:var(--qc-bg-page)]"
 aria-label="Close approvals panel"
 >
 {"\u00D7"}
 </button>
 </div>
 <div className="max-h-[70vh] overflow-y-auto p-6">
 {pendingApprovals.length === 0 ? (
 <div className="rounded-sm border border-dashed border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-5 py-10 text-center">
 <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-500">All Clear</p>
 <p className="mt-2 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">No remnants pending approval.</p>
 </div>
 ) : (
 <div className="space-y-3">
 {pendingApprovals.map((remnant) => {
 const isApproving = approvingId === remnant.id;
 const size = remnant.l_shape
 ? `${remnant.width}" × ${remnant.height}" + ${remnant.l_width}" × ${remnant.l_height}"`
 : remnant.width && remnant.height ? `${remnant.width}" × ${remnant.height}"` : "";
 return (
 <article key={remnant.id} className={`flex items-center justify-between gap-4 rounded-sm border border-[color:var(--qc-line)] bg-white p-4 ${isApproving ? "opacity-60" : ""}`}>
 <div className="flex min-w-0 items-center gap-3">
 {remnant.image ? (
 <img
 src={remnant.image}
 alt={remnant.name}
 className="h-14 w-14 shrink-0 rounded-sm border border-[color:var(--qc-line)] object-contain"
 />
 ) : (
 <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border border-dashed border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] text-xs text-[rgba(25,27,28,0.32)]">No img</div>
 )}
 <div className="min-w-0">
 <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-500">#{remnant.moraware_remnant_id || remnant.id}</p>
 <p className="truncate text-sm font-semibold text-[color:var(--qc-ink-1)]">{remnant.name || "Unnamed"}</p>
 <p className="text-xs text-[rgba(25,27,28,0.55)]">{[remnant.material_name, size].filter(Boolean).join(" · ")}</p>
 </div>
 </div>
 <div className="flex shrink-0 items-center gap-2">
 <button
 type="button"
 onClick={() => onEdit(remnant)}
 className="rounded-xl border border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-3 py-2 text-xs font-bold text-[color:var(--qc-ink-1)] transition-colors hover:bg-[rgba(25,27,28,0.08)]"
 >
 Edit
 </button>
 <button
 type="button"
 disabled={isApproving}
 onClick={() => handleApproveRemnant(remnant.id)}
 className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
 >
 {isApproving ? "Approving…" : "Approve"}
 </button>
 </div>
 </article>
 );
 })}
 </div>
 )}
 </div>
 </div>
 </div>
 );
}
