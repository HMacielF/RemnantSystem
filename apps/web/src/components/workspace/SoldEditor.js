"use client";

import {
  PrivateRemnantSummaryBlock,
  SelectField,
  imageSrc,
  jobNumberPrefixForRemnant,
  normalizeJobNumberInput,
  profileDisplayName,
} from "./workspace-utils.js";

export function SoldEditor({
  soldEditor,
  onClose,
  onSave,
  onFieldChange,
  openImageViewer,
  salesReps,
  profile,
}) {
  if (!soldEditor) return null;

  return (
    <div className="fixed inset-0 z-[72] overflow-y-auto bg-black/50 px-4 py-8">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-white shadow-[0_24px_70px_rgba(25,27,28,0.14)]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Sold</p>
            <h2 className="font-display text-2xl font-semibold text-[var(--brand-ink)]">Mark as Sold</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
          >
            {"\u00D7"}
          </button>
        </div>
        <form onSubmit={onSave} className="p-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]">
            <div>
              <PrivateRemnantSummaryBlock
                remnant={soldEditor.remnant || {}}
                onOpenImage={() => imageSrc(soldEditor.remnant || {}) && openImageViewer(soldEditor.remnant || {})}
              />
            </div>
            <div className="rounded-[28px] border border-[var(--brand-line)] bg-white p-5 shadow-[0_16px_38px_rgba(25,27,28,0.06)]">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {soldEditor.self_only ? (
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] lg:col-span-2">
                    Sales Rep
                    <div className="mt-1 flex min-h-12 items-center rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-white)] px-4 py-3 text-sm text-[var(--brand-ink)]">
                      {profileDisplayName(profile)}
                    </div>
                  </label>
                ) : (
                  <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] lg:col-span-2">
                    Sales Rep
                    <SelectField
                      value={soldEditor.sold_by_user_id}
                      onChange={(event) => onFieldChange("sold_by_user_id", event.target.value)}
                      required
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
                  Job Number
                  <div className="mt-1 flex overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white">
                    <span className="inline-flex items-center border-r border-[var(--brand-line)] bg-[var(--brand-white)] px-4 text-sm font-semibold text-[var(--brand-orange)]">
                      {jobNumberPrefixForRemnant(soldEditor.remnant)}
                    </span>
                    <input
                      type="text"
                      value={soldEditor.job_number}
                      onChange={(event) => onFieldChange("job_number", normalizeJobNumberInput(event.target.value))}
                      required
                      placeholder="1234"
                      className="min-w-0 flex-1 bg-white px-4 py-3 text-sm text-[var(--brand-ink)] outline-none"
                    />
                  </div>
                </label>
                <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] lg:col-span-2">
                  Sold Notes
                  <textarea
                    rows="4"
                    value={soldEditor.notes}
                    onChange={(event) => onFieldChange("notes", event.target.value)}
                    className="mt-1 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-[var(--brand-ink)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                    placeholder="Optional notes"
                  />
                </label>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="submit" className="inline-flex h-12 items-center justify-center rounded-2xl border border-rose-200 bg-rose-100 px-6 text-sm font-semibold text-rose-800 transition-colors hover:bg-rose-200">
                  Save Sale
                </button>
                <button type="button" onClick={onClose} className="inline-flex h-12 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-6 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]">
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
