"use client";

import {
  PrivateRemnantSummaryBlock,
  imageSrc,
  formatDateLabel,
  formatJobNumber,
} from "./workspace-utils.js";

export function MySoldPanel({
  open,
  onClose,
  mySold,
  mySoldLoading,
  openImageViewer,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[71] overflow-y-auto bg-black/50 px-4 py-8">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-white shadow-modal">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">Sold</p>
              <span className="inline-flex items-center rounded-full border border-[var(--brand-line)] bg-[var(--brand-white)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-ink)]">
                {mySold.length} Total
              </span>
            </div>
            <h2 className="font-display mt-1 text-2xl font-semibold text-[var(--brand-ink)]">Sold Remnants</h2>
            <p className="mt-2 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
              Review the remnants you marked as sold, including the job number and sale notes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
            aria-label="Close my sold"
          >
            {"\u00D7"}
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-6">
          {mySoldLoading ? (
            <div className="rounded-[24px] border border-dashed border-[var(--brand-line)] bg-[var(--brand-white)] px-5 py-10 text-center text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Loading</p>
              <p className="mt-2 text-sm">Refreshing your sold remnants.</p>
            </div>
          ) : mySold.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-[var(--brand-line)] bg-[var(--brand-white)] px-5 py-10 text-center text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">No Sold Remnants</p>
              <p className="mt-2 text-sm">You have not marked any remnants as sold yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {mySold.map((sale) => {
                const soldRemnant = sale.remnant || {};

                return (
                  <article key={sale.id} className="rounded-[26px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 shadow-sm">
                    <div className="min-w-0">
                      <PrivateRemnantSummaryBlock
                        remnant={soldRemnant}
                        className=""
                        onOpenImage={() => imageSrc(soldRemnant) && openImageViewer(soldRemnant)}
                      />

                      <div className="mt-4 rounded-[24px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 shadow-[0_10px_24px_rgba(25,27,28,0.04)]">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Sale Details</p>
                            <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
                              Review when the remnant sold, the job reference, and sale notes.
                            </p>
                          </div>
                          <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-800 ring-1 ring-rose-300">
                            Sold
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Sold At</p>
                            <p className="mt-2 text-sm font-medium text-[var(--brand-ink)]">{formatDateLabel(sale.sold_at || sale.created_at)}</p>
                          </div>
                          <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Job</p>
                            <p className="mt-2 text-sm font-medium text-[var(--brand-ink)]">{sale.job_number ? formatJobNumber(sale.job_number, soldRemnant) : "Unknown"}</p>
                          </div>
                        </div>

                        <div className="mt-3 rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Sale Notes</p>
                          <p className="mt-2 break-words text-sm leading-6 text-[color:color-mix(in_srgb,var(--brand-ink)_80%,white)]">{String(sale.notes || "").trim() || "No sale notes provided."}</p>
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
