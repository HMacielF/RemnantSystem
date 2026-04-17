"use client";

import {
  PrivateRemnantSummaryBlock,
  imageSrc,
  normalizeRemnantStatus,
  formatDateLabel,
  formatJobNumber,
} from "./workspace-utils.js";

export function MyHoldsPanel({
  open,
  onClose,
  myHolds,
  myHoldsLoading,
  workingRemnantId,
  changeRemnantStatus,
  openHoldEditor,
  openImageViewer,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[71] overflow-y-auto bg-black/50 px-4 py-8">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-white shadow-[0_24px_70px_rgba(35,35,35,0.14)]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">Holds</p>
              <span className="inline-flex items-center rounded-full border border-[var(--brand-line)] bg-[var(--brand-white)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-ink)]">
                {myHolds.length} Active
              </span>
            </div>
            <h2 className="font-display mt-1 text-2xl font-semibold text-[var(--brand-ink)]">Holds</h2>
            <p className="mt-2 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
              View the stones currently under your hold, when they expire, and the original requester details.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
            aria-label="Close my holds"
          >
            {"\u00D7"}
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-6">
          {myHoldsLoading ? (
            <div className="rounded-[24px] border border-dashed border-[var(--brand-line)] bg-[var(--brand-white)] px-5 py-10 text-center text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Loading</p>
              <p className="mt-2 text-sm">Refreshing your active holds.</p>
            </div>
          ) : myHolds.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-[var(--brand-line)] bg-[var(--brand-white)] px-5 py-10 text-center text-[color:color-mix(in_srgb,var(--brand-ink)_72%,white)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">No Holds</p>
              <p className="mt-2 text-sm">You do not have any active holds right now.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {myHolds.map((hold) => {
                const holdRemnant = hold.remnant || {};
                const requesterName = hold.customer_name || hold.requester_name || "Customer name unavailable";
                const requesterEmail = hold.requester_email || "Not provided";
                const requesterMessage = hold.requester_message || hold.notes || "No message provided.";
                const holdStatus = String(hold.status || "active").trim().toLowerCase();
                const remnantStatus = normalizeRemnantStatus(holdRemnant);
                const isWorking = workingRemnantId === String(holdRemnant.id || hold.remnant_id || hold.id);
                const holdStatusClass =
                  holdStatus === "expired"
                    ? "bg-rose-100 text-rose-800 ring-1 ring-rose-300"
                    : "bg-amber-100 text-amber-900 ring-1 ring-amber-300";

                return (
                  <article key={hold.id} className="rounded-[26px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 shadow-sm">
                    <div className="min-w-0">
                      <PrivateRemnantSummaryBlock
                        remnant={holdRemnant}
                        className=""
                        onOpenImage={() => imageSrc(holdRemnant) && openImageViewer(holdRemnant)}
                      />

                      <div className="mt-4 rounded-[24px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 shadow-[0_10px_24px_rgba(25,27,28,0.04)]">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Hold Details</p>
                            <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
                              Review the active hold, requester details, and expiration date.
                            </p>
                          </div>
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${holdStatusClass}`}>
                            {holdStatus === "expired" ? "Expired" : "On Hold"}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Customer</p>
                            <p className="mt-2 break-words text-sm font-medium text-[var(--brand-ink)]">{requesterName}</p>
                          </div>
                          <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Email</p>
                            <p className="mt-2 break-all text-sm font-medium text-[var(--brand-ink)]">{requesterEmail}</p>
                          </div>
                          <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Job</p>
                            <p className="mt-2 text-sm font-medium text-[var(--brand-ink)]">{hold.job_number ? formatJobNumber(hold.job_number, holdRemnant) : "Unknown"}</p>
                          </div>
                          <div className="rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Expires</p>
                            <p className="mt-2 text-sm font-medium text-[var(--brand-ink)]">{formatDateLabel(hold.expires_at)}</p>
                          </div>
                        </div>

                        <div className="mt-3 rounded-[22px] border border-[var(--brand-line)] bg-white p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Client Message</p>
                          <p className="mt-2 break-words text-sm leading-6 text-[color:color-mix(in_srgb,var(--brand-ink)_80%,white)]">{requesterMessage}</p>
                        </div>
                      </div>

                      <div className="mt-4 rounded-[24px] border border-[var(--brand-line)] bg-white p-4 shadow-[0_10px_24px_rgba(25,27,28,0.04)]">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Hold Actions</p>
                            <p className="mt-1 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_70%,white)]">
                              Release this remnant back to available or mark it as sold.
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            disabled={isWorking || remnantStatus === "available"}
                            onClick={() => changeRemnantStatus(holdRemnant, "available")}
                            className="inline-flex h-12 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-100 px-5 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isWorking ? "Working..." : "Make Available"}
                          </button>
                          <button
                            type="button"
                            disabled={remnantStatus === "sold"}
                            onClick={() => changeRemnantStatus(holdRemnant, "sold")}
                            className="inline-flex h-12 items-center justify-center rounded-2xl border border-rose-200 bg-rose-100 px-5 text-sm font-semibold text-rose-800 transition-colors hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Sell
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
