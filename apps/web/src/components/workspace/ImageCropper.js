"use client";

import { CROP_CANVAS_WIDTH, CROP_CANVAS_HEIGHT, DEFAULT_CROP_RECT, formatCropRotationLabel } from "./workspace-utils.js";

export function ImageCropper({
  cropModal,
  cropCanvasRef,
  updateCropModal,
  onClose,
  onSave,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}) {
  if (!cropModal) return null;

  return (
    <div className="fixed inset-0 z-[73] overflow-y-auto bg-black/60 px-4 py-8">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-white shadow-[0_30px_80px_rgba(0,0,0,0.28)]">
        <div className="flex items-center justify-between border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,#f7f7f7_100%)] px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Crop Workspace</p>
            <h2 className="font-display text-2xl font-semibold text-[var(--brand-ink)]">Free Crop</h2>
          </div>
          <button type="button" onClick={onClose} className="h-10 w-10 rounded-full border border-[var(--brand-line)] bg-white text-xl text-[var(--brand-ink)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]">
            {"\u00D7"}
          </button>
        </div>
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-[28px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,var(--brand-white)_100%)] p-4 shadow-inner">
            <canvas
              ref={cropCanvasRef}
              width={CROP_CANVAS_WIDTH}
              height={CROP_CANVAS_HEIGHT}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              className="h-auto w-full cursor-grab rounded-[24px] border border-[var(--brand-line)] bg-white shadow-[0_18px_40px_rgba(25,27,28,0.08)]"
            />
          </div>
          <div className="space-y-4 rounded-[28px] border border-[var(--brand-line)] bg-white p-5 shadow-[0_18px_40px_rgba(25,27,28,0.08)]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Controls</p>
              <h3 className="font-display mt-2 text-xl font-semibold text-[var(--brand-ink)]">Rotate and fine-tune</h3>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-white)] px-4 py-3">
                <span className="text-sm font-medium text-[rgba(35,35,35,0.72)]">Rotation</span>
                <span className="rounded-full border border-[var(--brand-line)] bg-white px-3 py-1 text-sm font-semibold text-[var(--brand-ink)]">
                  {formatCropRotationLabel((cropModal.rotationBase || 0) + (cropModal.rotation || 0))}
                </span>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => updateCropModal((current) => ({ ...current, rotationBase: current.rotationBase - 90 }))}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                >
                  Rotate Left
                </button>
                <button
                  type="button"
                  onClick={() => updateCropModal((current) => ({ ...current, rotationBase: current.rotationBase + 90 }))}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
                >
                  Rotate Right
                </button>
              </div>
              <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)]">
                Fine rotation
                <input
                  type="range"
                  min="-45"
                  max="45"
                  value={cropModal.rotation}
                  onChange={(event) => updateCropModal((current) => ({ ...current, rotation: Number(event.target.value || 0) }))}
                  className="mt-3 w-full accent-[var(--brand-orange)]"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => updateCropModal((current) => ({
                  ...current,
                  scale: current.baseScale,
                  offsetX: 0,
                  offsetY: 0,
                  rotationBase: 0,
                  rotation: 0,
                  cropRect: { ...DEFAULT_CROP_RECT },
                }))}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-5 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[var(--brand-white)]"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={onSave}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-orange)]"
              >
                Save Crop
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
