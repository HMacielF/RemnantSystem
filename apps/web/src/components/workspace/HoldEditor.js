"use client";

import {
 PrivateRemnantSummaryBlock,
 SelectField,
 imageSrc,
 jobNumberPrefixForRemnant,
 normalizeJobNumberInput,
} from "./workspace-utils.js";

export function HoldEditor({
 holdEditor,
 onClose,
 onSave,
 onRelease,
 onSell,
 onFieldChange,
 openImageViewer,
 salesReps,
}) {
 if (!holdEditor) return null;

 return (
 <div className="fixed inset-0 z-[72] overflow-y-auto bg-black/50 px-4 py-8">
 <div className="mx-auto max-w-6xl overflow-hidden rounded-sm border border-[color:var(--qc-line)] bg-white ">
 <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--qc-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
 <div>
 <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Hold</p>
 <h2 className="font-inter text-2xl font-semibold text-[color:var(--qc-ink-1)]">Manage Hold</h2>
 </div>
 <button type="button" onClick={onClose} className="h-10 w-10 rounded-full border border-[color:var(--qc-line)] bg-white text-xl text-[color:var(--qc-ink-1)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[color:var(--qc-bg-page)]">
 {"\u00D7"}
 </button>
 </div>
 <form onSubmit={onSave} className="p-6">
 <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]">
 <div>
 <PrivateRemnantSummaryBlock
 remnant={holdEditor.remnant || {}}
 onOpenImage={() => imageSrc(holdEditor.remnant || {}) && openImageViewer(holdEditor.remnant || {})}
 />
 </div>
 <div className="rounded-sm border border-[color:var(--qc-line)] bg-white p-5 ">
 <div className="rounded-sm border border-[color:var(--qc-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 ">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Hold Details</p>
 <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
 {holdEditor.summary}
 </p>
 </div>
 <span className="rounded-full border border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--qc-ink-1)]">
 {holdEditor.holdId ? "Existing Hold" : "New Hold"}
 </span>
 </div>
 </div>
 <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
 All holds expire automatically after 7 days.
 </p>
 {holdEditor.locked_to_other_owner ? (
 <div className="mt-4 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
 This hold belongs to {holdEditor.current_owner_name || "another sales rep"}. Only that sales rep or a manager can change it.
 </div>
 ) : null}

 <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
 {holdEditor.self_only ? null : (
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] lg:col-span-2">
 Sales Rep
 <SelectField
 value={holdEditor.owner_user_id}
 onChange={(event) => onFieldChange("owner_user_id", event.target.value)}
 disabled={salesReps.length === 0}
 wrapperClassName="relative mt-1"
 className=""
 >
 <option value="">
 {salesReps.length === 0 ? "No active sales reps available" : "Select sales rep"}
 </option>
 {salesReps.map((row) => (
 <option key={row.id} value={row.id}>{row.display_name || row.full_name || row.email || "User"}</option>
 ))}
 </SelectField>
 </label>
 )}
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)]">
 Customer Name
 <input
 type="text"
 value={holdEditor.customer_name}
 onChange={(event) => onFieldChange("customer_name", event.target.value)}
 required
 disabled={holdEditor.locked_to_other_owner}
 placeholder="Customer name"
 className="mt-1 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 py-3 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
 />
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)]">
 Job Number
 <div className="mt-1 flex overflow-hidden rounded-sm border border-[color:var(--qc-line)] bg-white">
 <span className="inline-flex items-center border-r border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-4 text-sm font-semibold text-[var(--brand-orange)]">
 {jobNumberPrefixForRemnant(holdEditor.remnant)}
 </span>
 <input
 type="text"
 value={holdEditor.job_number}
 onChange={(event) => onFieldChange("job_number", normalizeJobNumberInput(event.target.value))}
 required
 disabled={holdEditor.locked_to_other_owner}
 placeholder="1234"
 className="min-w-0 flex-1 bg-white px-4 py-3 text-sm text-[color:var(--qc-ink-1)] outline-none"
 />
 </div>
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] lg:col-span-2">
 Hold Notes
 <textarea
 rows="4"
 value={holdEditor.notes}
 onChange={(event) => onFieldChange("notes", event.target.value)}
 disabled={holdEditor.locked_to_other_owner}
 className="mt-1 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 py-3 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
 placeholder="Optional notes for the team"
 />
 </label>
 </div>

 <div className="mt-6 flex flex-wrap gap-3">
 <button type="submit" disabled={holdEditor.locked_to_other_owner} className="inline-flex h-12 items-center justify-center rounded-sm border border-[var(--brand-orange)] bg-[rgba(247,134,57,0.12)] px-6 text-sm font-semibold text-[var(--brand-orange-deep)] transition-colors hover:bg-[rgba(247,134,57,0.2)] disabled:cursor-not-allowed disabled:opacity-60">
 Save Hold
 </button>
 {holdEditor.holdId ? (
 <button
 type="button"
 onClick={onRelease}
 disabled={holdEditor.locked_to_other_owner}
 className="inline-flex h-12 items-center justify-center rounded-sm border border-emerald-200 bg-emerald-100 px-6 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
 >
 Make Available
 </button>
 ) : null}
 {holdEditor.holdId ? (
 <button
 type="button"
 onClick={onSell}
 disabled={holdEditor.locked_to_other_owner}
 className="inline-flex h-12 items-center justify-center rounded-sm border border-rose-200 bg-rose-100 px-6 text-sm font-semibold text-rose-800 transition-colors hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
 >
 Sell
 </button>
 ) : null}
 <button type="button" onClick={onClose} className="inline-flex h-12 items-center justify-center rounded-sm border border-[color:var(--qc-line)] bg-white px-6 text-sm font-semibold text-[color:var(--qc-ink-1)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[color:var(--qc-bg-page)]">
 Cancel
 </button>
 </div>
 </div>
 </div>
 </form>
 </div>
 </div>
 );
}
