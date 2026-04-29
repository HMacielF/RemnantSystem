/* eslint-disable @next/next/no-img-element */
"use client";

import {
 imageSrc,
 displayRemnantId,
 statusText,
 privateCardHeading,
 privateCardSubheading,
 privateCardMetricEntries,
 remnantColors,
 colorSwatchStyle,
} from "./workspace-utils.js";
import StatusPill from "../public/StatusPill.js";
import ColorTooltip from "../public/ColorTooltip.js";

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
 className="font-inter fixed inset-0 z-[74] bg-black/60 px-4 py-6 sm:px-6 sm:py-10"
 onClick={onClose}
 >
 <div
 className="mx-auto flex h-full max-w-[1180px] flex-col"
 onClick={(event) => event.stopPropagation()}
 >
 <div
 className="flex h-full w-full flex-col overflow-hidden bg-[color:var(--qc-bg-surface)]"
 style={{
 border: "1px solid var(--qc-line)",
 borderRadius: "var(--qc-radius-sharp)",
 boxShadow: "0 32px 90px rgba(0, 0, 0, 0.38)",
 }}
 >
 <div
 className="flex items-center justify-between gap-4 px-5 py-4"
 style={{ borderBottom: "1px solid var(--qc-line)" }}
 >
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-2">
 <StatusPill
 status={statusText(remnant)}
 label={`#${displayRemnantId(remnant)}`}
 location={remnant.location}
 />
 {total > 1 ? (
 <span
 className="px-2 py-1 text-[11px] text-[color:var(--qc-ink-3)]"
 style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
 >
 {index + 1} / {total}
 </span>
 ) : null}
 </div>
 <h2 className="mt-3 text-[22px] font-medium leading-tight tracking-[-0.015em] text-[color:var(--qc-ink-1)] sm:text-[26px]">
 {privateCardHeading(remnant)}
 </h2>
 {privateCardSubheading(remnant) ? (
 <p className="mt-1 text-[10.5px] uppercase tracking-[0.18em] text-[color:var(--qc-orange)]">
 {privateCardSubheading(remnant)}
 </p>
 ) : null}
 <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-[color:var(--qc-ink-2)]">
 {privateCardMetricEntries(remnant).map((entry) => (
 <span
 key={`${displayRemnantId(remnant)}-${entry.label}`}
 title={entry.title}
 className="inline-flex items-center gap-1.5"
 >
 <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
 {entry.label}
 </span>
 <span className="whitespace-nowrap text-[color:var(--qc-ink-1)]">{entry.value}</span>
 </span>
 ))}
 {remnantColors(remnant).length ? (
 <span className="inline-flex items-center gap-2">
 <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
 Color
 </span>
 <span className="flex items-center gap-1.5">
 {remnantColors(remnant).slice(0, 4).map((color) => (
 <ColorTooltip key={`${displayRemnantId(remnant)}-viewer-${color}`} name={color}>
 <span
 aria-hidden="true"
 className="block h-3.5 w-3.5 rounded-full transition-transform group-hover/swatch:scale-110"
 style={{
 ...colorSwatchStyle(color),
 boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.10)",
 }}
 />
 </ColorTooltip>
 ))}
 </span>
 </span>
 ) : null}
 </div>
 </div>
 <div className="flex shrink-0 items-center gap-2">
 <button
 type="button"
 onClick={onClose}
 className="inline-flex h-9 w-9 items-center justify-center text-[20px] leading-none text-[color:var(--qc-ink-2)] transition-colors hover:border-[color:var(--qc-orange)] hover:text-[color:var(--qc-orange)]"
 style={{
 border: "1px solid var(--qc-line)",
 borderRadius: "var(--qc-radius-sharp)",
 }}
 aria-label="Close image preview"
 >
 {"×"}
 </button>
 </div>
 </div>
 <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[#f3f1ee] p-4 sm:p-6">
 {total > 1 ? (
 <>
 <button
 type="button"
 onClick={onPrev}
 className="absolute left-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center bg-white text-[20px] leading-none text-[color:var(--qc-ink-1)] transition-colors hover:border-[color:var(--qc-orange)] hover:text-[color:var(--qc-orange)]"
 style={{
 border: "1px solid var(--qc-line)",
 borderRadius: "var(--qc-radius-sharp)",
 }}
 aria-label="Previous image"
 >
 {"‹"}
 </button>
 <button
 type="button"
 onClick={onNext}
 className="absolute right-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center bg-white text-[20px] leading-none text-[color:var(--qc-ink-1)] transition-colors hover:border-[color:var(--qc-orange)] hover:text-[color:var(--qc-orange)]"
 style={{
 border: "1px solid var(--qc-line)",
 borderRadius: "var(--qc-radius-sharp)",
 }}
 aria-label="Next image"
 >
 {"›"}
 </button>
 </>
 ) : null}
 <img
 src={imageSrc(remnant)}
 alt={`Remnant ${displayRemnantId(remnant)}`}
 className="max-h-full max-w-full object-contain"
 />
 </div>
 </div>
 </div>
 </div>
 );
}
