/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useBodyScrollLock from "@/components/use-body-scroll-lock";
import {
 apiFetch,
 buildRemnantRequestInit,
 canManageStructure,
 canManageRemnant,
 normalizeRemnantStatus,
 statusOwnedByProfile,
 statusText,
 statusBadgeClass,
 statusBadgeText,
 remnantColors,
 colorSwatchStyle,
 privateCardHeading,
 privateCardSubheading,
 privateCardMetricEntries,
 internalRemnantId,
 displayRemnantId,
 imageSrc,
 sharedStoneColorsForEditor,
 materialOptionsFromRows,
 colorOptionsFromRows,
 currentFiltersFromSearch,
 buildSearchQuery,
 PrivateWorkspaceSkeletonCard,
 remnantToastLabel,
 statusToastText,
 normalizeJobNumberInput,
 humanizeRole,
 isAccessDeniedError,
 uniqueMaterialOptions,
 normalizeStoneLookupName,
 formatJobNumber,
 formatDateLabel,
 TOAST_DURATION_MS,
 HOLD_REQUEST_REFRESH_MS,
} from "./workspace/workspace-utils.js";
import StatusPill from "./public/StatusPill.js";
import ColorTooltip from "./public/ColorTooltip.js";
import PrivateHeader from "./private/PrivateHeader.js";
import PrivateFooter from "./private/PrivateFooter.js";
import { ImageViewer } from "./workspace/ImageViewer.js";
import { HoldRequestsQueue } from "./workspace/HoldRequestsQueue.js";
import { ApprovalsPanel } from "./workspace/ApprovalsPanel.js";
import { MyHoldsPanel } from "./workspace/MyHoldsPanel.js";
import { MySoldPanel } from "./workspace/MySoldPanel.js";
import { RemnantEditor } from "./workspace/RemnantEditor.js";
import { HoldEditor } from "./workspace/HoldEditor.js";
import { SoldEditor } from "./workspace/SoldEditor.js";

