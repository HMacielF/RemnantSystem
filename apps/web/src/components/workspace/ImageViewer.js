/* eslint-disable @next/next/no-img-element */
"use client";

import {
  imageSrc,
  displayRemnantId,
  statusBadgeClass,
  statusBadgeText,
  normalizeRemnantStatus,
  privateCardHeading,
  privateCardSubheading,
  privateCardMetricEntries,
  remnantColors,
  colorSwatchStyle,
} from "./workspace-utils.js";

export function ImageViewer({
  remnant,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}) {
  if (!remnant) return null;

  return (
    <div
      className="fixed inset-0 z-[73] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_24%),linear-gradient(180deg,rgba(12,12,12,0.86),rgba(8,8,8,0.92))] px-3 py-4 sm:px-4 sm:py-6"
      onClick={onClose}
    >
      <div className="mx-auto flex h-full max-w-[1180px] flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="flex h-full w-full flex-col overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(30,30,30,0.82),rgba(16,16,16,0.9))] shadow-[0_32px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-4 py-4 text-white sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85">
                    ID #{displayRemnantId(remnant)}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                    {index + 1} / {total}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusBadgeClass(normalizeRemnantStatus(remnant))}`}>
                    {statusBadgeText(remnant)}
                  </span>
                </div>
                <h2 className="font-display mt-3 text-xl font-semibold text-white sm:text-[2rem]">
                  {privateCardHeading(remnant)}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/68">
                  {privateCardSubheading(remnant) ? (
                    <span>{privateCardSubheading(remnant)}</span>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {privateCardMetricEntries(remnant).map((entry) => (
                    <span
                      key={`${displayRemnantId(remnant)}-${entry.label}`}
                      title={entry.title}
                      className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] text-white/88"
                    >
                      <span className="font-semibold uppercase tracking-[0.08em] text-white/60">{entry.label}</span>
                      <span className="whitespace-nowrap font-medium">{entry.value}</span>
                    </span>
                  ))}
                  {remnantColors(remnant).map((color) => (
                    <span
                      key={`${displayRemnantId(remnant)}-viewer-${color}`}
                      className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-[11px] font-medium text-white/82"
                    >
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 rounded-full border border-white/20"
                        style={colorSwatchStyle(color)}
                      />
                      {color}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/8 text-2xl text-white transition-colors hover:border-white/25 hover:bg-white/16"
                  aria-label="Close image preview"
                >
                  {"\u00D7"}
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-4">
              <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_26%),linear-gradient(180deg,#1a1a1a_0%,#111111_100%)] p-2 sm:p-3">
                {total > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={onPrev}
                      className="absolute left-3 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/35 text-2xl text-white shadow-lg backdrop-blur transition-colors hover:bg-black/50"
                      aria-label="Previous image"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={onNext}
                      className="absolute right-3 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/35 text-2xl text-white shadow-lg backdrop-blur transition-colors hover:bg-black/50"
                      aria-label="Next image"
                    >
                      ›
                    </button>
                  </>
                ) : null}
                <img
                  src={imageSrc(remnant)}
                  alt={`Remnant ${displayRemnantId(remnant)}`}
                  className="max-h-full max-w-full rounded-[24px] object-contain shadow-[0_24px_60px_rgba(0,0,0,0.3)]"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
