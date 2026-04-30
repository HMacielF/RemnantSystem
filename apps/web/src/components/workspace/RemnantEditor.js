/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
 InAppSelect,
 colorListIncludes,
 colorSwatchStyle,
 normalizeStoneLookupName,
 stoneLookupMatchesName,
 stoneNameWithoutBrandPrefix,
 supportsBrandField,
 cropSourceUrl,
 preferredCropType,
 imagePayloadFromDataUrl,
 normalizeCropDraft,
 cropGeometry,
 renderCropCanvas,
 loadImageElement,
 fileToPayload,
 canvasPointFromPointer,
 cropHandles,
 pointInCropRect,
 apiFetch,
 CROP_ASPECT_RATIO,
 CROP_CANVAS_WIDTH,
 CROP_CANVAS_HEIGHT,
 DEFAULT_CROP_RECT,
} from "./workspace-utils.js";
import { ImageCropper } from "./ImageCropper.js";

export function RemnantEditor({
 editorMode,
 editorForm,
 setEditorForm,
 onClose,
 onSave,
 onArchive,
 profile,
 lookups,
 activeLookupColors,
 canEditLinkedSlab,
 saveError,
 showSuccessMessage,
 showErrorMessage,
}) {
 if (!editorMode || !editorForm) return null;

 return (
 <RemnantEditorInner
 editorMode={editorMode}
 editorForm={editorForm}
 setEditorForm={setEditorForm}
 onClose={onClose}
 onSave={onSave}
 onArchive={onArchive}
 profile={profile}
 lookups={lookups}
 activeLookupColors={activeLookupColors}
 canEditLinkedSlab={canEditLinkedSlab}
 saveError={saveError}
 showSuccessMessage={showSuccessMessage}
 showErrorMessage={showErrorMessage}
 />
 );
}