export default function PrivateWorkspaceClient() {
 const router = useRouter();
 const pathname = usePathname();
 const searchParams = useSearchParams();
 const searchKey = searchParams.toString();
 const initialFilters = useMemo(
 () => currentFiltersFromSearch(new URLSearchParams(searchKey)),
 [searchKey],
 );
 const [filters, setFilters] = useState(initialFilters);
 const [profile, setProfile] = useState(null);
 const [remnants, setRemnants] = useState([]);
 const [availableMaterialOptions, setAvailableMaterialOptions] = useState([]);
 const [availableColorOptions, setAvailableColorOptions] = useState([]);
 const [holdRequests, setHoldRequests] = useState([]);
 const [myHolds, setMyHolds] = useState([]);
 const [mySold, setMySold] = useState([]);
 const [lookups, setLookups] = useState({ companies: [], materials: [], thicknesses: [], finishes: [], colors: [], stone_products: [] });
 const [salesReps, setSalesReps] = useState([]);
 const [nextStoneId, setNextStoneId] = useState(null);
 const [loading, setLoading] = useState(true);
 const [authState, setAuthState] = useState("loading");
 const [error, setError] = useState("");
 const [editorError, setEditorError] = useState("");
 const [message, setMessage] = useState("");
 const [messageTone, setMessageTone] = useState("success");
 const [selectedImageIndex, setSelectedImageIndex] = useState(null);
 const [queueOpen, setQueueOpen] = useState(false);
 const [myHoldsOpen, setMyHoldsOpen] = useState(false);
 const [mySoldOpen, setMySoldOpen] = useState(false);
 const [myHoldsLoading, setMyHoldsLoading] = useState(false);
 const [mySoldLoading, setMySoldLoading] = useState(false);
 const [pendingReviewId, setPendingReviewId] = useState("");
 const [holdRequestDrafts, setHoldRequestDrafts] = useState({});
 const [workingRemnantId, setWorkingRemnantId] = useState("");
 const [editorMode, setEditorMode] = useState("");
 const [editorForm, setEditorForm] = useState(null);
 const [holdEditor, setHoldEditor] = useState(null);
 const [soldEditor, setSoldEditor] = useState(null);
 const [pendingApprovals, setPendingApprovals] = useState([]);
 const [approvalsOpen, setApprovalsOpen] = useState(false);
 const [approvingId, setApprovingId] = useState(null);
 const [showBackToTop, setShowBackToTop] = useState(false);
 const [backToTopBottom, setBackToTopBottom] = useState(24);
 const remnantAbortRef = useRef(null);
 const enrichmentRef = useRef(null);
 const lastPathnameRef = useRef(pathname);
 const canStructure = canManageStructure(profile);
 // DECOUPLED: linked-slab editor disabled while remnants stabilizes. Restore
 // to `profile?.system_role === "super_admin"` when re-merging slabs and remnants.
 const canEditLinkedSlab = false;
 const isStatusUser = profile?.system_role === "status_user";
 const roleDisplay = humanizeRole(profile?.system_role);
 const activeLookupColors = useMemo(
 () =>
 Array.isArray(lookups.colors)
 ? lookups.colors.filter((row) => row?.active !== false && row?.name)
 : [],
 [lookups.colors],
 );
 const materialFilterOptions = useMemo(() => {
 return uniqueMaterialOptions([...availableMaterialOptions, ...filters.materials]);
 }, [availableMaterialOptions, filters.materials]);
 const availableColors = useMemo(() => {
 const seen = new Set();
 const out = [];
 const candidates = [
 ...(Array.isArray(availableColorOptions) ? availableColorOptions : []),
 ...colorOptionsFromRows(remnants),
 ...(Array.isArray(filters.colors) ? filters.colors : []),
 ];
 for (const raw of candidates) {
 const name = String(raw || "").trim();
 if (!name) continue;
 const key = name.toLowerCase();
 if (seen.has(key)) continue;
 seen.add(key);
 out.push(name);
 }
 return out.sort((a, b) => a.localeCompare(b));
 }, [availableColorOptions, remnants, filters.colors]);
 const cards = useMemo(() => {
 const allowedColors = (filters.colors || []).length
 ? new Set((filters.colors || []).map((c) => normalizeStoneLookupName(c)))
 : null;
 if (!allowedColors) return remnants;
 return remnants.filter((remnant) => {
 const colorSet = new Set(remnantColors(remnant).map((c) => normalizeStoneLookupName(c)));
 return [...allowedColors].some((c) => colorSet.has(c));
 });
 }, [filters.colors, remnants]);
 const boardGridClass = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
 const modalImageItems = useMemo(
 () => cards.filter((remnant) => Boolean(imageSrc(remnant))),
 [cards],
 );
 const selectedImageRemnant =
 selectedImageIndex !== null && selectedImageIndex >= 0 && selectedImageIndex < modalImageItems.length
 ? modalImageItems[selectedImageIndex]
 : null;
 const isModalOpen = Boolean(
 selectedImageRemnant ||
 queueOpen ||
 myHoldsOpen ||
 mySoldOpen ||
 (editorMode && editorForm) ||
 holdEditor ||
 soldEditor,
 );
 const workspaceCopy = isStatusUser
 ? {
 eyebrow: "Inventory Workspace",
 title: "Keep live inventory up to date.",
 description:
 "Review requests, update remnant status, and keep your company feed accurate.",
 boardEyebrow: "Your Inventory Lane",
 boardTitle: "Status updates and request work",
 queueTitle: "Requests",
 queueDescription: "Requests that need a quick approve or deny pass from your lane.",
 }
 : {
 eyebrow: "Inventory Workspace",
 title: "Manage live inventory with confidence.",
 description:
 "Review requests, update remnant details, and keep the live feed accurate.",
 boardEyebrow: "Workspace Board",
 boardTitle: "Inventory and quick controls",
 queueTitle: "Incoming hold requests",
 queueDescription: "Review and respond to requests without leaving the inventory workspace.",
 };

 useBodyScrollLock(isModalOpen);

 function clearMessage() {
 setMessage("");
 }

 function showSuccessMessage(text) {
 setMessageTone("success");
 setMessage(text);
 }

 function showErrorMessage(text) {
 setMessageTone("error");
 setMessage(text || "Something went wrong. Please try again.");
 }

 function openImageViewer(remnant) {
 const nextIndex = modalImageItems.findIndex(
 (item) => Number(internalRemnantId(item) || item.id) === Number(internalRemnantId(remnant) || remnant.id),
 );
 if (nextIndex >= 0) setSelectedImageIndex(nextIndex);
 }

 function closeImageViewer() {
 setSelectedImageIndex(null);
 }

 function showPreviousImage() {
 setSelectedImageIndex((current) => {
 if (current === null || !modalImageItems.length) return current;
 return current === 0 ? modalImageItems.length - 1 : current - 1;
 });
 }

 function showNextImage() {
 setSelectedImageIndex((current) => {
 if (current === null || !modalImageItems.length) return current;
 return current === modalImageItems.length - 1 ? 0 : current + 1;
 });
 }

 useEffect(() => {
 setFilters(currentFiltersFromSearch(new URLSearchParams(searchKey)));
 }, [searchKey]);

 useEffect(() => {
 if (!message) return undefined;
 const timeoutId = window.setTimeout(() => {
 setMessage("");
 }, TOAST_DURATION_MS);
 return () => window.clearTimeout(timeoutId);
 }, [message]);

 useEffect(() => {
 if (selectedImageIndex === null) return;
 if (!modalImageItems.length) {
 setSelectedImageIndex(null);
 return;
 }
 if (selectedImageIndex >= modalImageItems.length) {
 setSelectedImageIndex(modalImageItems.length - 1);
 }
 }, [modalImageItems, selectedImageIndex]);

 useEffect(() => {
 if (selectedImageIndex === null) return undefined;

 function handleKeydown(event) {
 if (event.key === "Escape") {
 closeImageViewer();
 } else if (event.key === "ArrowLeft") {
 setSelectedImageIndex((current) => {
 if (current === null || !modalImageItems.length) return current;
 return current === 0 ? modalImageItems.length - 1 : current - 1;
 });
 } else if (event.key === "ArrowRight") {
 setSelectedImageIndex((current) => {
 if (current === null || !modalImageItems.length) return current;
 return current === modalImageItems.length - 1 ? 0 : current + 1;
 });
 }
 }

 window.addEventListener("keydown", handleKeydown);
 return () => window.removeEventListener("keydown", handleKeydown);
 }, [modalImageItems.length, selectedImageIndex]);

 useEffect(() => {
 const params = buildSearchQuery(filters);
 const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
 const currentUrl = searchKey ? `${pathname}?${searchKey}` : pathname;
 if (lastPathnameRef.current !== pathname) {
 lastPathnameRef.current = pathname;
 return;
 }
 if (nextUrl === currentUrl) return;
 router.replace(nextUrl, { scroll: false });
 }, [filters, pathname, router, searchKey]);

 useEffect(() => {
 let mounted = true;

 async function bootstrap() {
 try {
 const profilePayload = await apiFetch("/api/me");
 const nextProfile = profilePayload.profile || null;
 if (!mounted) return;
 if (!nextProfile) {
 setAuthState("forbidden");
 return;
 }
 setProfile(nextProfile);
 setAuthState("ready");

 const [requestsPayload, myHoldsPayload, mySoldPayload, lookupPayload, salesRepPayload, stonePayload, remnantRows, approvalsPayload] = await Promise.all([
 apiFetch("/api/hold-requests?status=pending", { cache: "no-store" }),
 apiFetch("/api/my-holds", { cache: "no-store" }),
 apiFetch("/api/my-sold", { cache: "no-store" }),
 apiFetch("/api/lookups", { cache: "no-store" }),
 nextProfile.system_role === "status_user" ? Promise.resolve([]) : apiFetch("/api/sales-reps", { cache: "no-store" }),
 canManageStructure(nextProfile) ? apiFetch("/api/next-stone-id", { cache: "no-store" }) : Promise.resolve({ nextStoneId: null }),
 apiFetch("/api/remnants?enrich=0", { cache: "no-store" }),
 nextProfile.system_role === "super_admin" ? apiFetch("/api/remnants/approve", { cache: "no-store" }) : Promise.resolve([]),
 ]);

 if (!mounted) return;
 setHoldRequests(Array.isArray(requestsPayload) ? requestsPayload : []);
 setMyHolds(Array.isArray(myHoldsPayload) ? myHoldsPayload : []);
 setMySold(Array.isArray(mySoldPayload) ? mySoldPayload : []);
 setLookups({
 companies: Array.isArray(lookupPayload.companies) ? lookupPayload.companies : [],
 materials: Array.isArray(lookupPayload.materials) ? lookupPayload.materials : [],
 thicknesses: Array.isArray(lookupPayload.thicknesses) ? lookupPayload.thicknesses : [],
 finishes: Array.isArray(lookupPayload.finishes) ? lookupPayload.finishes : [],
 colors: Array.isArray(lookupPayload.colors) ? lookupPayload.colors : [],
 stone_products: Array.isArray(lookupPayload.stone_products) ? lookupPayload.stone_products : [],
 });
 setSalesReps(Array.isArray(salesRepPayload) ? salesRepPayload : []);
 setNextStoneId(stonePayload?.nextStoneId ?? null);
 setAvailableMaterialOptions(materialOptionsFromRows(remnantRows));
 setAvailableColorOptions(colorOptionsFromRows(remnantRows));
 setPendingApprovals(Array.isArray(approvalsPayload) ? approvalsPayload : []);
 } catch (loadError) {
 if (!mounted) return;
 if (isAccessDeniedError(loadError.message)) {
 setAuthState("forbidden");
 return;
 }
 setError(loadError.message);
 }
 }

 bootstrap();
 return () => {
 mounted = false;
 };
 }, []);

 useEffect(() => {
 if (authState !== "ready") return;

 if (remnantAbortRef.current) remnantAbortRef.current.abort();
 if (enrichmentRef.current) enrichmentRef.current.abort();

 const controller = new AbortController();
 remnantAbortRef.current = controller;

 async function loadRows() {
 try {
 setLoading(true);
 setError("");
 const params = buildSearchQuery(filters);
 params.set("enrich", "0");
 const rows = await apiFetch(`/api/remnants?${params.toString()}`, {
 signal: controller.signal,
 });
 if (!Array.isArray(rows)) throw new Error("Unexpected remnant payload");
 setRemnants(rows.map((row) => ({ ...row, __detailsPending: rows.length > 0 })));
 setLoading(false);

 const ids = [...new Set(rows.map((row) => Number(internalRemnantId(row))).filter(Boolean))];
 if (!ids.length) return;

 const enrichmentController = new AbortController();
 enrichmentRef.current = enrichmentController;
 const enrichmentRows = await apiFetch("/api/remnants/enrichment", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ ids }),
 signal: enrichmentController.signal,
 });

 if (!Array.isArray(enrichmentRows)) return;
 const enrichmentMap = new Map(enrichmentRows.map((row) => [Number(row.remnant_id), row]));
 setRemnants((currentRows) =>
 currentRows.map((row) => {
 const enrichment = enrichmentMap.get(Number(internalRemnantId(row)));
 return enrichment
 ? { ...row, ...enrichment, __detailsPending: false }
 : { ...row, __detailsPending: false };
 }),
 );
 } catch (loadError) {
 if (loadError.name === "AbortError") return;
 setLoading(false);
 setError(loadError.message);
 }
 }

 loadRows();
 return () => controller.abort();
 }, [authState, filters]);

 useEffect(() => {
 if (authState !== "ready") return undefined;

 let active = true;

 async function syncHoldRequests() {
 if (document.visibilityState === "hidden") return;
 try {
 const requestsPayload = await apiFetch("/api/hold-requests?status=pending", { cache: "no-store" });
 if (!active) return;
 setHoldRequests(Array.isArray(requestsPayload) ? requestsPayload : []);
 } catch (_error) {
 // Keep background refresh quiet; explicit actions still surface errors.
 }
 }

 const intervalId = window.setInterval(syncHoldRequests, HOLD_REQUEST_REFRESH_MS);
 const handleVisible = () => {
 if (document.visibilityState === "visible") {
 void syncHoldRequests();
 }
 };

 window.addEventListener("focus", handleVisible);
 document.addEventListener("visibilitychange", handleVisible);

 if (queueOpen) {
 void syncHoldRequests();
 }

 return () => {
 active = false;
 window.clearInterval(intervalId);
 window.removeEventListener("focus", handleVisible);
 document.removeEventListener("visibilitychange", handleVisible);
 };
 }, [authState, queueOpen]);

 useEffect(() => {
 function syncBackToTop() {
 const shouldShow = window.scrollY > 600;
 setShowBackToTop(shouldShow);
 if (!shouldShow) {
 setBackToTopBottom(24);
 return;
 }
 const stop = document.querySelector("[data-back-to-top-stop]");
 if (!stop) {
 setBackToTopBottom(24);
 return;
 }
 const rect = stop.getBoundingClientRect();
 const wantBottom = Math.max(24, window.innerHeight - rect.top + 16);
 setBackToTopBottom(wantBottom);
 }

 syncBackToTop();
 window.addEventListener("scroll", syncBackToTop, { passive: true });
 window.addEventListener("resize", syncBackToTop);
 return () => {
 window.removeEventListener("scroll", syncBackToTop);
 window.removeEventListener("resize", syncBackToTop);
 };
 }, []);

 useEffect(() => {
 function handleKeydown(event) {
 if (event.key !== "Escape") return;
 if (editorMode) {
 setEditorMode("");
 setEditorForm(null);
 setEditorError("");
 } else if (holdEditor) {
 setHoldEditor(null);
 } else if (soldEditor) {
 setSoldEditor(null);
 } else if (approvalsOpen) {
 setApprovalsOpen(false);
 } else if (queueOpen) {
 setQueueOpen(false);
 } else if (myHoldsOpen) {
 setMyHoldsOpen(false);
 } else if (mySoldOpen) {
 setMySoldOpen(false);
 } else if (selectedImageIndex !== null) {
 setSelectedImageIndex(null);
 } else {
 return;
 }
 event.stopPropagation();
 }
 window.addEventListener("keydown", handleKeydown);
 return () => window.removeEventListener("keydown", handleKeydown);
 }, [
 editorMode,
 holdEditor,
 soldEditor,
 approvalsOpen,
 queueOpen,
 myHoldsOpen,
 mySoldOpen,
 selectedImageIndex,
 ]);

 async function reloadHoldRequests() {
 const requestsPayload = await apiFetch("/api/hold-requests?status=pending");
 setHoldRequests(Array.isArray(requestsPayload) ? requestsPayload : []);
 }

 async function reloadMyHolds() {
 const holdsPayload = await apiFetch("/api/my-holds");
 setMyHolds(Array.isArray(holdsPayload) ? holdsPayload : []);
 }

 async function reloadMySold() {
 const soldPayload = await apiFetch("/api/my-sold");
 setMySold(Array.isArray(soldPayload) ? soldPayload : []);
 }

 async function openMyHoldsPanel() {
 setQueueOpen(false);
 setMySoldOpen(false);
 setMyHoldsOpen(true);
 try {
 setMyHoldsLoading(true);
 await reloadMyHolds();
 } catch (loadError) {
 showErrorMessage(loadError.message);
 } finally {
 setMyHoldsLoading(false);
 }
 }

 async function openMySoldPanel() {
 setQueueOpen(false);
 setMyHoldsOpen(false);
 setMySoldOpen(true);
 try {
 setMySoldLoading(true);
 await reloadMySold();
 } catch (loadError) {
 showErrorMessage(loadError.message);
 } finally {
 setMySoldLoading(false);
 }
 }

 async function reloadAvailableMaterialOptions() {
 const rows = await apiFetch("/api/remnants?enrich=0");
 setAvailableMaterialOptions(materialOptionsFromRows(rows));
 setAvailableColorOptions(colorOptionsFromRows(rows));
 }

 async function reloadNextStoneId() {
 if (!profile || !canManageStructure(profile)) return;
 const payload = await apiFetch("/api/next-stone-id");
 setNextStoneId(payload?.nextStoneId ?? null);
 }

 async function changeRemnantStatus(remnant, nextStatus) {
 if (!profile || !canManageRemnant(profile, remnant)) return;
 if (nextStatus === "sold") {
 openSoldEditor(remnant);
 return;
 }

 try {
 setWorkingRemnantId(String(remnant.id));
 clearMessage();

 const payload = { status: nextStatus };

 const updatedRow = await apiFetch(`/api/remnants/${remnant.id}/status`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(payload),
 });

 setRemnants((currentRows) =>
 currentRows.map((row) => (Number(row.id) === Number(remnant.id) ? { ...row, ...updatedRow } : row)),
 );
 await reloadHoldRequests();
 await reloadMyHolds();
 showSuccessMessage(`Remnant ${remnantToastLabel(remnant)} marked as ${statusToastText(nextStatus)}.`);
 } catch (actionError) {
 showErrorMessage(actionError.message);
 } finally {
 setWorkingRemnantId("");
 }
 }

 async function reviewHoldRequest(requestId, nextStatus) {
 try {
 setPendingReviewId(String(requestId));
 clearMessage();
 const jobNumber = normalizeJobNumberInput(holdRequestDrafts[requestId] || "");
 await apiFetch(`/api/hold-requests/${requestId}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 status: nextStatus,
 job_number: jobNumber,
 }),
 });
 await reloadHoldRequests();
 await reloadMyHolds();
 showSuccessMessage(nextStatus === "approved" ? "Hold request approved." : "Hold request denied.");
 } catch (actionError) {
 showErrorMessage(actionError.message);
 } finally {
 setPendingReviewId("");
 }
 }

 function openCreateEditor() {
 if (!profile || !canManageStructure(profile)) return;
 setEditorMode("create");
 setEditorForm({
 moraware_remnant_id: nextStoneId ?? "",
 parent_slab_id: "",
 name: "",
 brand_name: "",
 company_id: profile.system_role === "status_user" ? String(profile.company_id || "") : "",
 material_id: "",
 thickness_id: "",
 finish_id: "",
 price_per_sqft: "",
 colors: [],
 width: "",
 height: "",
 l_shape: false,
 l_width: "",
 l_height: "",
 image_preview: "",
 original_image_preview: "",
 image_file: null,
 });
 }

 function openEditEditor(remnant) {
 if (!profile || !canManageStructure(profile)) return;
 const fallbackColors = sharedStoneColorsForEditor(
 lookups.stone_products,
 remnant.material_id,
 remnant.name,
 );
 const remnantColorList = Array.isArray(remnant.colors) ? remnant.colors : [];
 const colors = remnantColorList.length ? remnantColorList : fallbackColors;

 setEditorMode("edit");
 setEditorForm({
 id: remnant.id,
 moraware_remnant_id: remnant.moraware_remnant_id || "",
 parent_slab_id: remnant.parent_slab_id || "",
 name: remnant.name || "",
 brand_name: remnant.brand_name || "",
 company_id: String(remnant.company_id || ""),
 material_id: String(remnant.material_id || ""),
 thickness_id: String(remnant.thickness_id || ""),
 finish_id: String(remnant.finish_id || ""),
 price_per_sqft: remnant.price_per_sqft ?? "",
 colors,
 width: remnant.width || "",
 height: remnant.height || "",
 l_shape: Boolean(remnant.l_shape),
 l_width: remnant.l_width || "",
 l_height: remnant.l_height || "",
 image_preview: imageSrc(remnant),
 original_image_preview: imageSrc(remnant),
 image_file: null,
 });
 }

 function closeEditor() {
 setEditorMode("");
 setEditorForm(null);
 setEditorError("");
 }

 async function saveEditor(event, overrides = {}) {
 if (event && typeof event.preventDefault === "function") event.preventDefault();
 if (!editorForm) return;

 try {
 clearMessage();
 setError("");
 setEditorError("");
 const formForPayload = { ...editorForm, ...(overrides || {}) };
 const payload = {
 moraware_remnant_id: formForPayload.moraware_remnant_id,
 name: formForPayload.name,
 brand_name: formForPayload.brand_name,
 company_id: formForPayload.company_id,
 material_id: formForPayload.material_id,
 thickness_id: formForPayload.thickness_id,
 finish_id: formForPayload.finish_id,
 colors: formForPayload.colors,
 price_per_sqft: formForPayload.price_per_sqft,
 width: formForPayload.width,
 height: formForPayload.height,
 l_shape: Boolean(formForPayload.l_shape),
 l_width: formForPayload.l_shape ? formForPayload.l_width : "",
 l_height: formForPayload.l_shape ? formForPayload.l_height : "",
 image_file: formForPayload.image_file || undefined,
 };

 if (editorMode === "create") {
 await apiFetch("/api/remnants", await buildRemnantRequestInit("POST", payload));
 await reloadNextStoneId();
 await reloadAvailableMaterialOptions();
 showSuccessMessage(profile?.system_role === "super_admin" ? "Remnant created." : "Remnant submitted for approval.");
 } else {
 await apiFetch(`/api/remnants/${editorForm.id}`, await buildRemnantRequestInit("PATCH", payload));
 await reloadAvailableMaterialOptions();
 showSuccessMessage("Remnant updated.");
 }

 closeEditor();
 await reloadHoldRequests();
 await reloadMyHolds();
 await reloadMySold();
 setFilters((current) => ({ ...current }));
 setLoading(true);
 } catch (saveError) {
 setEditorError(saveError.message);
 }
 }

 async function handleApproveRemnant(remnantId) {
 setApprovingId(remnantId);
 try {
 await apiFetch("/api/remnants/approve", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ remnant_id: remnantId }),
 });
 setPendingApprovals((current) => current.filter((r) => r.id !== remnantId));
 showSuccessMessage("Remnant approved and now available.");
 setFilters((current) => ({ ...current }));
 setLoading(true);
 } catch (err) {
 showErrorMessage(err.message || "Failed to approve remnant.");
 } finally {
 setApprovingId(null);
 }
 }

 async function archiveEditorRemnant() {
 if (editorMode !== "edit" || !editorForm?.id) return;
 if (!window.confirm("Archive this remnant?")) return;

 try {
 await apiFetch(`/api/remnants/${editorForm.id}`, {
 method: "DELETE",
 });
 closeEditor();
 await reloadAvailableMaterialOptions();
 showSuccessMessage("Remnant archived.");
 await reloadHoldRequests();
 await reloadMyHolds();
 await reloadMySold();
 setFilters((current) => ({ ...current }));
 setLoading(true);
 } catch (archiveError) {
 setError(archiveError.message);
 }
 }

 function openHoldEditor(remnant) {
 const hold = remnant.current_hold || null;
 const isSelfOnly = profile?.system_role === "status_user";
 const currentOwnerUserId = hold?.hold_owner_user_id || null;
 const lockedToOtherOwner = Boolean(
 isSelfOnly &&
 currentOwnerUserId &&
 String(currentOwnerUserId) !== String(profile?.id || ""),
 );
 setHoldEditor({
 remnant,
 remnantId: remnant.id,
 remnantLabel: remnantToastLabel(remnant),
 holdId: hold?.id || null,
 owner_user_id: isSelfOnly ? profile?.id || "" : hold?.hold_owner_user_id || profile?.id || "",
 current_owner_user_id: currentOwnerUserId,
 current_owner_name: hold?.owner_name || hold?.owner_email || "",
 self_only: isSelfOnly,
 locked_to_other_owner: lockedToOtherOwner,
 customer_name: hold?.customer_name || "",
 expires_at: hold?.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
 job_number: normalizeJobNumberInput(hold?.job_number || ""),
 notes: hold?.notes || "",
 summary: hold
 ? `${hold.status === "active" ? "Active" : "Expired"} hold${hold.customer_name ? ` for ${hold.customer_name}` : ""}${hold.job_number ? ` · ${formatJobNumber(hold.job_number, remnant)}` : ""}${hold.expires_at ? ` · Expires ${formatDateLabel(hold.expires_at)}` : ""}`
 : "No hold is linked to this remnant yet.",
 });
 }

 function closeHoldEditor() {
 setHoldEditor(null);
 }

 function openSoldEditor(remnant) {
 const sale = remnant.current_sale || null;
 clearMessage();
 setSoldEditor({
 remnant,
 remnantId: remnant.id,
 remnantLabel: remnantToastLabel(remnant),
 sold_by_user_id: isStatusUser ? profile?.id || "" : sale?.sold_by_user_id || "",
 job_number: normalizeJobNumberInput(sale?.job_number || remnant?.sold_job_number || ""),
 notes: sale?.notes || "",
 self_only: isStatusUser,
 });
 }

 function closeSoldEditor() {
 setSoldEditor(null);
 }

 function sellFromHoldEditor() {
 if (!holdEditor?.remnant) return;
 const nextRemnant = holdEditor.remnant;
 closeHoldEditor();
 openSoldEditor(nextRemnant);
 }

 async function saveHoldEditor(event) {
 event.preventDefault();
 if (!holdEditor) return;
 if (holdEditor.locked_to_other_owner) {
 setError("Only the original sales rep or a manager can change this hold.");
 return;
 }

 try {
 await apiFetch(`/api/remnants/${holdEditor.remnantId}/hold`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 hold_owner_user_id: holdEditor.self_only ? profile?.id || "" : holdEditor.owner_user_id,
 expires_at: holdEditor.expires_at,
 customer_name: holdEditor.customer_name,
 job_number: normalizeJobNumberInput(holdEditor.job_number),
 notes: holdEditor.notes,
 }),
 });
 closeHoldEditor();
 showSuccessMessage(`Remnant ${holdEditor.remnantLabel} marked as on hold.`);
 await reloadHoldRequests();
 await reloadMyHolds();
 await reloadMySold();
 setFilters((current) => ({ ...current }));
 setLoading(true);
 } catch (holdError) {
 setError(holdError.message);
 }
 }

 async function saveSoldEditor(event) {
 event.preventDefault();
 if (!soldEditor) return;

 try {
 setWorkingRemnantId(String(soldEditor.remnantId));
 clearMessage();
 const updatedRow = await apiFetch(`/api/remnants/${soldEditor.remnantId}/status`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 status: "sold",
 sold_by_user_id: soldEditor.self_only ? profile?.id || "" : soldEditor.sold_by_user_id,
 sold_job_number: normalizeJobNumberInput(soldEditor.job_number),
 sold_notes: soldEditor.notes,
 }),
 });

 setRemnants((currentRows) =>
 currentRows.map((row) =>
 Number(row.id) === Number(soldEditor.remnantId) ? { ...row, ...updatedRow } : row,
 ),
 );
 closeSoldEditor();
 await reloadHoldRequests();
 await reloadMyHolds();
 await reloadMySold();
 showSuccessMessage(`Remnant ${soldEditor.remnantLabel} marked as sold.`);
 } catch (soldError) {
 showErrorMessage(soldError.message);
 } finally {
 setWorkingRemnantId("");
 }
 }

 async function releaseHoldEditor() {
 if (!holdEditor?.holdId) return;
 if (holdEditor.locked_to_other_owner) {
 setError("Only the original sales rep or a manager can release this hold.");
 return;
 }
 try {
 await apiFetch(`/api/holds/${holdEditor.holdId}/release`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 });
 closeHoldEditor();
 showSuccessMessage(`Remnant ${holdEditor.remnantLabel} released from hold.`);
 await reloadHoldRequests();
 await reloadMyHolds();
 await reloadMySold();
 setFilters((current) => ({ ...current }));
 setLoading(true);
 } catch (releaseError) {
 setError(releaseError.message);
 }
 }

 if (authState === "loading") {
 return <main className="font-inter min-h-screen bg-[color:var(--qc-bg-page)] px-8 py-10 text-[color:var(--qc-ink-2)]">Loading workspace…</main>;
 }

 if (authState === "forbidden") {
 return (
 <main className="font-inter min-h-screen bg-[color:var(--qc-bg-page)] px-8 py-16 text-[color:var(--qc-ink-1)]">
 <div
 className="mx-auto max-w-3xl bg-white p-8"
 style={{ border: "1px solid var(--qc-line)", borderRadius: "var(--qc-radius-sharp)" }}
 >
 <p className="text-[10.5px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">Access required</p>
 <h1 className="mt-3 text-[28px] font-medium leading-tight tracking-[-0.02em] text-[color:var(--qc-ink-1)]">This private workspace needs an active management login.</h1>
 <p className="mt-3 text-[14px] leading-[1.6] text-[color:var(--qc-ink-2)]">
 Sign in first, then come back here to continue in the private workspace.
 </p>
 <div className="mt-6">
 <a
 href="/portal"
 className="inline-flex h-11 items-center justify-center px-5 text-[13px] font-medium text-white transition-colors hover:bg-[#232323]"
 style={{ backgroundColor: "var(--qc-ink-1)", borderRadius: "var(--qc-radius-sharp)" }}
 >
 Open login
 </a>
 </div>
 </div>
 </main>
 );
 }

 return (
 <main className="font-inter min-h-screen bg-[color:var(--qc-bg-page)] text-[color:var(--qc-ink-1)]">
 <PrivateHeader profile={profile} />
 <section className="mx-auto w-full max-w-[1680px] px-8 py-6">
 <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
 <button
 type="button"
 onClick={() => {
 setMySoldOpen(false);
 setMyHoldsOpen(false);
 setQueueOpen(true);
 }}
 className="flex flex-col items-start gap-2 bg-[color:var(--qc-bg-surface)] px-5 py-4 text-left transition-colors hover:border-[color:var(--qc-ink-1)]"
 style={{ border: "1px solid var(--qc-line)", borderRadius: "var(--qc-radius-sharp)" }}
 >
 <span className="flex w-full items-center justify-between gap-3">
 <span className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
 Hold requests
 </span>
 {holdRequests.length > 0 ? (
 <span
 className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em]"
 style={{
 backgroundColor: "var(--qc-status-hold-bg)",
 color: "var(--qc-status-hold-fg)",
 borderRadius: "var(--qc-radius-sharp)",
 }}
 >
 New
 </span>
 ) : null}
 </span>
 <span className="text-[36px] font-medium leading-none tracking-[-0.02em] text-[color:var(--qc-ink-1)]">
 {holdRequests.length}
 </span>
 </button>

 <button
 type="button"
 onClick={openMyHoldsPanel}
 className="flex flex-col items-start gap-2 bg-[color:var(--qc-bg-surface)] px-5 py-4 text-left transition-colors hover:border-[color:var(--qc-ink-1)]"
 style={{ border: "1px solid var(--qc-line)", borderRadius: "var(--qc-radius-sharp)" }}
 >
 <span className="flex w-full items-center justify-between gap-3">
 <span className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
 My holds
 </span>
 </span>
 <span className="text-[36px] font-medium leading-none tracking-[-0.02em] text-[color:var(--qc-ink-1)]">
 {myHolds.length}
 </span>
 </button>

 <button
 type="button"
 onClick={openMySoldPanel}
 className="flex flex-col items-start gap-2 bg-[color:var(--qc-bg-surface)] px-5 py-4 text-left transition-colors hover:border-[color:var(--qc-ink-1)]"
 style={{ border: "1px solid var(--qc-line)", borderRadius: "var(--qc-radius-sharp)" }}
 >
 <span className="flex w-full items-center justify-between gap-3">
 <span className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
 My sold
 </span>
 </span>
 <span className="text-[36px] font-medium leading-none tracking-[-0.02em] text-[color:var(--qc-ink-1)]">
 {mySold.length}
 </span>
 </button>

 {profile?.system_role === "super_admin" && pendingApprovals.length > 0 ? (
 <button
 type="button"
 onClick={() => setApprovalsOpen(true)}
 className="flex flex-col items-start gap-2 bg-[color:var(--qc-bg-surface)] px-5 py-4 text-left transition-colors hover:border-[color:var(--qc-ink-1)]"
 style={{ border: "1px solid var(--qc-line)", borderRadius: "var(--qc-radius-sharp)" }}
 >
 <span className="flex w-full items-center justify-between gap-3">
 <span className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
 Approvals
 </span>
 <span
 className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em]"
 style={{
 backgroundColor: "var(--qc-status-pending-bg)",
 color: "var(--qc-status-pending-fg)",
 borderRadius: "var(--qc-radius-sharp)",
 }}
 >
 Pending
 </span>
 </span>
 <span className="text-[36px] font-medium leading-none tracking-[-0.02em] text-[color:var(--qc-ink-1)]">
 {pendingApprovals.length}
 </span>
 </button>
 ) : null}
 </div>
 </section>
 <div className="mx-auto w-full max-w-[1680px] px-8 pb-16">

 <div className="space-y-4">
 <section className="space-y-4">
 <div
 id="filter_menu"
 className="sticky top-0 z-40 bg-[color:var(--qc-bg-page)] py-6"
 style={{
 borderTop: "1px solid var(--qc-line)",
 borderBottom: "1px solid var(--qc-line)",
 }}
 >
 <div className="flex flex-wrap items-center gap-3">
 <div className="relative h-11 min-w-[260px] flex-1">
 <svg
 aria-hidden="true"
 viewBox="0 0 24 24"
 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--qc-ink-3)]"
 fill="none"
 stroke="currentColor"
 strokeWidth="1.8"
 strokeLinecap="round"
 strokeLinejoin="round"
 >
 <circle cx="11" cy="11" r="7" />
 <path d="m20 20-3.5-3.5" />
 </svg>
 <input
 type="text"
 value={filters.stone}
 onChange={(event) => setFilters((current) => ({ ...current, stone: event.target.value }))}
 placeholder="Search stone, brand, company, finish, or ID #741"
 className="font-inter h-11 w-full border border-[color:var(--qc-line)] bg-white pl-11 pr-4 text-[14px] font-normal normal-case tracking-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors hover:border-[color:var(--qc-line-strong)] focus:border-[color:var(--qc-ink-1)]"
 style={{ borderRadius: "var(--qc-radius-sharp)" }}
 />
 </div>

 <input
 type="text"
 inputMode="decimal"
 value={filters.minWidth}
 onChange={(event) => setFilters((current) => ({ ...current, minWidth: event.target.value }))}
 placeholder='Min W"'
 aria-label="Minimum width"
 className="font-inter h-11 w-[110px] border border-[color:var(--qc-line)] bg-white px-4 text-center text-[14px] font-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors hover:border-[color:var(--qc-line-strong)] focus:border-[color:var(--qc-ink-1)]"
 style={{ borderRadius: "var(--qc-radius-sharp)" }}
 />

 <input
 type="text"
 inputMode="decimal"
 value={filters.minHeight}
 onChange={(event) => setFilters((current) => ({ ...current, minHeight: event.target.value }))}
 placeholder='Min H"'
 aria-label="Minimum height"
 className="font-inter h-11 w-[110px] border border-[color:var(--qc-line)] bg-white px-4 text-center text-[14px] font-normal text-[color:var(--qc-ink-1)] placeholder:text-[color:var(--qc-ink-3)] outline-none transition-colors hover:border-[color:var(--qc-line-strong)] focus:border-[color:var(--qc-ink-1)]"
 style={{ borderRadius: "var(--qc-radius-sharp)" }}
 />

 <div
 className="flex h-11 items-center bg-white"
 style={{
 border: "1px solid var(--qc-line)",
 borderRadius: "var(--qc-radius-sharp)",
 }}
 >
 {[
 { value: "available", label: "Available", dot: "var(--qc-status-available-dot)" },
 { value: "hold", label: "On Hold", dot: "var(--qc-status-hold-dot)" },
 { value: "sold", label: "Sold", dot: "var(--qc-status-sold-dot)" },
 ].map((option, index) => {
 const checked = filters.status === option.value;
 return (
 <button
 key={option.value}
 type="button"
 aria-pressed={checked}
 onClick={() =>
 setFilters((current) => ({
 ...current,
 status: current.status === option.value ? "" : option.value,
 }))
 }
 className={`font-inter inline-flex h-full items-center gap-1.5 px-4 text-[13px] transition-colors ${
 checked
 ? "bg-[rgba(0,0,0,0.04)] font-medium text-[color:var(--qc-ink-1)]"
 : "text-[color:var(--qc-ink-2)] hover:bg-[rgba(0,0,0,0.04)] hover:text-[color:var(--qc-ink-1)]"
 }`}
 style={{
 borderLeft: index === 0 ? "none" : "1px solid var(--qc-line)",
 }}
 >
 <span
 aria-hidden="true"
 className="inline-block h-1.5 w-1.5 rounded-full"
 style={{ backgroundColor: option.dot }}
 />
 {option.label}
 </button>
 );
 })}
 </div>

 {profile?.system_role === "super_admin" ? (
 <button
 type="button"
 aria-pressed={filters.archived === "1"}
 onClick={() =>
 setFilters((current) => ({
 ...current,
 archived: current.archived === "1" ? "" : "1",
 }))
 }
 className={`font-inter inline-flex h-11 items-center gap-1.5 px-4 text-[13px] font-medium transition-colors ${
 filters.archived === "1"
 ? "bg-[color:var(--qc-ink-1)] text-white hover:bg-[#232323]"
 : "bg-white text-[color:var(--qc-ink-2)] hover:bg-[rgba(0,0,0,0.04)] hover:text-[color:var(--qc-ink-1)]"
 }`}
 style={{
 border: "1px solid var(--qc-line)",
 borderRadius: "var(--qc-radius-sharp)",
 }}
 title="Show only archived remnants"
 >
 <svg
 className="h-3.5 w-3.5"
 viewBox="0 0 16 16"
 fill="none"
 stroke="currentColor"
 strokeWidth="1.6"
 strokeLinecap="round"
 strokeLinejoin="round"
 aria-hidden="true"
 >
 <rect x="2" y="3" width="12" height="3" rx="0.5" />
 <path d="M3 6v6.5a1.5 1.5 0 001.5 1.5h7A1.5 1.5 0 0013 12.5V6" />
 <path d="M6.5 9h3" />
 </svg>
 {filters.archived === "1" ? "Archived only" : "Archived"}
 </button>
 ) : null}

 {canStructure ? (
 <button
 type="button"
 onClick={openCreateEditor}
 aria-label="Add remnant"
 title="Add remnant"
 className="font-inter inline-flex h-11 items-center gap-2 bg-[color:var(--qc-ink-1)] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[color:var(--qc-orange)]"
 style={{
 borderRadius: "var(--qc-radius-sharp)",
 }}
 >
 <svg
 aria-hidden="true"
 viewBox="0 0 24 24"
 className="h-3.5 w-3.5"
 fill="none"
 stroke="currentColor"
 strokeWidth="2"
 strokeLinecap="round"
 strokeLinejoin="round"
 >
 <path d="M12 5v14" />
 <path d="M5 12h14" />
 </svg>
 Add remnant
 </button>
 ) : null}
 </div>

 {(materialFilterOptions.length || availableColors.length) ? (
 <div className="mt-4 flex flex-wrap items-center gap-2">
 <button
 type="button"
 aria-pressed={filters.materials.length === 0}
 onClick={() => setFilters((current) => ({ ...current, materials: [] }))}
 className={`font-inter inline-flex items-center px-4 py-2 text-[13px] font-medium transition-colors ${
 filters.materials.length === 0
 ? "bg-[color:var(--qc-ink-1)] text-white hover:bg-[#232323]"
 : "bg-[rgba(0,0,0,0.04)] text-[color:var(--qc-ink-1)] hover:bg-[rgba(0,0,0,0.08)]"
 }`}
 style={{ borderRadius: "var(--qc-radius-sharp)" }}
 >
 All
 </button>
 {materialFilterOptions.map((material) => {
 const checked = filters.materials.includes(material);
 return (
 <button
 key={material}
 type="button"
 aria-pressed={checked}
 onClick={() =>
 setFilters((current) => ({
 ...current,
 materials: checked
 ? current.materials.filter((value) => value !== material)
 : [...current.materials, material],
 }))
 }
 className={`font-inter inline-flex shrink-0 items-center px-4 py-2 text-[13px] font-medium transition-colors ${
 checked
 ? "bg-[color:var(--qc-ink-1)] text-white hover:bg-[#232323]"
 : "bg-[rgba(0,0,0,0.04)] text-[color:var(--qc-ink-1)] hover:bg-[rgba(0,0,0,0.08)]"
 }`}
 style={{ borderRadius: "var(--qc-radius-sharp)" }}
 >
 {material}
 </button>
 );
 })}
 {availableColors.length ? (
 <div className="ml-2 flex items-center gap-1.5">
 {availableColors.map((color) => {
 const checked = (filters.colors || []).includes(color);
 return (
 <ColorTooltip key={color} name={color}>
 <button
 type="button"
 aria-pressed={checked}
 aria-label={color}
 onClick={() =>
 setFilters((current) => {
 const list = current.colors || [];
 return {
 ...current,
 colors: list.includes(color)
 ? list.filter((value) => value !== color)
 : [...list, color],
 };
 })
 }
 className="inline-flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110"
 style={{
 ...colorSwatchStyle(color),
 boxShadow: checked
 ? "0 0 0 1px var(--qc-bg-page), 0 0 0 2px var(--qc-ink-1)"
 : "inset 0 0 0 1px rgba(0,0,0,0.10)",
 }}
 />
 </ColorTooltip>
 );
 })}
 </div>
 ) : null}
 <span className="font-inter ml-auto text-[13px] text-[color:var(--qc-ink-3)]">
 <span className="font-medium text-[color:var(--qc-ink-1)]">{cards.length}</span>{" "}
 {cards.length === 1 ? "result" : "results"}
 </span>
 </div>
 ) : null}
 </div>

 {loading ? (
 <div className={boardGridClass}>
 {Array.from({ length: 6 }).map((_, index) => (
 <PrivateWorkspaceSkeletonCard key={index} showActions={isStatusUser} />
 ))}
 </div>
 ) : error ? (
 <div className="rounded-sm border border-rose-200 bg-white/90 px-6 py-10 text-center text-rose-700 ">
 <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-500">Load Failed</p>
 <h3 className="mt-2 text-xl font-semibold text-rose-800">We couldn&apos;t load the workspace right now.</h3>
 <p className="mt-2 text-sm">{error}</p>
 </div>
 ) : (
 <div className={boardGridClass}>
 {cards.map((remnant) => {
 const normalizedStatus = normalizeRemnantStatus(remnant);
 const statusBadge = statusBadgeText(remnant);
 const canManage = canManageRemnant(profile, remnant);
 const isWorking = workingRemnantId === String(remnant.id);
 const statusLockedForSalesRep =
 isStatusUser &&
 (normalizedStatus === "hold" || normalizedStatus === "sold") &&
 !statusOwnedByProfile(profile, remnant);
 const showStatusActions = canManage && !statusLockedForSalesRep;
 const showAvailableAction = showStatusActions && normalizedStatus !== "available";
 const showSoldAction = showStatusActions && normalizedStatus !== "sold";
 const showHoldAction = showStatusActions && normalizedStatus !== "hold";
 const showEditAction = showStatusActions && canStructure;
 const leftAction =
 normalizedStatus === "hold" || normalizedStatus === "sold"
 ? showAvailableAction
 ? {
 key: "available",
 label: isWorking ? "Working..." : "Available",
 title: "Make available",
 onClick: () => changeRemnantStatus(remnant, "available"),
 disabled: isWorking,
 className:
 "border-emerald-300 bg-emerald-100 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-200",
 icon: (
 <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
 <path d="m5 12 4.2 4.2L19 6.5" />
 </svg>
 ),
 }
 : null
 : showHoldAction
 ? {
 key: "hold",
 label: "Hold",
 title: "Place on hold",
 onClick: () => openHoldEditor(remnant),
 disabled: false,
 className:
 "border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-400 hover:bg-amber-200",
 icon: (
 <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
 <path d="M10.9 4.75H6.75A2 2 0 0 0 4.75 6.75v4.15l7.34 7.35a1.8 1.8 0 0 0 2.55 0l3.62-3.62a1.8 1.8 0 0 0 0-2.55L10.9 4.75Z" />
 <circle cx="7.75" cy="7.75" r="1.05" />
 </svg>
 ),
 }
 : null;
 const rightAction =
 normalizedStatus === "sold"
 ? showHoldAction
 ? {
 key: "hold",
 label: "Hold",
 title: "Place on hold",
 onClick: () => openHoldEditor(remnant),
 disabled: false,
 className:
 "border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-400 hover:bg-amber-200",
 icon: (
 <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
 <path d="M10.9 4.75H6.75A2 2 0 0 0 4.75 6.75v4.15l7.34 7.35a1.8 1.8 0 0 0 2.55 0l3.62-3.62a1.8 1.8 0 0 0 0-2.55L10.9 4.75Z" />
 <circle cx="7.75" cy="7.75" r="1.05" />
 </svg>
 ),
 }
 : null
 : showSoldAction
 ? {
 key: "sold",
 label: isWorking ? "Working..." : "Sell",
 title: "Mark sold",
 onClick: () => changeRemnantStatus(remnant, "sold"),
 disabled: isWorking,
 className:
 "border-rose-300 bg-rose-100 text-rose-800 hover:border-rose-400 hover:bg-rose-200",
 icon: (
 <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
 <path d="M12 3v18" />
 <path d="M16.5 7.5c0-1.66-2.01-3-4.5-3S7.5 5.84 7.5 7.5 9.51 10.5 12 10.5s4.5 1.34 4.5 3-2.01 3-4.5 3-4.5-1.34-4.5-3" />
 </svg>
 ),
 }
 : null;
 const centerEditAction = showEditAction
 ? {
 label: "Edit",
 title: "Edit remnant",
 onClick: () => openEditEditor(remnant),
 statusKey: "edit",
 icon: (
 <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
 <path d="M12 20h9" />
 <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
 </svg>
 ),
 }
 : null;
 const STATUS_ACTION_TOKENS = {
 available: { fg: "var(--qc-status-available-fg)", bg: "var(--qc-status-available-bg)", dot: "var(--qc-status-available-dot)" },
 hold: { fg: "var(--qc-status-hold-fg)", bg: "var(--qc-status-hold-bg)", dot: "var(--qc-status-hold-dot)" },
 sold: { fg: "var(--qc-status-sold-fg)", bg: "var(--qc-status-sold-bg)", dot: "var(--qc-status-sold-dot)" },
 };
 const colors = remnantColors(remnant);
 const eyebrow = privateCardSubheading(remnant);
 const heading = privateCardHeading(remnant);
 const metrics = privateCardMetricEntries(remnant);
 const sizeEntry = metrics.find((m) => m.label === "Size");
 const thickEntry = metrics.find((m) => m.label === "Thick");
 const finishEntry = metrics.find((m) => m.label === "Finish");
 const priceEntry = metrics.find((m) => m.label === "Price");
 const statusDescriptor = statusBadge && statusBadge !== "Available" ? statusBadge : "";
 const isArchived = Boolean(remnant.deleted_at);
 return (
 <article
 key={String(remnant.id)}
 className="group relative flex flex-col overflow-hidden bg-[color:var(--qc-bg-surface)] transition-all duration-200 hover:-translate-y-1"
 style={{
 border: isArchived ? "1px dashed var(--qc-line-strong)" : "1px solid var(--qc-line)",
 borderRadius: "var(--qc-radius-sharp)",
 opacity: isArchived ? 0.7 : 1,
 }}
 onMouseEnter={(event) => {
 event.currentTarget.style.borderColor = "var(--qc-ink-1)";
 }}
 onMouseLeave={(event) => {
 event.currentTarget.style.borderColor = isArchived ? "var(--qc-line-strong)" : "var(--qc-line)";
 }}
 >
 <div className="relative aspect-[4/3] overflow-hidden bg-[#f3f1ee]">
 {imageSrc(remnant) ? (
 <button
 type="button"
 className="absolute inset-0 z-[1] block h-full w-full overflow-hidden text-left"
 onClick={() => openImageViewer(remnant)}
 aria-label={`Open image for remnant ${displayRemnantId(remnant)}`}
 >
 <img
 src={imageSrc(remnant)}
 alt={`Remnant ${displayRemnantId(remnant)}`}
 className="h-full w-full object-cover object-top"
 decoding="async"
 />
 </button>
 ) : (
 <div className="flex h-full w-full items-center justify-center text-[11px] uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
 No image
 </div>
 )}
 {(() => {
 const statusTokens =
 normalizedStatus === "sold"
 ? { bg: "var(--qc-status-sold-bg)", fg: "var(--qc-status-sold-fg)", dot: "var(--qc-status-sold-dot)" }
 : normalizedStatus === "hold"
 ? { bg: "var(--qc-status-hold-bg)", fg: "var(--qc-status-hold-fg)", dot: "var(--qc-status-hold-dot)" }
 : normalizedStatus === "pending_approval"
 ? { bg: "var(--qc-status-pending-bg)", fg: "var(--qc-status-pending-fg)", dot: "var(--qc-status-pending-dot)" }
 : { bg: "var(--qc-status-available-bg)", fg: "var(--qc-status-available-fg)", dot: "var(--qc-status-available-dot)" };
 return (
 <div className="pointer-events-none absolute left-3 top-3 z-[2] max-w-[calc(100%-1.5rem)]">
 <span
 className="font-inter inline-flex max-w-full items-center gap-2 px-2 py-1 text-[11px]"
 style={{
 backgroundColor: statusTokens.bg,
 color: statusTokens.fg,
 borderRadius: "var(--qc-radius-sharp)",
 }}
 >
 <span
 aria-hidden="true"
 className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
 style={{ backgroundColor: statusTokens.dot }}
 />
 <span className="shrink-0 font-medium">#{displayRemnantId(remnant)}</span>
 {String(remnant.location || "").trim() ? (
 <>
 <span aria-hidden="true" className="shrink-0 opacity-50">·</span>
 <span className="inline-flex min-w-0 shrink items-center gap-1">
 <svg
 aria-hidden="true"
 viewBox="0 0 24 24"
 className="h-3 w-3 shrink-0 opacity-70"
 fill="none"
 stroke="currentColor"
 strokeWidth="1.8"
 strokeLinecap="round"
 strokeLinejoin="round"
 >
 <path d="M12 22s7-7.58 7-13a7 7 0 1 0-14 0c0 5.42 7 13 7 13Z" />
 <circle cx="12" cy="9" r="2.5" />
 </svg>
 <span className="truncate">{String(remnant.location).trim()}</span>
 </span>
 </>
 ) : null}
 {statusDescriptor ? (
 <>
 <span aria-hidden="true" className="shrink-0 opacity-50">·</span>
 <span className="min-w-0 shrink truncate">
 {statusDescriptor}
 </span>
 </>
 ) : null}
 </span>
 </div>
 );
 })()}

 {isArchived ? (
 <div className="pointer-events-none absolute right-3 top-3 z-[2]">
 <span
 className="font-inter inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em]"
 style={{
 backgroundColor: "var(--qc-ink-1)",
 color: "white",
 borderRadius: "var(--qc-radius-sharp)",
 }}
 >
 Archived
 </span>
 </div>
 ) : null}

 {leftAction ? (() => {
 const tokens = STATUS_ACTION_TOKENS[leftAction.key] || {
 bg: "var(--qc-bg-surface)",
 fg: "var(--qc-ink-1)",
 dot: "var(--qc-ink-3)",
 };
 return (
 <div className="absolute bottom-3 left-3 z-[3]">
 <button
 type="button"
 disabled={leftAction.disabled}
 onClick={(event) => {
 event.stopPropagation();
 leftAction.onClick();
 }}
 className="font-inter inline-flex h-8 items-center gap-1.5 px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
 style={{
 backgroundColor: tokens.bg,
 color: tokens.fg,
 borderRadius: "var(--qc-radius-sharp)",
 }}
 onMouseEnter={(event) => {
 if (event.currentTarget.disabled) return;
 event.currentTarget.style.backgroundColor = tokens.dot;
 event.currentTarget.style.color = "#fff";
 }}
 onMouseLeave={(event) => {
 event.currentTarget.style.backgroundColor = tokens.bg;
 event.currentTarget.style.color = tokens.fg;
 }}
 aria-label={leftAction.label}
 title={leftAction.title}
 >
 <span
 aria-hidden="true"
 className="inline-block h-1.5 w-1.5 rounded-full"
 style={{ backgroundColor: tokens.dot }}
 />
 {leftAction.label}
 </button>
 </div>
 );
 })() : null}

 {rightAction ? (() => {
 const tokens = STATUS_ACTION_TOKENS[rightAction.key] || {
 bg: "var(--qc-bg-surface)",
 fg: "var(--qc-ink-1)",
 dot: "var(--qc-ink-3)",
 };
 return (
 <div className="absolute bottom-3 right-3 z-[3]">
 <button
 type="button"
 disabled={rightAction.disabled}
 onClick={(event) => {
 event.stopPropagation();
 rightAction.onClick();
 }}
 className="font-inter inline-flex h-8 items-center gap-1.5 px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
 style={{
 backgroundColor: tokens.bg,
 color: tokens.fg,
 borderRadius: "var(--qc-radius-sharp)",
 }}
 onMouseEnter={(event) => {
 if (event.currentTarget.disabled) return;
 event.currentTarget.style.backgroundColor = tokens.dot;
 event.currentTarget.style.color = "#fff";
 }}
 onMouseLeave={(event) => {
 event.currentTarget.style.backgroundColor = tokens.bg;
 event.currentTarget.style.color = tokens.fg;
 }}
 aria-label={rightAction.label}
 title={rightAction.title}
 >
 <span
 aria-hidden="true"
 className="inline-block h-1.5 w-1.5 rounded-full"
 style={{ backgroundColor: tokens.dot }}
 />
 {rightAction.label}
 </button>
 </div>
 );
 })() : null}

 {centerEditAction ? (
 <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[3] flex justify-center">
 <button
 type="button"
 onClick={(event) => {
 event.stopPropagation();
 centerEditAction.onClick();
 }}
 className="font-inter pointer-events-auto inline-flex h-8 items-center gap-1.5 bg-[color:var(--qc-ink-1)] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[color:var(--qc-orange)]"
 style={{ borderRadius: "var(--qc-radius-sharp)" }}
 aria-label={centerEditAction.label}
 title={centerEditAction.title}
 >
 {centerEditAction.icon}
 {centerEditAction.label}
 </button>
 </div>
 ) : null}
 </div>

 <div className="flex flex-1 flex-col gap-3 p-4">
 <div>
 {eyebrow ? (
 <p
 className="font-inter text-[10px] font-semibold uppercase leading-none tracking-[0.18em]"
 style={{ color: "var(--qc-orange)" }}
 >
 {eyebrow}
 </p>
 ) : null}
 <h3 className="font-inter mt-2 text-[17px] font-medium leading-snug tracking-[-0.01em] text-[color:var(--qc-ink-1)]">
 {heading}
 </h3>
 {colors.length ? (
 <div className="mt-3 flex items-center gap-2">
 <div className="flex items-center gap-1.5">
 {colors.slice(0, 3).map((color) => (
 <ColorTooltip key={`${remnant.id}-${color}`} name={color}>
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
 </div>
 <span className="text-[11px] text-[color:var(--qc-ink-3)]">
 {colors.slice(0, 3).join(" · ")}
 </span>
 </div>
 ) : null}
 </div>

 <div
 className="mt-auto flex items-end justify-between gap-3 pt-3"
 style={{ borderTop: "1px solid var(--qc-line)" }}
 >
 <div className="min-w-0">
 <p className="font-inter flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
 <span>Size</span>
 {remnant.l_shape ? (
 <span
 className="px-1 text-[9px] tracking-[0.12em] text-[color:var(--qc-ink-2)]"
 style={{ border: "1px solid var(--qc-line-strong)" }}
 >
 L
 </span>
 ) : null}
 </p>
 {sizeEntry ? (
 <p className="mt-1 text-[13px] font-medium text-[color:var(--qc-ink-1)]">
 {sizeEntry.value}
 </p>
 ) : null}
 {thickEntry ? (
 <p
 className="mt-0.5 text-[11px] text-[color:var(--qc-ink-3)]"
 style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
 >
 {thickEntry.value}
 </p>
 ) : null}
 </div>
 {(finishEntry || priceEntry) ? (
 <div className="text-right">
 {finishEntry ? (
 <>
 <p className="font-inter text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
 Finish
 </p>
 <p className="mt-1 text-[13px] font-medium text-[color:var(--qc-ink-1)]">
 {finishEntry.value}
 </p>
 </>
 ) : null}
 {priceEntry ? (
 <p
 className="mt-1 text-[11px] text-[color:var(--qc-ink-2)]"
 title={priceEntry.title}
 style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
 >
 {priceEntry.value}
 </p>
 ) : null}
 </div>
 ) : null}
 </div>
 </div>
 </article>
 );
 })}
 </div>
 )}
 </section>
 </div>
 </div>

 <PrivateFooter />

 <ImageViewer
 remnant={selectedImageRemnant}
 index={selectedImageIndex ?? 0}
 total={modalImageItems.length}
 onClose={closeImageViewer}
 onPrev={showPreviousImage}
 onNext={showNextImage}
 />

 <HoldRequestsQueue
 open={queueOpen}
 onClose={() => setQueueOpen(false)}
 holdRequests={holdRequests}
 holdRequestDrafts={holdRequestDrafts}
 setHoldRequestDrafts={setHoldRequestDrafts}
 pendingReviewId={pendingReviewId}
 reviewHoldRequest={reviewHoldRequest}
 workspaceCopy={workspaceCopy}
 openImageViewer={openImageViewer}
 />

 <ApprovalsPanel
 open={approvalsOpen}
 onClose={() => setApprovalsOpen(false)}
 pendingApprovals={pendingApprovals}
 approvingId={approvingId}
 handleApproveRemnant={handleApproveRemnant}
 onEdit={(remnant) => { setApprovalsOpen(false); openEditEditor(remnant); }}
 />

 <MyHoldsPanel
 open={myHoldsOpen}
 onClose={() => setMyHoldsOpen(false)}
 myHolds={myHolds}
 myHoldsLoading={myHoldsLoading}
 workingRemnantId={workingRemnantId}
 changeRemnantStatus={changeRemnantStatus}
 openHoldEditor={openHoldEditor}
 openImageViewer={openImageViewer}
 />

 <MySoldPanel
 open={mySoldOpen}
 onClose={() => setMySoldOpen(false)}
 mySold={mySold}
 mySoldLoading={mySoldLoading}
 openImageViewer={openImageViewer}
 />

 <RemnantEditor
 editorMode={editorMode}
 editorForm={editorForm}
 setEditorForm={setEditorForm}
 onClose={closeEditor}
 onSave={saveEditor}
 onArchive={archiveEditorRemnant}
 profile={profile}
 lookups={lookups}
 activeLookupColors={activeLookupColors}
 canEditLinkedSlab={canEditLinkedSlab}
 saveError={editorError}
 showSuccessMessage={showSuccessMessage}
 showErrorMessage={showErrorMessage}
 />

 <HoldEditor
 holdEditor={holdEditor}
 onClose={closeHoldEditor}
 onSave={saveHoldEditor}
 onRelease={releaseHoldEditor}
 onSell={sellFromHoldEditor}
 onFieldChange={(key, value) => setHoldEditor((current) => ({ ...(current || {}), [key]: value }))}
 openImageViewer={openImageViewer}
 salesReps={salesReps}
 />

 <SoldEditor
 soldEditor={soldEditor}
 onClose={closeSoldEditor}
 onSave={saveSoldEditor}
 onFieldChange={(key, value) => setSoldEditor((current) => ({ ...(current || {}), [key]: value }))}
 openImageViewer={openImageViewer}
 salesReps={salesReps}
 profile={profile}
 />

 {message ? (
 <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[74] flex justify-center sm:inset-x-auto sm:right-5 sm:justify-end">
 <div
 className={`pointer-events-auto flex w-full max-w-md items-start justify-between gap-3 rounded-sm border px-4 py-3 text-sm ${
 messageTone === "error"
 ? "border-rose-200 bg-white/96 text-rose-800"
 : "border-emerald-200 bg-white/96 text-[#285641]"
 }`}
 role="status"
 aria-live="polite"
 >
 <p className="pr-2">{message}</p>
 <button
 type="button"
 onClick={clearMessage}
 className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold transition-colors ${
 messageTone === "error"
 ? "text-rose-600 hover:bg-rose-50"
 : "text-emerald-700 hover:bg-emerald-50"
 }`}
 aria-label="Dismiss message"
 >
 Close
 </button>
 </div>
 </div>
 ) : null}

 {showBackToTop && !isModalOpen ? (
 <button
 type="button"
 onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
 aria-label="Scroll to top"
 title="Scroll to top"
 className="fixed right-6 z-[60] inline-flex h-11 w-11 items-center justify-center text-white transition-colors hover:bg-[#232323]"
 style={{
 bottom: `${backToTopBottom}px`,
 backgroundColor: "var(--qc-ink-1)",
 borderRadius: "var(--qc-radius-sharp)",
 boxShadow: "var(--qc-shadow-toast)",
 }}
 >
 <svg
 aria-hidden="true"
 viewBox="0 0 24 24"
 className="h-4 w-4"
 fill="none"
 stroke="currentColor"
 strokeWidth="1.8"
 strokeLinecap="round"
 strokeLinejoin="round"
 >
 <path d="M12 19V5" />
 <path d="m5 12 7-7 7 7" />
 </svg>
 </button>
 ) : null}
 </main>
 );
}
