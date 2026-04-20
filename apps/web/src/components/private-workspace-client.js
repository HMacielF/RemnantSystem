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
  currentFiltersFromSearch,
  buildSearchQuery,
  PrivateWorkspaceSkeletonCard,
  remnantToastLabel,
  statusToastText,
  normalizeJobNumberInput,
  humanizeRole,
  isAccessDeniedError,
  uniqueMaterialOptions,
  SelectField,
  formatJobNumber,
  formatDateLabel,
  TOAST_DURATION_MS,
  HOLD_REQUEST_REFRESH_MS,
} from "./workspace/workspace-utils.js";
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
  const remnantAbortRef = useRef(null);
  const enrichmentRef = useRef(null);
  const lastPathnameRef = useRef(pathname);
  const canStructure = canManageStructure(profile);
  const canEditLinkedSlab = profile?.system_role === "super_admin";
  const isStatusUser = profile?.system_role === "status_user";
  const roleDisplay = humanizeRole(profile?.system_role);
  const activeLookupColors = Array.isArray(lookups.colors)
    ? lookups.colors.filter((row) => row?.active !== false && row?.name)
    : [];
  const profileCompanyName = useMemo(() => {
    const directName = String(
      profile?.company_name || profile?.company?.name || profile?.company || "",
    ).trim();
    if (directName) return directName;
    const match = (Array.isArray(lookups?.companies) ? lookups.companies : []).find(
      (company) => Number(company?.id) === Number(profile?.company_id),
    );
    return String(match?.name || "").trim();
  }, [lookups?.companies, profile]);
  const materialFilterOptions = useMemo(() => {
    return uniqueMaterialOptions([...availableMaterialOptions, ...filters.materials]);
  }, [availableMaterialOptions, filters.materials]);
  const filterGridClass = canStructure
    ? "mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] 2xl:grid-cols-[fit-content(29rem)_minmax(360px,1fr)_110px_110px_140px_56px] 2xl:items-end"
    : "mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] 2xl:grid-cols-[fit-content(29rem)_minmax(360px,1fr)_110px_110px_140px] 2xl:items-end";
  const activeFilterCount = useMemo(() => {
    let total = 0;
    if (filters.materials.length) total += 1;
    if (filters.stone.trim()) total += 1;
    if (filters.minWidth.trim()) total += 1;
    if (filters.minHeight.trim()) total += 1;
    if (filters.status.trim()) total += 1;
    return total;
  }, [filters]);
  const boardGridClass = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  const modalImageItems = useMemo(
    () => remnants.filter((remnant) => Boolean(imageSrc(remnant))),
    [remnants],
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

  async function saveEditor(event) {
    event.preventDefault();
    if (!editorForm) return;

    try {
      clearMessage();
      setError("");
      setEditorError("");
      const payload = {
        moraware_remnant_id: editorForm.moraware_remnant_id,
        name: editorForm.name,
        brand_name: editorForm.brand_name,
        company_id: editorForm.company_id,
        material_id: editorForm.material_id,
        thickness_id: editorForm.thickness_id,
        finish_id: editorForm.finish_id,
        colors: editorForm.colors,
        price_per_sqft: editorForm.price_per_sqft,
        width: editorForm.width,
        height: editorForm.height,
        l_shape: Boolean(editorForm.l_shape),
        l_width: editorForm.l_shape ? editorForm.l_width : "",
        l_height: editorForm.l_shape ? editorForm.l_height : "",
        image_file: editorForm.image_file || undefined,
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
    return <main className="min-h-screen bg-[#edf1f6] px-6 py-10 text-[#172230]">Loading workspace...</main>;
  }

  if (authState === "forbidden") {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#0f1727_0%,#203454_38%,#edf1f6_38%,#edf1f6_100%)] px-6 py-10 text-[#172230]">
        <div className="mx-auto max-w-3xl rounded-[32px] border border-white/15 bg-white/95 p-8 shadow-[0_28px_90px_rgba(8,15,32,0.18)]">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#5b6f87]">Access Required</p>
          <h1 className="mt-3 text-3xl font-semibold text-[#172230]">This private workspace needs an active management login.</h1>
          <p className="mt-3 text-sm leading-7 text-[#5f6c7b]">
            Sign in first, then come back here to continue in the private workspace.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/portal" className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#152238] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#f08b49]">
              Open Login
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,var(--brand-white)_52%,rgba(247,134,57,0.08)_100%)] text-[var(--brand-ink)]">
      <div className="mx-auto w-full max-w-[1800px] px-3 py-5 sm:px-4 md:px-6 2xl:px-8">
        <section className="mb-4 overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-[linear-gradient(135deg,rgba(255,255,255,0.99),rgba(242,242,242,0.96))] px-6 py-5 text-[var(--brand-ink)] shadow-panel">
          <div className={`grid gap-5 lg:items-start ${isStatusUser ? "xl:grid-cols-[minmax(0,1fr)_520px]" : "xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,640px)]"}`}>
            <div className={`${isStatusUser ? "max-w-3xl" : "max-w-4xl"}`}>
              <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-orange)]">Management Workspace</p>
              <h1 className={`font-display mt-3 font-semibold leading-tight text-[var(--brand-ink)] ${isStatusUser ? "max-w-2xl text-[1.7rem] md:text-[2.05rem]" : "max-w-3xl text-[1.9rem] md:text-[2.35rem]"}`}>
                {workspaceCopy.title}
              </h1>
              <p className={`mt-2 text-sm text-[rgba(35,35,35,0.72)] ${isStatusUser ? "max-w-2xl leading-5.5" : "max-w-3xl leading-6"}`}>
                {workspaceCopy.description}
              </p>
            </div>

            <div className={`rounded-[22px] border border-[var(--brand-line)] bg-white p-3.5 shadow-[0_16px_38px_rgba(25,27,28,0.06)] backdrop-blur ${isStatusUser ? "" : "ml-auto w-fit min-w-[420px] max-w-full"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-[var(--brand-ink)]">
                    {[
                      profileCompanyName,
                      profile?.full_name || profile?.email || "User",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </h2>
                </div>
                <form method="POST" action="/api/auth/logout" className="shrink-0">
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-3.5 text-center text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-shell)]"
                  >
                    Log Out
                  </button>
                </form>
              </div>
              <div className={`mt-3.5 gap-2.5 ${isStatusUser ? "flex items-center" : "flex flex-wrap items-center"}`}>
                <button
                  type="button"
                  onClick={() => {
                    setMySoldOpen(false);
                    setMyHoldsOpen(false);
                    setQueueOpen(true);
                  }}
                  className={`inline-flex h-10 items-center justify-between gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-shell)] ${
                    isStatusUser ? "min-w-0 flex-1" : "min-w-[118px]"
                  }`}
                >
                  <span className="whitespace-nowrap">Requests</span>
                  <span className="inline-flex min-w-7 shrink-0 items-center justify-center rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(244,63,94,0.32)]">
                    {holdRequests.length}
                  </span>
                </button>
                {profile?.system_role === "super_admin" && pendingApprovals.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setApprovalsOpen(true)}
                    className="inline-flex h-10 items-center justify-between gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-shell)]"
                  >
                    <span className="whitespace-nowrap">Approvals</span>
                    <span className="inline-flex min-w-7 shrink-0 items-center justify-center rounded-full bg-violet-500 px-2 py-0.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(139,92,246,0.32)]">
                      {pendingApprovals.length}
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={openMyHoldsPanel}
                  className={`inline-flex h-10 items-center justify-between gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-shell)] ${
                    isStatusUser ? "min-w-0 flex-1" : "min-w-[118px]"
                  }`}
                >
                  <span className="whitespace-nowrap">Holds</span>
                  <span className="inline-flex min-w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-[#3d2918] shadow-[0_8px_18px_rgba(251,191,36,0.28)]">
                    {myHolds.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openMySoldPanel}
                  className={`inline-flex h-10 items-center justify-between gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-shell)] ${
                    isStatusUser ? "min-w-0 flex-1" : "min-w-[118px]"
                  }`}
                >
                  <span className="whitespace-nowrap">Sold</span>
                  <span className="inline-flex min-w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(247,134,57,0.14)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-orange-deep)]">
                    {mySold.length}
                  </span>
                </button>
                {profile?.system_role === "super_admin" ? (
                  <>
                    <Link
                      href="/manage/confirm"
                      className={`inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-shell)] ${
                        isStatusUser ? "shrink-0 px-3.5" : ""
                      }`}
                    >
                      Inventory Check
                    </Link>
                    <Link
                      href="/admin"
                      className={`inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-shell)] ${
                        isStatusUser ? "shrink-0 px-3.5" : ""
                      }`}
                    >
                      Admin
                    </Link>
                    <Link
                      href="/slabs"
                      className={`inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-shell)] ${
                        isStatusUser ? "shrink-0 px-3.5" : ""
                      }`}
                    >
                      Slabs
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          </div>

        </section>

        <div className="space-y-4">
          <section className="space-y-4">
            <div className="rounded-[30px] border border-[var(--brand-line)] bg-white/94 p-4 shadow-[0_24px_70px_rgba(25,27,28,0.08)] backdrop-blur">
              <div className={filterGridClass}>
                <div className="min-w-0 sm:col-span-2 2xl:col-span-1 2xl:max-w-[29rem]">
                  <p className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                    Material Types
                  </p>
                  <div className="flex h-12 w-full max-w-full snap-x snap-mandatory items-center gap-2 overflow-x-auto whitespace-nowrap rounded-2xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm text-[var(--brand-ink)] shadow-sm [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
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
                          className={`inline-flex shrink-0 snap-start items-center rounded-xl border px-3 py-2 text-[13px] font-medium transition-all ${
                            checked
                              ? "border-[var(--brand-orange)] bg-[rgba(247,134,57,0.12)] text-[var(--brand-orange-deep)] shadow-sm"
                              : "border-[var(--brand-line)] bg-white text-[rgba(25,27,28,0.72)] hover:border-[rgba(247,134,57,0.32)] hover:bg-[var(--brand-shell)]"
                          }`}
                        >
                          {material}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="block min-w-0 sm:col-span-2 2xl:col-span-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                  Stone / Brand / Color / Finish / ID #
                  <div className="relative mt-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-orange)]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="6.5" />
                      <path d="M16 16l4 4" />
                    </svg>
                    <input
                      type="text"
                      value={filters.stone}
                      onChange={(event) => setFilters((current) => ({ ...current, stone: event.target.value }))}
                      placeholder="Stone, brand, color, finish or #741"
                      className="h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white pl-10 pr-4 text-sm font-medium text-[var(--brand-ink)] placeholder:text-[rgba(25,27,28,0.45)] shadow-sm outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                    />
                  </div>
                </label>

                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                  Min Width
                  <input
                    type="text"
                    inputMode="decimal"
                    value={filters.minWidth}
                    onChange={(event) => setFilters((current) => ({ ...current, minWidth: event.target.value }))}
                    placeholder="W"
                    className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-3 text-sm font-medium text-[var(--brand-ink)] placeholder:text-[rgba(25,27,28,0.45)] shadow-sm outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                  />
                </label>

                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                  Min Height
                  <input
                    type="text"
                    inputMode="decimal"
                    value={filters.minHeight}
                    onChange={(event) => setFilters((current) => ({ ...current, minHeight: event.target.value }))}
                    placeholder="H"
                    className="mt-2 h-12 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-3 text-sm font-medium text-[var(--brand-ink)] placeholder:text-[rgba(25,27,28,0.45)] shadow-sm outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                  />
                </label>

                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                  Status
                  <SelectField
                    value={filters.status}
                    onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                    wrapperClassName="relative mt-2"
                    className="px-3"
                  >
                    <option value="">All</option>
                    <option value="available">Available</option>
                    <option value="hold">On Hold</option>
                    <option value="sold">Sold</option>
                  </SelectField>
                </label>

                {canStructure ? (
                  <div className="flex items-end justify-start sm:col-span-2 2xl:col-span-1 2xl:justify-center">
                    <div className="flex w-12 flex-col items-center">
                      <p className="mb-2 hidden w-full text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)] lg:block">
                        Add
                      </p>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={openCreateEditor}
                          className="peer inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-ink)] text-white shadow-[0_14px_30px_rgba(25,27,28,0.18)] transition-all hover:-translate-y-0.5 hover:bg-[var(--brand-orange)]"
                          aria-label="Add remnant"
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            className="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 5v14" />
                            <path d="M5 12h14" />
                          </svg>
                        </button>
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-[#2c211c]/92 px-3 py-2 text-[11px] font-semibold text-white opacity-0 shadow-lg backdrop-blur-sm transition-all peer-hover:opacity-100 peer-focus-visible:opacity-100 xl:inline-flex">
                          Add remnant
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {loading ? (
              <div className={boardGridClass}>
                {Array.from({ length: 6 }).map((_, index) => (
                  <PrivateWorkspaceSkeletonCard key={index} showActions={isStatusUser} />
                ))}
              </div>
            ) : error ? (
              <div className="rounded-[28px] border border-rose-200 bg-white/90 px-6 py-10 text-center text-rose-700 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-500">Load Failed</p>
                <h3 className="mt-2 text-xl font-semibold text-rose-800">We couldn&apos;t load the workspace right now.</h3>
                <p className="mt-2 text-sm">{error}</p>
              </div>
            ) : (
              <div className={boardGridClass}>
                {remnants.map((remnant) => {
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
                  const actionButtonBaseClass =
                    "inline-flex h-11 items-center justify-center rounded-[18px] border px-3 text-[11px] font-semibold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-60";
                  const centerEditAction = showEditAction
                    ? {
                        label: "Edit",
                        title: "Edit remnant",
                        onClick: () => openEditEditor(remnant),
                        className: "border-slate-300 bg-slate-100 text-slate-800 hover:border-slate-400 hover:bg-slate-200",
                        icon: (
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.36 3.89h3.28l.47 1.88a6.8 6.8 0 0 1 1.51.63l1.7-.93 2.32 2.32-.93 1.7c.26.48.47.98.63 1.5l1.88.48v3.28l-1.88.47a6.8 6.8 0 0 1-.63 1.51l.93 1.7-2.32 2.32-1.7-.93a6.8 6.8 0 0 1-1.5.63l-.48 1.88h-3.28l-.47-1.88a6.8 6.8 0 0 1-1.51-.63l-1.7.93-2.32-2.32.93-1.7a6.8 6.8 0 0 1-.63-1.5l-1.88-.48v-3.28l1.88-.47c.16-.52.37-1.02.63-1.51l-.93-1.7 2.32-2.32 1.7.93c.48-.26.98-.47 1.5-.63z" />
                            <circle cx="12" cy="12" r="2.85" />
                          </svg>
                        ),
                      }
                    : null;
                  return (
                    <article
                      key={String(remnant.id)}
                      className="group relative overflow-hidden rounded-[24px] border border-[var(--brand-line)] bg-[rgba(255,255,255,0.96)] shadow-[0_14px_30px_rgba(25,27,28,0.08)] transition-transform [contain-intrinsic-size:420px] [content-visibility:auto] hover:-translate-y-1 sm:rounded-[26px]"
                    >
                      <div className="relative">
                        <div className="overflow-hidden">
                          <div className="relative aspect-[4/3] overflow-hidden bg-[linear-gradient(180deg,var(--brand-white)_0%,rgba(255,255,255,0.94)_100%)]">
                            {imageSrc(remnant) ? (
                              <button
                                type="button"
                                className="absolute inset-0 z-[1] block w-full overflow-hidden text-left"
                                onClick={() => openImageViewer(remnant)}
                                aria-label={`Open image for remnant ${displayRemnantId(remnant)}`}
                              />
                            ) : null}
                            <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-24 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.45),transparent_72%)]" />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-16 bg-[linear-gradient(180deg,rgba(35,35,35,0),rgba(35,35,35,0.18))]" />
                            <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex items-start justify-between gap-2 p-3">
                              <span className="inline-flex items-center rounded-full border border-white/70 bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-orange-deep)] shadow-sm backdrop-blur">
                                ID #{displayRemnantId(remnant)}
                              </span>
                              <span
                                className={`inline-flex max-w-[72%] items-center justify-end rounded-full px-2.5 py-1 text-[10px] font-semibold leading-tight tracking-[0.02em] shadow-sm backdrop-blur ${statusBadgeClass(normalizedStatus)}`}
                              >
                                {statusBadge}
                              </span>
                            </div>
                            {imageSrc(remnant) ? (
                              <div className="pointer-events-none flex h-full w-full items-center justify-center overflow-hidden p-1.5 sm:p-2">
                                <img
                                  src={imageSrc(remnant)}
                                  alt={`Remnant ${displayRemnantId(remnant)}`}
                                  className="h-full w-full scale-[1.05] object-contain object-center transition-transform duration-300 motion-safe:md:group-hover:scale-[1.08]"
                                  decoding="async"
                                />
                              </div>
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-[var(--brand-white)] text-sm font-semibold uppercase tracking-[0.16em] text-[var(--brand-orange)]">
                                No Image
                              </div>
                            )}
                            {leftAction ? (
                              <div className="absolute bottom-0 left-0 z-[3] p-3">
                                <button
                                  type="button"
                                  disabled={leftAction.disabled}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    leftAction.onClick();
                                  }}
                                  className={`group/private-action inline-flex h-10 items-center justify-center gap-0 overflow-hidden rounded-2xl px-2.5 pr-2.5 text-[11px] font-medium shadow-[0_12px_30px_rgba(25,27,28,0.18)] backdrop-blur transition-all hover:-translate-y-0.5 hover:gap-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${leftAction.className}`}
                                  aria-label={leftAction.label}
                                  title={leftAction.title}
                                >
                                  {leftAction.icon}
                                  <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover/private-action:max-w-[8rem] group-hover/private-action:opacity-100">
                                    {leftAction.label}
                                  </span>
                                </button>
                              </div>
                            ) : null}
                            {rightAction ? (
                              <div className="absolute bottom-0 right-0 z-[3] p-3">
                                <button
                                  type="button"
                                  disabled={rightAction.disabled}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    rightAction.onClick();
                                  }}
                                  className={`group/private-action inline-flex h-10 items-center justify-end gap-0 overflow-hidden rounded-2xl px-2.5 pr-2.5 text-[11px] font-medium shadow-[0_12px_30px_rgba(25,27,28,0.18)] backdrop-blur transition-all hover:-translate-y-0.5 hover:gap-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${rightAction.className}`}
                                  aria-label={rightAction.label}
                                  title={rightAction.title}
                                >
                                  <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover/private-action:max-w-[8rem] group-hover/private-action:opacity-100">
                                    {rightAction.label}
                                  </span>
                                  {rightAction.icon}
                                </button>
                              </div>
                            ) : null}
                            {centerEditAction ? (
                              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] flex justify-center p-3">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    centerEditAction.onClick();
                                  }}
                                  className={`pointer-events-auto group/private-action inline-flex h-10 items-center justify-center gap-0 overflow-hidden rounded-2xl px-2.5 text-[11px] font-medium shadow-[0_12px_30px_rgba(25,27,28,0.18)] backdrop-blur transition-all hover:-translate-y-0.5 hover:gap-2 active:scale-[0.99] ${centerEditAction.className}`}
                                  aria-label={centerEditAction.label}
                                  title={centerEditAction.title}
                                >
                                  {centerEditAction.icon}
                                  <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover/private-action:max-w-[7rem] group-hover/private-action:opacity-100">
                                    {centerEditAction.label}
                                  </span>
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="p-3 text-sm text-[#232323] sm:p-3.5">
                        <div className="rounded-[22px] border border-[var(--brand-line)] bg-[linear-gradient(180deg,#ffffff_0%,rgba(242,242,242,0.92)_100%)] px-3.5 py-3 text-[var(--brand-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                          <div className="min-w-0">
                            <h3 className="font-display text-[16px] font-semibold leading-snug text-[var(--brand-ink)] sm:text-[17px]">
                              {privateCardHeading(remnant)}
                            </h3>
                            {privateCardSubheading(remnant) ? (
                              <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgba(35,35,35,0.54)]">
                                {privateCardSubheading(remnant)}
                              </p>
                            ) : null}
                          </div>
                          <div className={`mt-3 grid items-stretch gap-2 ${privateCardMetricEntries(remnant).length >= 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                            {privateCardMetricEntries(remnant).map((entry, index) => (
                              <div
                                key={`${remnant.id}-${entry.label}`}
                                className="flex min-w-0 flex-col rounded-[16px] border border-[var(--brand-line)] bg-white/88 px-3 py-2"
                              >
                                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-orange)] sm:text-[11px]" title={entry.title}>
                                  {entry.label}
                                </p>
                                <p className="mt-1 text-[12px] font-semibold leading-tight text-[var(--brand-ink)] sm:text-[13px]">
                                  {entry.value}
                                </p>
                              </div>
                            ))}
                          </div>
                          {remnantColors(remnant).length ? (
                            <div className="mt-3 flex flex-wrap justify-center gap-2">
                              {remnantColors(remnant).map((color) => (
                                <span
                                  key={`${remnant.id}-${color}`}
                                  className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-line)] bg-white/92 px-2.5 py-1 text-[11px] font-semibold text-[rgba(25,27,28,0.72)]"
                                >
                                  <span
                                    aria-hidden="true"
                                    className="h-3 w-3 rounded-full border border-black/10 shadow-inner"
                                    style={colorSwatchStyle(color)}
                                  />
                                  {color}
                                </span>
                              ))}
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

      <footer className="px-4 pb-10 pt-2 md:px-6">
        <div className="mx-auto max-w-[1800px] rounded-[24px] border border-[var(--brand-line)] bg-white/80 px-4 py-5 text-center shadow-sm backdrop-blur sm:rounded-[28px] sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">Internal Workspace</p>
          <p className="mt-2 text-sm text-[rgba(25,27,28,0.72)]">Built to keep remnant inventory, hold review, and status updates clear for the team.</p>
        </div>
      </footer>

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
            className={`pointer-events-auto flex w-full max-w-md items-start justify-between gap-3 rounded-[24px] border px-4 py-3 text-sm shadow-toast backdrop-blur ${
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
    </main>
  );
}