function RemnantEditorInner({
 editorMode,
 editorForm,
 setEditorForm,
 onClose,
 onSave,
 onArchive,
 profile,
 lookups,
 activeLookupColors,
 canEditLinkedSlab,
 saveError,
 showSuccessMessage,
 showErrorMessage,
}) {
 const [editorColorComposerOpen, setEditorColorComposerOpen] = useState(false);
 const [editorColorDraft, setEditorColorDraft] = useState("");
 const [editorColorSaving, setEditorColorSaving] = useState(false);
 const [editorStoneMenuOpen, setEditorStoneMenuOpen] = useState(false);
 const [editorBrandMenuOpen, setEditorBrandMenuOpen] = useState(false);
 const [editorSlabForm, setEditorSlabForm] = useState(null);
 const [editorSlabLoading, setEditorSlabLoading] = useState(false);
 const [editorSlabSaving, setEditorSlabSaving] = useState(false);
 const [editorSlabError, setEditorSlabError] = useState("");
 const [cropModal, setCropModal] = useState(null);
 const cropCanvasRef = useRef(null);
 const cropImageRef = useRef(null);
 const cropDragRef = useRef({
 dragging: false,
 dragStartX: 0,
 dragStartY: 0,
 startOffsetX: 0,
 startOffsetY: 0,
 startCropRect: DEFAULT_CROP_RECT,
 dragMode: null,
 activeHandle: null,
 });
 const editorImageInputRef = useRef(null);

 const editorStoneSuggestions = useMemo(() => {
 if (!editorForm?.material_id) return [];
 const materialId = Number(editorForm.material_id);
 if (!Number.isFinite(materialId)) return [];
 const normalizedBrand = normalizeStoneLookupName(editorForm.brand_name || "");

 return (Array.isArray(lookups.stone_products) ? lookups.stone_products : [])
 .filter((row) => {
 if (Number(row.material_id) !== materialId) return false;
 if (!normalizedBrand) return true;
 return normalizeStoneLookupName(row.brand_name || "").includes(normalizedBrand);
 })
 .sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || "")));
 }, [editorForm?.brand_name, editorForm?.material_id, lookups.stone_products]);

 const editorBrandSuggestions = useMemo(() => {
 if (!editorForm?.material_id) return [];
 const materialId = Number(editorForm.material_id);
 if (!Number.isFinite(materialId)) return [];
 const seen = new Set();
 return (Array.isArray(lookups.stone_products) ? lookups.stone_products : [])
 .filter((row) => Number(row.material_id) === materialId)
 .map((row) => String(row.brand_name || "").trim())
 .filter((value) => {
 const key = normalizeStoneLookupName(value);
 if (!key || seen.has(key)) return false;
 seen.add(key);
 return true;
 })
 .sort((a, b) => a.localeCompare(b));
 }, [editorForm?.material_id, lookups.stone_products]);

 const filteredEditorBrandSuggestions = useMemo(() => {
 const search = normalizeStoneLookupName(editorForm?.brand_name || "");
 const rows = Array.isArray(editorBrandSuggestions) ? editorBrandSuggestions : [];
 if (!search) return rows.slice(0, 8);
 return rows.filter((value) => normalizeStoneLookupName(value).includes(search)).slice(0, 8);
 }, [editorBrandSuggestions, editorForm?.brand_name]);

 const filteredEditorStoneSuggestions = useMemo(() => {
 const search = normalizeStoneLookupName(editorForm?.name || "");
 const rows = Array.isArray(editorStoneSuggestions) ? editorStoneSuggestions : [];
 if (!search) return rows.slice(0, 8);
 return rows
 .filter((row) => {
 const display = normalizeStoneLookupName(row.display_name || row.stone_name || "");
 const brand = normalizeStoneLookupName(row.brand_name || "");
 return display.includes(search) || brand.includes(search);
 })
 .slice(0, 8);
 }, [editorForm?.name, editorStoneSuggestions]);

 const matchedEditorStone = useMemo(() => {
 if (!editorForm?.material_id || !editorForm?.name) return null;
 const materialId = Number(editorForm.material_id);
 if (!Number.isFinite(materialId) || !normalizeStoneLookupName(editorForm.name)) return null;
 const normalizedBrand = normalizeStoneLookupName(editorForm.brand_name || "");

 return editorStoneSuggestions.find((row) => {
 if (!stoneLookupMatchesName(row, editorForm.name)) return false;
 if (!normalizedBrand) return true;
 return normalizeStoneLookupName(row.brand_name || "") === normalizedBrand;
 }) || editorStoneSuggestions.find((row) => stoneLookupMatchesName(row, editorForm.name)) || null;
 }, [editorForm?.brand_name, editorForm?.material_id, editorForm?.name, editorStoneSuggestions]);

 const selectedEditorMaterialName = useMemo(() => {
 const materialId = Number(editorForm?.material_id);
 if (!Number.isFinite(materialId)) return "";
 const row = (Array.isArray(lookups.materials) ? lookups.materials : []).find(
 (item) => Number(item?.id) === materialId,
 );
 return String(row?.name || "").trim();
 }, [editorForm?.material_id, lookups.materials]);

 const showEditorBrandField = supportsBrandField(selectedEditorMaterialName);

 useEffect(() => {
 if (!matchedEditorStone) return;
 setEditorForm((current) => {
 if (!current) return current;
 const currentColors = Array.isArray(current.colors) ? current.colors : [];
 const nextColors = currentColors.length
 ? currentColors
 : Array.isArray(matchedEditorStone.colors) ? matchedEditorStone.colors : [];
 const nextBrandName = current.brand_name || matchedEditorStone.brand_name || "";
 const sameColors = JSON.stringify(currentColors) === JSON.stringify(nextColors);
 const sameBrand = String(current.brand_name || "") === String(nextBrandName || "");
 if (sameColors && sameBrand) return current;
 return { ...current, brand_name: nextBrandName, colors: nextColors };
 });
 }, [matchedEditorStone, setEditorForm]);

 useEffect(() => {
 const canvas = cropCanvasRef.current;
 const image = cropImageRef.current;
 if (!canvas || !image || !cropModal) return;
 renderCropCanvas(canvas, image, cropModal);
 }, [cropModal]);

 function updateEditorField(key, value) {
 setEditorForm((current) => {
 const next = {
 ...(current || {}),
 [key]: value,
 ...(key === "l_shape" && !value ? { l_width: "", l_height: "" } : {}),
 };
 if (key === "brand_name" && next.name) {
 next.name = stoneNameWithoutBrandPrefix(next.name, value);
 }
 return next;
 });
 }

 function toggleEditorColor(colorName) {
 setEditorForm((current) => {
 if (!current) return current;
 const currentValues = Array.isArray(current.colors) ? current.colors : [];
 const nextValues = colorListIncludes(currentValues, colorName)
 ? currentValues.filter((value) => normalizeStoneLookupName(value) !== normalizeStoneLookupName(colorName))
 : [...currentValues, colorName];
 return { ...current, colors: nextValues };
 });
 }

 function updateEditorSlabField(key, value) {
 setEditorSlabForm((current) => current ? ({ ...current, [key]: value }) : current);
 }

 function toggleEditorSlabListValue(key, value) {
 setEditorSlabForm((current) => {
 if (!current) return current;
 const currentValues = Array.isArray(current[key]) ? current[key] : [];
 const nextValues = colorListIncludes(currentValues, value)
 ? currentValues.filter((entry) => normalizeStoneLookupName(entry) !== normalizeStoneLookupName(value))
 : [...currentValues, value];
 return { ...current, [key]: nextValues };
 });
 }

 function resetEditorSlabState() {
 setEditorSlabForm(null);
 setEditorSlabLoading(false);
 setEditorSlabSaving(false);
 setEditorSlabError("");
 }

 async function loadLinkedSlabEditor(slabId) {
 if (!canEditLinkedSlab || !slabId) {
 resetEditorSlabState();
 return;
 }
 try {
 setEditorSlabLoading(true);
 setEditorSlabError("");
 const slab = await apiFetch(`/api/slabs/${slabId}`, { cache: "no-store" });
 setEditorSlabForm({
 id: slab.id,
 name: slab.name || "",
 width: slab.width || "",
 height: slab.height || "",
 detail_url: slab.detail_url || "",
 image_url: slab.image_url || "",
 colors: Array.isArray(slab.colors) ? slab.colors : [],
 finishes: Array.isArray(slab.finishes) ? slab.finishes : [],
 thicknesses: Array.isArray(slab.thicknesses) ? slab.thicknesses : [],
 brand_name: slab.brand_name || "",
 supplier: slab.supplier || "",
 material: slab.material || "",
 });
 } catch (loadError) {
 setEditorSlabForm(null);
 setEditorSlabError(loadError.message || "Unable to load linked slab.");
 } finally {
 setEditorSlabLoading(false);
 }
 }

 async function saveLinkedSlab() {
 if (!editorSlabForm?.id) return;
 try {
 setEditorSlabSaving(true);
 setEditorSlabError("");
 const updatedSlab = await apiFetch(`/api/slabs/${editorSlabForm.id}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 name: editorSlabForm.name,
 width: editorSlabForm.width,
 height: editorSlabForm.height,
 detail_url: editorSlabForm.detail_url,
 image_url: editorSlabForm.image_url,
 colors: editorSlabForm.colors,
 finishes: editorSlabForm.finishes,
 thicknesses: editorSlabForm.thicknesses,
 }),
 });
 setEditorSlabForm((current) => current ? ({
 ...current,
 name: updatedSlab.name || "",
 width: updatedSlab.width || "",
 height: updatedSlab.height || "",
 detail_url: updatedSlab.detail_url || "",
 image_url: updatedSlab.image_url || "",
 colors: Array.isArray(updatedSlab.colors) ? updatedSlab.colors : [],
 finishes: Array.isArray(updatedSlab.finishes) ? updatedSlab.finishes : [],
 thicknesses: Array.isArray(updatedSlab.thicknesses) ? updatedSlab.thicknesses : [],
 }) : current);
 showSuccessMessage("Linked slab updated.");
 } catch (saveError) {
 setEditorSlabError(saveError.message || "Unable to update linked slab.");
 showErrorMessage(saveError.message || "Unable to update linked slab.");
 } finally {
 setEditorSlabSaving(false);
 }
 }

 async function createEditorColor() {
 if (!editorForm) return;
 const requestedName = String(editorColorDraft || "").trim();
 if (!requestedName) {
 showErrorMessage("Enter a color name first.");
 return;
 }
 try {
 setEditorColorSaving(true);
 const createdColor = await apiFetch("/api/lookups/colors", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ name: requestedName }),
 });
 const nextColor = createdColor?.name || String(requestedName || "").trim();
 if (!nextColor) return;

 // Update lookups colors in parent via setEditorForm is not possible here —
 // parent owns lookups. Use a reload approach: just add to the editor form colors
 // and trust the next render picks up the new color from lookups.
 setEditorForm((current) => {
 if (!current) return current;
 const currentColors = Array.isArray(current.colors) ? current.colors : [];
 return colorListIncludes(currentColors, nextColor)
 ? current
 : { ...current, colors: [...currentColors, nextColor] };
 });
 setEditorColorDraft("");
 setEditorColorComposerOpen(false);
 showSuccessMessage(`Color ${nextColor} added.`);
 } catch (error) {
 showErrorMessage(error.message || "Unable to add color.");
 } finally {
 setEditorColorSaving(false);
 }
 }

 function updateEditorImage(payload, previewUrl) {
 setEditorForm((current) => current ? ({
 ...current,
 image_file: payload,
 image_preview: previewUrl,
 }) : current);
 }

 async function handleEditorImageChange(event) {
 const file = event.target.files?.[0];
 if (!file) return;
 try {
 const payload = await fileToPayload(file);
 if (!payload) throw new Error("Unsupported image file");
 updateEditorImage(payload, payload.dataUrl);
 showSuccessMessage("Image loaded. You can crop it before saving.");
 } catch (imageError) {
 showErrorMessage(imageError.message);
 }
 }

 async function unlinkOrDeleteImage(removeFromStorage) {
 if (!editorForm?.image_preview) return;
 const isExisting = editorMode === "edit" && editorForm?.id;
 const promptText = removeFromStorage
 ? "Delete this image entirely? The file will be removed from storage and cannot be undone."
 : "Remove this image from the remnant? The file stays in the bucket.";
 if (typeof window !== "undefined" && !window.confirm(promptText)) return;

 if (!isExisting) {
 // New remnant — nothing to clear server-side.
 updateEditorImage(null, null);
 if (editorImageInputRef.current) editorImageInputRef.current.value = "";
 showSuccessMessage(removeFromStorage ? "Image discarded." : "Image unlinked.");
 return;
 }

 try {
 await apiFetch(`/api/remnants/${editorForm.id}/image`, {
 method: "DELETE",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ removeFromStorage: Boolean(removeFromStorage) }),
 });
 updateEditorImage(null, null);
 if (editorImageInputRef.current) editorImageInputRef.current.value = "";
 showSuccessMessage(removeFromStorage
 ? "Image deleted from storage."
 : "Image unlinked from remnant.");
 } catch (err) {
 showErrorMessage(err?.message || "Failed to remove image.");
 }
 }

 async function openCropEditor() {
 const src = String(editorForm?.image_preview || "").trim();
 if (!src) {
 showErrorMessage("Choose or load an image before cropping.");
 return;
 }
 try {
 const image = await loadImageElement(cropSourceUrl(src));
 cropImageRef.current = image;
 const fileName = editorForm?.image_file?.name
 || `${String(editorForm?.name || "remnant").trim().replace(/\s+/g, "-").toLowerCase() || "remnant"}.jpg`;
 const contentType = editorForm?.image_file?.type || "image/jpeg";
 const baseScale = Math.min(CROP_CANVAS_WIDTH / image.width, CROP_CANVAS_HEIGHT / image.height);
 setCropModal(normalizeCropDraft({
 prefix: editorMode || "edit",
 source: src,
 fileName,
 contentType,
 baseScale,
 scale: baseScale,
 offsetX: 0,
 offsetY: 0,
 rotationBase: 0,
 rotation: 0,
 cropRect: { ...DEFAULT_CROP_RECT },
 }, image));
 } catch (cropError) {
 showErrorMessage(cropError.message);
 }
 }

 function closeCropEditor() {
 setCropModal(null);
 cropImageRef.current = null;
 }

 function updateCropModal(updater) {
 setCropModal((current) => {
 if (!current) return current;
 const next = typeof updater === "function" ? updater(current) : updater;
 return normalizeCropDraft(next, cropImageRef.current);
 });
 }

 function handleCropPointerDown(event) {
 const canvas = cropCanvasRef.current;
 if (!canvas || !cropModal || !cropImageRef.current) return;
 const point = canvasPointFromPointer(event, canvas);
 const handle = cropHandles(cropModal.cropRect).find((item) => (
 Math.abs(point.x - item.x) <= 12 && Math.abs(point.y - item.y) <= 12
 ));
 cropDragRef.current = {
 dragging: true,
 dragStartX: point.x,
 dragStartY: point.y,
 startOffsetX: cropModal.offsetX,
 startOffsetY: cropModal.offsetY,
 startCropRect: { ...cropModal.cropRect },
 dragMode: handle ? "resize" : pointInCropRect(point, cropModal.cropRect) ? "move-crop" : "move-image",
 activeHandle: handle?.key || null,
 };
 canvas.setPointerCapture?.(event.pointerId);
 }

 function handleCropPointerMove(event) {
 const canvas = cropCanvasRef.current;
 const dragState = cropDragRef.current;
 if (!canvas || !cropModal || !dragState.dragging) return;
 const point = canvasPointFromPointer(event, canvas);
 const dx = point.x - dragState.dragStartX;
 const dy = point.y - dragState.dragStartY;
 updateCropModal((current) => {
 if (dragState.dragMode === "move-image") {
 return { ...current, offsetX: dragState.startOffsetX + dx, offsetY: dragState.startOffsetY + dy };
 }
 if (dragState.dragMode === "move-crop") {
 return { ...current, cropRect: { ...current.cropRect, x: dragState.startCropRect.x + dx, y: dragState.startCropRect.y + dy } };
 }
 if (dragState.dragMode === "resize") {
 const startRect = dragState.startCropRect;
 const handle = dragState.activeHandle || "";
 // Anchor is the corner OPPOSITE the dragged handle — it stays pinned.
 const anchorX = handle.includes("w") ? startRect.x + startRect.width : startRect.x;
 const anchorY = handle.includes("n") ? startRect.y + startRect.height : startRect.y;

 const projectedWidth = handle.includes("w")
 ? startRect.width - dx
 : startRect.width + dx;
 const projectedHeight = handle.includes("n")
 ? startRect.height - dy
 : startRect.height + dy;

 // Lock to 4:3: pick the dimension the cursor moved more along, then derive the other.
 let nextWidth;
 let nextHeight;
 if (Math.abs(dx) >= Math.abs(dy)) {
 nextWidth = Math.max(40, projectedWidth);
 nextHeight = nextWidth / CROP_ASPECT_RATIO;
 } else {
 nextHeight = Math.max(40, projectedHeight);
 nextWidth = nextHeight * CROP_ASPECT_RATIO;
 }

 const nextX = handle.includes("w") ? anchorX - nextWidth : anchorX;
 const nextY = handle.includes("n") ? anchorY - nextHeight : anchorY;

 return {
 ...current,
 cropRect: { x: nextX, y: nextY, width: nextWidth, height: nextHeight },
 };
 }
 return current;
 });
 }

 function endCropPointerDrag(event) {
 const canvas = cropCanvasRef.current;
 if (canvas && typeof event?.pointerId === "number") {
 canvas.releasePointerCapture?.(event.pointerId);
 }
 cropDragRef.current = {
 dragging: false, dragStartX: 0, dragStartY: 0,
 startOffsetX: 0, startOffsetY: 0,
 startCropRect: DEFAULT_CROP_RECT, dragMode: null, activeHandle: null,
 };
 }

 async function saveCropEditor() {
 const image = cropImageRef.current;
 if (!cropModal || !image) return;
 const geometry = cropGeometry(cropModal, image);
 if (!geometry) return;

 const sourceCanvas = document.createElement("canvas");
 sourceCanvas.width = CROP_CANVAS_WIDTH;
 sourceCanvas.height = CROP_CANVAS_HEIGHT;
 const sourceContext = sourceCanvas.getContext("2d");
 if (!sourceContext) { showErrorMessage("Failed to prepare crop canvas."); return; }

 sourceContext.fillStyle = "#efe4d8";
 sourceContext.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
 const centerX = geometry.drawX + geometry.drawWidth / 2;
 const centerY = geometry.drawY + geometry.drawHeight / 2;
 sourceContext.save();
 sourceContext.translate(centerX, centerY);
 sourceContext.rotate(((cropModal.rotationBase + cropModal.rotation) * Math.PI) / 180);
 sourceContext.drawImage(image, -geometry.drawWidth / 2, -geometry.drawHeight / 2, geometry.drawWidth, geometry.drawHeight);
 sourceContext.restore();

 const rect = cropModal.cropRect;
 const outputCanvas = document.createElement("canvas");
 outputCanvas.width = Math.max(1, Math.round(rect.width));
 outputCanvas.height = Math.max(1, Math.round(rect.height));
 const outputContext = outputCanvas.getContext("2d");
 if (!outputContext) { showErrorMessage("Failed to prepare output image."); return; }

 outputContext.drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, outputCanvas.width, outputCanvas.height);
 const outputType = preferredCropType(cropModal.contentType);
 const dataUrl = outputCanvas.toDataURL(outputType, 0.92);
 const payload = imagePayloadFromDataUrl(dataUrl, cropModal.fileName, outputType);
 updateEditorImage(payload, dataUrl);
 closeCropEditor();
 if (editorMode === "edit" && editorForm?.id && typeof onSave === "function") {
 // Auto-persist for existing remnants — saves staff a second click.
 try {
 await onSave(null, { image_file: payload, image_preview: dataUrl });
 } catch (autoSaveError) {
 showErrorMessage(autoSaveError?.message || "Failed to save crop.");
 }
 } else {
 showSuccessMessage("Cropped image ready to save.");
 }
 }

 // Load slab on mount if edit mode and slab exists
 useEffect(() => {
 if (editorMode === "edit" && canEditLinkedSlab && editorForm?.parent_slab_id) {
 void loadLinkedSlabEditor(editorForm.parent_slab_id);
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 return (
 <>
 <div className="fixed inset-0 z-[72] overflow-y-auto bg-black/50 px-4 py-8">
 <div className="mx-auto max-w-6xl overflow-visible rounded-sm border border-[color:var(--qc-line)] bg-white ">
 <div className="border-b border-[color:var(--qc-line)] bg-white px-6 py-5">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Inventory</p>
 <h2 className="font-inter text-2xl font-semibold text-[color:var(--qc-ink-1)]">{editorMode === "create" ? "Add Remnant" : "Edit Remnant"}</h2>
 </div>
 <button type="button" onClick={onClose} className="h-10 w-10 rounded-full border border-[color:var(--qc-line)] bg-white text-xl text-[color:var(--qc-ink-1)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[color:var(--qc-bg-page)]">
 {"\u00D7"}
 </button>
 </div>
 {saveError ? (
 <div
 className="mt-4 px-4 py-3 text-sm font-medium text-[color:var(--qc-status-sold-fg)]"
 style={{
 border: "1px solid var(--qc-line)",
 borderLeft: "2px solid var(--qc-status-sold-dot)",
 borderRadius: "var(--qc-radius-sharp)",
 }}
 >
 {saveError}
 </div>
 ) : null}
 </div>
 <form onSubmit={onSave} className="grid gap-4 p-6 md:grid-cols-2">
 <div className="md:col-span-2 grid gap-4 rounded-sm border border-[color:var(--qc-line)] bg-white p-4 lg:grid-cols-[minmax(0,1.15fr)_320px]">
 <div className="overflow-hidden rounded-sm border border-[color:var(--qc-line)] bg-white ">
 {editorForm.image_preview ? (
 <img
 src={editorForm.image_preview}
 alt="Remnant preview"
 className="h-72 w-full bg-[color:var(--qc-bg-page)] object-contain"
 />
 ) : (
 <div className="flex h-72 items-center justify-center bg-white px-6 text-center text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
 Add an image to preview and crop it here
 </div>
 )}
 </div>
 <div className="flex flex-col gap-5 rounded-sm border border-[color:var(--qc-line)] bg-white p-5">
 <div>
 <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Image Tools</p>
 </div>
 <div className="space-y-3">
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)]">
 Choose image
 <input
 ref={editorImageInputRef}
 type="file"
 accept="image/*"
 onChange={handleEditorImageChange}
 className="mt-2 block w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 py-3 text-sm text-[color:var(--qc-ink-1)] file:mr-4 file:rounded-full file:border-0 file:bg-[var(--brand-ink)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
 />
 </label>
 <div className="flex flex-wrap gap-2">
 <button
 type="button"
 onClick={openCropEditor}
 disabled={!editorForm.image_preview}
 className="inline-flex h-11 flex-1 items-center justify-center rounded-sm bg-[var(--brand-ink)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-60"
 >
 Crop
 </button>
 <button
 type="button"
 onClick={() => unlinkOrDeleteImage(false)}
 disabled={!editorForm.image_preview}
 title="Clear the image from this remnant. The file stays in the bucket."
 className="inline-flex h-11 items-center justify-center rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm font-semibold text-[color:var(--qc-ink-1)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[color:var(--qc-bg-page)] disabled:cursor-not-allowed disabled:opacity-60"
 >
 Unlink
 </button>
 <button
 type="button"
 onClick={() => unlinkOrDeleteImage(true)}
 disabled={!editorForm.image_preview}
 title="Permanently delete the image and remove the file from the bucket."
 className="inline-flex h-11 items-center justify-center rounded-sm border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-700 transition-colors hover:border-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
 >
 Delete
 </button>
 </div>
 </div>
 <div className="border-t border-[color:var(--qc-line)] pt-5">
 <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
 <div>
 <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Colors</p>
 </div>
 {editorColorComposerOpen ? (
 <div className="grid w-full grid-cols-[minmax(0,1fr)_40px_auto] items-center gap-2 sm:max-w-full">
 <input
 type="text"
 value={editorColorDraft}
 onChange={(event) => setEditorColorDraft(event.target.value)}
 placeholder="Color"
 className="h-10 min-w-0 flex-1 rounded-sm border border-[color:var(--qc-line)] bg-white px-3.5 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
 />
 <button
 type="button"
 onClick={() => { setEditorColorComposerOpen(false); setEditorColorDraft(""); }}
 className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-[color:var(--qc-line)] bg-white text-base font-semibold text-[rgba(35,35,35,0.62)] transition-colors hover:border-[var(--brand-orange)] hover:text-[var(--brand-orange)]"
 aria-label="Cancel add color"
 >
 ×
 </button>
 <button
 type="button"
 onClick={createEditorColor}
 disabled={editorColorSaving}
 className="inline-flex h-10 w-10 items-center justify-center rounded-sm bg-[var(--brand-ink)] text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-60"
 aria-label={editorColorSaving ? "Adding color" : "Add color"}
 >
 {editorColorSaving ? "…" : "✓"}
 </button>
 </div>
 ) : (
 <button
 type="button"
 onClick={() => setEditorColorComposerOpen(true)}
 className="inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-[color:var(--qc-line)] bg-white px-3.5 text-sm font-semibold text-[color:var(--qc-ink-1)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[color:var(--qc-bg-page)]"
 >
 <span className="text-base leading-none">+</span>
 Color
 </button>
 )}
 </div>
 <div className="mt-4 rounded-sm border border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] p-4">
 <div className="flex flex-wrap gap-2.5">
 {activeLookupColors.map((row) => {
 const selected = colorListIncludes(editorForm.colors, row.name);
 return (
 <button
 key={`color-${row.id}`}
 type="button"
 onClick={() => toggleEditorColor(row.name)}
 className={`group relative inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-colors ${
 selected
 ? "border-[var(--brand-orange)] bg-white ring-4 ring-[rgba(247,134,57,0.16)] "
 : "border-[color:var(--qc-line)] bg-white hover:border-[rgba(247,134,57,0.35)] hover:bg-[rgba(255,255,255,0.92)]"
 }`}
 aria-label={row.name}
 aria-pressed={selected}
 >
 <span
 className="h-6 w-6 rounded-full border border-black/10 "
 style={row?.hex ? { backgroundColor: row.hex } : colorSwatchStyle(row.name)}
 aria-hidden="true"
 />
 <span className="text-[rgba(35,35,35,0.82)]">{row.name}</span>
 <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-[#2c211c]/92 px-3 py-2 text-[11px] font-semibold text-white opacity-0 transition-all group-hover:opacity-100 group-focus-visible:opacity-100 xl:inline-flex">
 {row.name}
 </span>
 </button>
 );
 })}
 </div>
 </div>
 </div>
 </div>
 </div>
 <section className="rounded-sm border border-[color:var(--qc-line)] bg-white p-5 md:col-span-2">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Stone Details</p>
 </div>
 </div>
 <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-12">
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-3">
 Company
 <InAppSelect
 value={String(editorForm.company_id ?? "")}
 onChange={(event) => updateEditorField("company_id", event.target.value)}
 wrapperClassName="mt-2"
 placeholder="Select company"
 options={[
 { value: "", label: "Select company" },
 ...lookups.companies.map((row) => ({ value: String(row.id), label: row.name })),
 ]}
 />
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 Stone ID #
 <input
 type="number"
 value={editorForm.moraware_remnant_id}
 onChange={(event) => updateEditorField("moraware_remnant_id", event.target.value)}
 className="mt-2 h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
 />
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 Material
 <InAppSelect
 value={String(editorForm.material_id ?? "")}
 onChange={(event) => updateEditorField("material_id", event.target.value)}
 wrapperClassName="mt-2"
 placeholder="Select material"
 options={[
 { value: "", label: "Select material" },
 ...lookups.materials.map((row) => ({ value: String(row.id), label: row.name })),
 ]}
 />
 </label>
 {showEditorBrandField ? (
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 Brand
 <div className="relative mt-2">
 <input
 type="text"
 value={editorForm.brand_name}
 onChange={(event) => { updateEditorField("brand_name", event.target.value); setEditorBrandMenuOpen(true); }}
 onFocus={() => setEditorBrandMenuOpen(true)}
 onBlur={() => { window.setTimeout(() => setEditorBrandMenuOpen(false), 120); }}
 className="h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
 />
 {editorBrandMenuOpen && filteredEditorBrandSuggestions.length ? (
 <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-sm border border-[color:var(--qc-line)] bg-white ">
 <div className="max-h-64 overflow-y-auto p-2">
 {filteredEditorBrandSuggestions.map((brand) => (
 <button
 key={`brand-suggestion-${brand}`}
 type="button"
 onMouseDown={(event) => { event.preventDefault(); updateEditorField("brand_name", brand); setEditorBrandMenuOpen(false); }}
 className="flex w-full items-center rounded-sm px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--qc-bg-page)]"
 >
 <span className="block truncate text-sm font-semibold text-[color:var(--qc-ink-1)]">{brand}</span>
 </button>
 ))}
 </div>
 </div>
 ) : null}
 </div>
 </label>
 ) : null}
 <label className={`block text-sm font-medium text-[rgba(35,35,35,0.78)] md:col-span-2 ${showEditorBrandField ? "xl:col-span-3" : "xl:col-span-5"}`}>
 Stone Name
 <div className="relative mt-2">
 <input
 type="text"
 value={editorForm.name}
 onChange={(event) => { updateEditorField("name", event.target.value); setEditorStoneMenuOpen(true); }}
 onFocus={() => setEditorStoneMenuOpen(true)}
 onBlur={() => { window.setTimeout(() => setEditorStoneMenuOpen(false), 120); }}
 className="h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
 />
 {editorStoneMenuOpen && filteredEditorStoneSuggestions.length ? (
 <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-sm border border-[color:var(--qc-line)] bg-white ">
 <div className="max-h-64 overflow-y-auto p-2">
 {filteredEditorStoneSuggestions.map((row) => (
 <button
 key={`stone-suggestion-${row.id}`}
 type="button"
 onMouseDown={(event) => {
 event.preventDefault();
 const nextBrand = row.brand_name || editorForm.brand_name || "";
 const nextStoneName = stoneNameWithoutBrandPrefix(row.display_name || row.stone_name || "", nextBrand);
 if (row.brand_name) updateEditorField("brand_name", row.brand_name);
 updateEditorField("name", nextStoneName);
 setEditorStoneMenuOpen(false);
 }}
 className="flex w-full items-start justify-between gap-3 rounded-sm px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--qc-bg-page)]"
 >
 <span className="min-w-0">
 <span className="block truncate text-sm font-semibold text-[color:var(--qc-ink-1)]">
 {row.display_name || row.stone_name || "Unnamed"}
 </span>
 {row.brand_name ? (
 <span className="mt-0.5 block truncate text-[11px] font-medium uppercase tracking-[0.12em] text-[rgba(35,35,35,0.54)]">
 {row.brand_name}
 </span>
 ) : null}
 </span>
 </button>
 ))}
 </div>
 </div>
 ) : null}
 </div>
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 Finish
 <InAppSelect
 value={String(editorForm.finish_id ?? "")}
 onChange={(event) => updateEditorField("finish_id", event.target.value)}
 wrapperClassName="mt-2"
 placeholder="Select finish"
 options={[
 { value: "", label: "Select finish" },
 ...lookups.finishes.map((row) => ({ value: String(row.id), label: row.name })),
 ]}
 />
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 Thickness
 <InAppSelect
 value={String(editorForm.thickness_id ?? "")}
 onChange={(event) => updateEditorField("thickness_id", event.target.value)}
 wrapperClassName="mt-2"
 placeholder="Select thickness"
 options={[
 { value: "", label: "Select thickness" },
 ...lookups.thicknesses.map((row) => ({ value: String(row.id), label: row.name })),
 ]}
 />
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 Price / sqft
 <div className="relative mt-2">
 <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--brand-orange)]">$</span>
 <input
 type="text"
 inputMode="decimal"
 value={editorForm.price_per_sqft}
 onChange={(event) => updateEditorField("price_per_sqft", event.target.value)}
 placeholder="0.00"
 className="h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white pl-8 pr-4 text-sm font-semibold text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
 />
 </div>
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 Width
 <input
 type="text"
 inputMode="decimal"
 value={editorForm.width}
 onChange={(event) => updateEditorField("width", event.target.value)}
 placeholder="36.5 or 36 1/2"
 className="mt-2 h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
 />
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 Height
 <input
 type="text"
 inputMode="decimal"
 value={editorForm.height}
 onChange={(event) => updateEditorField("height", event.target.value)}
 placeholder="24.25 or 24 1/4"
 className="mt-2 h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
 />
 </label>
 <div className="flex items-end xl:col-span-2">
 <label className="inline-flex w-fit items-center gap-2 rounded-xl border border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[rgba(35,35,35,0.72)]">
 <input
 type="checkbox"
 checked={Boolean(editorForm.l_shape)}
 onChange={(event) => updateEditorField("l_shape", event.target.checked)}
 />
 L-Shape
 </label>
 </div>
 {editorForm.l_shape ? (
 <>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 L Width
 <input
 type="text"
 inputMode="decimal"
 value={editorForm.l_width}
 onChange={(event) => updateEditorField("l_width", event.target.value)}
 placeholder="18.5 or 18 1/2"
 className="mt-2 h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
 />
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 L Height
 <input
 type="text"
 inputMode="decimal"
 value={editorForm.l_height}
 onChange={(event) => updateEditorField("l_height", event.target.value)}
 placeholder="18.5 or 18 1/2"
 className="mt-2 h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
 />
 </label>
 </>
 ) : null}
 </div>
 </section>
 {editorMode === "edit" && canEditLinkedSlab ? (
 <section className="rounded-sm border border-[color:var(--qc-line)] bg-white p-5 md:col-span-2">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Linked Slab</p>
 <p className="mt-1 text-sm text-[rgba(35,35,35,0.62)]">
 Temporary super-admin controls for the slab attached to this remnant.
 </p>
 </div>
 {editorForm.parent_slab_id || editorSlabForm?.id ? (
 <span className="inline-flex items-center rounded-full border border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--qc-ink-1)]">
 Slab #{editorSlabForm?.id || editorForm.parent_slab_id}
 </span>
 ) : null}
 </div>

 {editorSlabLoading ? (
 <div className="mt-4 rounded-sm border border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-4 py-4 text-sm font-medium text-[rgba(35,35,35,0.72)]">
 Loading linked slab…
 </div>
 ) : null}

 {!editorSlabLoading && !editorSlabForm ? (
 <div className="mt-4 rounded-sm border border-dashed border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] px-4 py-4 text-sm text-[rgba(35,35,35,0.72)]">
 {editorSlabError || "This remnant does not have a linked slab yet."}
 </div>
 ) : null}

 {editorSlabForm ? (
 <>
 <div className="mt-4 flex flex-wrap gap-2">
 {editorSlabForm.brand_name ? (
 <span className="inline-flex items-center rounded-full border border-[color:var(--qc-line)] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(35,35,35,0.7)]">
 Brand · {editorSlabForm.brand_name}
 </span>
 ) : null}
 {editorSlabForm.supplier ? (
 <span className="inline-flex items-center rounded-full border border-[color:var(--qc-line)] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(35,35,35,0.7)]">
 Supplier · {editorSlabForm.supplier}
 </span>
 ) : null}
 {editorSlabForm.material ? (
 <span className="inline-flex items-center rounded-full border border-[color:var(--qc-line)] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(35,35,35,0.7)]">
 Material · {editorSlabForm.material}
 </span>
 ) : null}
 </div>

 <div className="mt-4 grid gap-4 xl:grid-cols-12">
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-4">
 Slab Name
 <input type="text" value={editorSlabForm.name} onChange={(event) => updateEditorSlabField("name", event.target.value)} className="mt-2 h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]" />
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 Width
 <input type="text" inputMode="decimal" value={editorSlabForm.width} onChange={(event) => updateEditorSlabField("width", event.target.value)} className="mt-2 h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]" />
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-2">
 Height
 <input type="text" inputMode="decimal" value={editorSlabForm.height} onChange={(event) => updateEditorSlabField("height", event.target.value)} className="mt-2 h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]" />
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-4">
 Supplier URL
 <input type="url" value={editorSlabForm.detail_url} onChange={(event) => updateEditorSlabField("detail_url", event.target.value)} className="mt-2 h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]" />
 </label>
 <label className="block text-sm font-medium text-[rgba(35,35,35,0.78)] xl:col-span-8">
 Image URL
 <input type="url" value={editorSlabForm.image_url} onChange={(event) => updateEditorSlabField("image_url", event.target.value)} className="mt-2 h-12 w-full rounded-sm border border-[color:var(--qc-line)] bg-white px-4 text-sm text-[color:var(--qc-ink-1)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]" />
 </label>
 </div>

 <div className="mt-5 grid gap-4 lg:grid-cols-3">
 <div className="rounded-sm border border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] p-4">
 <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Colors</p>
 <div className="mt-3 flex flex-wrap gap-2">
 {activeLookupColors.map((row) => {
 const selected = colorListIncludes(editorSlabForm.colors, row.name);
 return (
 <button
 key={`slab-color-${row.id}`}
 type="button"
 onClick={() => toggleEditorSlabListValue("colors", row.name)}
 className={`group relative inline-flex h-10 w-10 items-center justify-center rounded-full border transition ${
 selected
 ? "border-[var(--brand-orange)] ring-4 ring-[rgba(247,134,57,0.16)] "
 : "border-[color:var(--qc-line)] hover:border-[rgba(247,134,57,0.35)] hover:scale-[1.03]"
 }`}
 style={row?.hex ? { backgroundColor: row.hex } : colorSwatchStyle(row.name)}
 title={row.name}
 aria-label={row.name}
 aria-pressed={selected}
 >
 {selected ? <span className="h-3.5 w-3.5 rounded-full border border-white/75 bg-white/90 " /> : null}
 </button>
 );
 })}
 </div>
 </div>
 <div className="rounded-sm border border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] p-4">
 <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Finishes</p>
 <div className="mt-3 flex flex-wrap gap-2">
 {lookups.finishes.map((row) => {
 const selected = colorListIncludes(editorSlabForm.finishes, row.name);
 return (
 <button
 key={`slab-finish-${row.id}`}
 type="button"
 onClick={() => toggleEditorSlabListValue("finishes", row.name)}
 className={`inline-flex h-10 items-center justify-center rounded-full border px-3.5 text-sm font-semibold transition-colors ${
 selected
 ? "border-[var(--brand-orange)] bg-white text-[var(--brand-orange)] ring-4 ring-[rgba(247,134,57,0.14)]"
 : "border-[color:var(--qc-line)] bg-white text-[color:var(--qc-ink-1)] hover:border-[var(--brand-orange)] hover:bg-[color:var(--qc-bg-page)]"
 }`}
 >
 {row.name}
 </button>
 );
 })}
 </div>
 </div>
 <div className="rounded-sm border border-[color:var(--qc-line)] bg-[color:var(--qc-bg-page)] p-4">
 <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Thicknesses</p>
 <div className="mt-3 flex flex-wrap gap-2">
 {lookups.thicknesses.map((row) => {
 const selected = colorListIncludes(editorSlabForm.thicknesses, row.name);
 return (
 <button
 key={`slab-thickness-${row.id}`}
 type="button"
 onClick={() => toggleEditorSlabListValue("thicknesses", row.name)}
 className={`inline-flex h-10 items-center justify-center rounded-full border px-3.5 text-sm font-semibold transition-colors ${
 selected
 ? "border-[var(--brand-orange)] bg-white text-[var(--brand-orange)] ring-4 ring-[rgba(247,134,57,0.14)]"
 : "border-[color:var(--qc-line)] bg-white text-[color:var(--qc-ink-1)] hover:border-[var(--brand-orange)] hover:bg-[color:var(--qc-bg-page)]"
 }`}
 >
 {row.name}
 </button>
 );
 })}
 </div>
 </div>
 </div>

 {editorSlabError ? (
 <div className="mt-4 rounded-sm border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
 {editorSlabError}
 </div>
 ) : null}

 <div className="mt-5 flex flex-wrap justify-end gap-3">
 <button
 type="button"
 onClick={() => void loadLinkedSlabEditor(editorSlabForm.id)}
 disabled={editorSlabLoading || editorSlabSaving}
 className="inline-flex h-11 items-center justify-center rounded-sm border border-[color:var(--qc-line)] bg-white px-5 text-sm font-semibold text-[color:var(--qc-ink-1)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[color:var(--qc-bg-page)] disabled:cursor-not-allowed disabled:opacity-60"
 >
 Refresh Slab
 </button>
 <button
 type="button"
 onClick={saveLinkedSlab}
 disabled={editorSlabSaving}
 className="inline-flex h-11 items-center justify-center rounded-sm bg-[var(--brand-ink)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-60"
 >
 {editorSlabSaving ? "Saving Slab…" : "Save Linked Slab"}
 </button>
 </div>
 </>
 ) : null}
 </section>
 ) : null}
 <div className="md:col-span-2 flex flex-wrap justify-center gap-3 pt-2">
 <button type="submit" className="inline-flex h-12 items-center justify-center rounded-sm bg-[var(--brand-ink)] px-6 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-orange)]">
 {editorMode === "create" ? "Create Remnant" : "Save Changes"}
 </button>
 {editorMode === "edit" ? (
 <button type="button" onClick={onArchive} className="inline-flex h-12 items-center justify-center rounded-sm border border-stone-300 bg-stone-100 px-6 text-sm font-semibold text-stone-900 transition-colors hover:bg-stone-200">
 Archive
 </button>
 ) : null}
 <button type="button" onClick={onClose} className="inline-flex h-12 items-center justify-center rounded-sm border border-[color:var(--qc-line)] bg-white px-6 text-sm font-semibold text-[color:var(--qc-ink-1)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[color:var(--qc-bg-page)]">
 Cancel
 </button>
 </div>
 </form>
 </div>
 </div>

 <ImageCropper
 cropModal={cropModal}
 cropCanvasRef={cropCanvasRef}
 updateCropModal={updateCropModal}
 onClose={closeCropEditor}
 onSave={saveCropEditor}
 onPointerDown={handleCropPointerDown}
 onPointerMove={handleCropPointerMove}
 onPointerUp={endCropPointerDrag}
 />
 </>
 );
}
