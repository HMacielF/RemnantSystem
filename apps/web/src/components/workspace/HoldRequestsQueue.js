"use client";

import {
 PrivateRemnantSummaryBlock,
 imageSrc,
 jobNumberPrefixForRemnant,
 normalizeJobNumberInput,
} from "./workspace-utils.js";

export function HoldRequestsQueue({
 open,
 onClose,
 holdRequests,
 holdRequestDrafts,
 setHoldRequestDrafts,
 pendingReviewId,
 reviewHoldRequest,
 workspaceCopy,
 openImageViewer,
}) {
 if (!open) return null;

 return (
 <div className="fixed inset-0 z-[71] overflow-y-auto bg-black/50 px-4 py-8">
 <div className="mx-auto max-w-5xl overflow-hidden rounded-sm border border-[color:var(--qc-line)] bg-white ">
 <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--qc-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">Queue</p>
 <span className="inline-flex items-center rounded-full border border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--qc-ink-1)]">
 {holdRequests.length} Pending
 </span>
 </div>
 <h2 className="font-inter mt-1 text-2xl font-semibold text-[color:var(--qc-ink-1)]">{workspaceCopy.queueTitle}</h2>
 <p className="mt-2 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">{workspaceCopy.queueDescription}</p>
 </div>
 <button
 type="button"
 onClick={onClose}
 className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--qc-line)] bg-white text-xl text-[color:var(--qc-ink-1)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[color:var(--qc-bg-page)]"
 aria-label="Close request queue"
 >
 {"\u00D7"}
 </button>
 </div>

 <div className="max-h-[70vh] overflow-y-auto p-6">
 {holdRequests.length === 0 ? (
 <div className="rounded-sm border border-dashed border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-5 py-10 text-center text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
 <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">No Requests</p>
 <p className="mt-2 text-sm">There are no hold requests to review right now.</p>
 </div>
 ) : (
 <div className="space-y-3">
 {holdRequests.map((request) => {
 const isPending = pendingReviewId === String(request.id);
 const requestRemnant = request.remnant || {};
 const requestMessage = String(request.notes || "").trim();
 const requestDisplayId =
 requestRemnant.display_id || requestRemnant.moraware_remnant_id || requestRemnant.id || request.remnant_id;

 return (
 <article key={request.id} className={`rounded-sm border border-[color:var(--qc-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 ${isPending ? "opacity-60 saturate-75" : ""}`}>
 <div className="min-w-0">
 <PrivateRemnantSummaryBlock
 remnant={requestRemnant}
 className=""
 onOpenImage={() => imageSrc(requestRemnant) && openImageViewer(requestRemnant)}
 />

 <div className="mt-4 rounded-sm border border-[color:var(--qc-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 ">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Client Details</p>
 <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
 Review who sent the request before you approve it.
 </p>
 </div>
 </div>

 <div className="mt-4 grid gap-3 sm:grid-cols-2">
 <div className="rounded-sm border border-[color:var(--qc-line)] bg-white p-4">
 <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Client Name</p>
 <p className="mt-2 break-words text-sm font-medium text-[color:var(--qc-ink-1)]">
 {request.requester_name || "Unknown"}
 </p>
 </div>
 <div className="rounded-sm border border-[color:var(--qc-line)] bg-white p-4">
 <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Client Email</p>
 <p className="mt-2 break-all text-sm font-medium text-[color:var(--qc-ink-1)]">
 {request.requester_email || "Unknown"}
 </p>
 </div>
 </div>

 <div className="mt-3 rounded-sm border border-[color:var(--qc-line)] bg-white p-4">
 <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Client Message</p>
 <p className="mt-2 text-sm leading-6 text-[color:color-mix(in_srgb,var(--brand-ink)_80%,white)]">
 {requestMessage || "No message provided."}
 </p>
 </div>
 </div>

 <div className="mt-4 rounded-sm border border-[color:var(--qc-line)] bg-white p-4 ">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Review Action</p>
 <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
 Add the job number, then approve or deny the request.
 </p>
 </div>
 </div>

 <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_170px_170px] lg:items-end">
 <label className="block text-sm font-medium text-[color:color-mix(in_srgb,var(--brand-ink)_82%,white)]">
 Job Number
 <div className="mt-1 flex overflow-hidden rounded-sm border border-[color:var(--qc-line)] bg-white ">
 <span className="inline-flex items-center border-r border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-4 text-sm font-semibold text-[var(--brand-orange)]">
 {jobNumberPrefixForRemnant(requestRemnant)}
 </span>
 <input
 type="text"
 value={normalizeJobNumberInput(holdRequestDrafts[request.id] ?? request.job_number ?? "")}
 onChange={(event) =>
 setHoldRequestDrafts((current) => ({
 ...current,
 [request.id]: normalizeJobNumberInput(event.target.value),
 }))
 }
 placeholder="1234"
 className="min-w-0 flex-1 bg-white px-4 py-3 text-sm text-[color:var(--qc-ink-1)] outline-none"
 />
 </div>
 </label>
 <button
 type="button"
 disabled={isPending}
 onClick={() => reviewHoldRequest(request.id, "approved")}
 className="inline-flex h-12 items-center justify-center rounded-sm border border-emerald-200 bg-emerald-100 px-5 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
 >
 {isPending ? "Working..." : "Approve"}
 </button>
 <button
 type="button"
 disabled={isPending}
 onClick={() => reviewHoldRequest(request.id, "rejected")}
 className="inline-flex h-12 items-center justify-center rounded-sm border border-rose-200 bg-rose-100 px-5 text-sm font-semibold text-rose-800 transition-colors hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
 >
 {isPending ? "Working..." : "Deny"}
 </button>
 </div>
 </div>
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
