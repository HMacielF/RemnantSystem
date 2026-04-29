"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import PrivateHeader from "@/components/private/PrivateHeader";

const STORAGE_KEY = "remnant-confirm-session-id";

async function apiFetch(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = "Request failed";
    try {
      const payload = await response.json();
      message = payload?.error || message;
    } catch (_error) {
      message = await response.text().catch(() => message);
    }
    throw new Error(message);
  }
  return response.json();
}

function createSessionId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `inventory-pass-${stamp}-${random}`;
}

function displayRemnantId(remnant) {
  return remnant?.display_id || remnant?.moraware_remnant_id || remnant?.id || "";
}

function sizeText(remnant) {
  if (!remnant) return "";
  if (remnant.l_shape) {
    return `${remnant.width}" × ${remnant.height}" + ${remnant.l_width}" × ${remnant.l_height}"`;
  }
  return remnant.width && remnant.height ? `${remnant.width}" × ${remnant.height}"` : "";
}

function statusText(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "hold") return "On Hold";
  if (normalized === "sold") return "Sold";
  return "Available";
}

function normalizeLookupValue(value) {
  return String(value || "").replace(/[^\d]/g, "").slice(0, 12);
}

function compactSuccessMessage(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return value
    .replace(" in inventory", " → seen")
    .replace(" as physically present but missing from the database", " → not in DB")
    .replace(" as not seen in inventory", " → missing")
    .replace(" for review", " → review");
}

function friendlyErrorMessage(error, fallback) {
  const raw = String(error?.message || "").trim();
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("network request failed") ||
    normalized.includes("load failed")
  ) {
    return "Connection lost. Check your signal and try again.";
  }
  return raw;
}

function formatScanTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusPillStyle(status) {
  const lc = String(status || "").toLowerCase();
  if (lc === "sold") {
    return {
      backgroundColor: "var(--qc-status-sold-bg)",
      color: "var(--qc-status-sold-fg)",
      dot: "var(--qc-status-sold-dot)",
    };
  }
  if (lc === "hold" || lc === "on hold") {
    return {
      backgroundColor: "var(--qc-status-hold-bg)",
      color: "var(--qc-status-hold-fg)",
      dot: "var(--qc-status-hold-dot)",
    };
  }
  return {
    backgroundColor: "var(--qc-status-available-bg)",
    color: "var(--qc-status-available-fg)",
    dot: "var(--qc-status-available-dot)",
  };
}

export default function RemnantConfirmClient({ profile = null }) {
  const [sessionId, setSessionId] = useState("");
  const [lookupValue, setLookupValue] = useState("");
  const [locationValue, setLocationValue] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [savingOutcome, setSavingOutcome] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("success");
  const [error, setError] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [localCheckedCount, setLocalCheckedCount] = useState(0);
  const [inputPulse, setInputPulse] = useState(false);
  const [lastResolvedLookup, setLastResolvedLookup] = useState(null);
  const [holdCount, setHoldCount] = useState(null);
  const [holdConfirmOpen, setHoldConfirmOpen] = useState(false);
  const [holdStarting, setHoldStarting] = useState(false);
  const [sessionSummary, setSessionSummary] = useState(null);
  const inputRef = useRef(null);
  const locationRef = useRef(null);
  const lookupRequestIdRef = useRef(0);
  const runLookupRef = useRef(null);
  const messageTimeoutRef = useRef(null);
  const inputPulseTimeoutRef = useRef(null);

  function persistSession(nextSessionId) {
    window.localStorage.setItem(STORAGE_KEY, nextSessionId);
    setSessionId(nextSessionId);
  }

  function clearPendingMessageTimeout() {
    if (messageTimeoutRef.current) {
      window.clearTimeout(messageTimeoutRef.current);
      messageTimeoutRef.current = null;
    }
  }

  function clearInputPulseTimeout() {
    if (inputPulseTimeoutRef.current) {
      window.clearTimeout(inputPulseTimeoutRef.current);
      inputPulseTimeoutRef.current = null;
    }
  }

  function showTransientMessage(text, tone = "success") {
    const nextMessage = compactSuccessMessage(text);
    clearPendingMessageTimeout();
    setMessage(nextMessage);
    setMessageTone(tone);
    if (nextMessage) {
      messageTimeoutRef.current = window.setTimeout(() => {
        setMessage("");
        messageTimeoutRef.current = null;
      }, 2200);
    }
  }

  function triggerSuccessFeedback() {
    if (typeof window !== "undefined" && typeof window.navigator?.vibrate === "function") {
      window.navigator.vibrate(35);
    }
  }

  function pulseInputReadyState() {
    clearInputPulseTimeout();
    setInputPulse(true);
    inputPulseTimeoutRef.current = window.setTimeout(() => {
      setInputPulse(false);
      inputPulseTimeoutRef.current = null;
    }, 700);
  }

  useEffect(() => {
    const stored = String(window.localStorage.getItem(STORAGE_KEY) || "").trim();
    const nextSessionId = stored || createSessionId();
    persistSession(nextSessionId);
    inputRef.current?.focus();
  }, []);

  useEffect(() => () => {
    clearPendingMessageTimeout();
    clearInputPulseTimeout();
  }, []);

  async function refreshHoldCount() {
    try {
      const payload = await apiFetch("/api/remnant-checks?hold_count=1", { cache: "no-store" });
      setHoldCount(payload?.count ?? 0);
    } catch (_err) {
      /* best effort */
    }
  }

  async function refreshSessionSummary(targetSessionId) {
    const id = targetSessionId || sessionId;
    if (!id) return;
    try {
      const payload = await apiFetch(
        `/api/remnant-checks?session_id=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      setSessionSummary(payload || null);
    } catch (_err) {
      /* best effort */
    }
  }

  useEffect(() => {
    refreshHoldCount();
  }, []);

  useEffect(() => {
    if (sessionId) refreshSessionSummary(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function startInventoryDoubleCheck() {
    setHoldStarting(true);
    setError("");
    try {
      const newSessionId = createSessionId();
      persistSession(newSessionId);
      setLocalCheckedCount(0);
      setLookupValue("");
      setLookupResult(null);
      setLastResolvedLookup(null);
      setSessionSummary(null);

      const payload = await apiFetch("/api/remnant-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk_inventory_hold" }),
      });
      setHoldCount(payload?.count ?? 0);
      setHoldConfirmOpen(false);
      showTransientMessage(`${payload?.count ?? 0} remnants flagged — scan each to confirm`, "warn");
      refreshSessionSummary(newSessionId);
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, "Failed to start inventory double check."));
    } finally {
      setHoldStarting(false);
    }
  }

  const currentRemnant = lookupResult?.remnant || null;
  const existingCheck = lookupResult?.existing_check || null;
  const canConfirm = Boolean(currentRemnant?.id) && !savingOutcome;
  const currentStatus = String(currentRemnant?.status || "").trim().toLowerCase();
  const currentStatusStyle = statusPillStyle(currentStatus);

  runLookupRef.current = async (rawValue) => {
    const nextValue = String(rawValue || "").trim();
    if (!nextValue || !sessionId) {
      setLookupResult(null);
      setLookupLoading(false);
      return;
    }

    const requestId = lookupRequestIdRef.current + 1;
    lookupRequestIdRef.current = requestId;
    setLookupLoading(true);
    setError("");
    setMessage("");
    try {
      const payload = await apiFetch(
        `/api/remnant-checks?session_id=${encodeURIComponent(sessionId)}&number=${encodeURIComponent(nextValue)}`,
        { cache: "no-store" },
      );
      if (lookupRequestIdRef.current !== requestId) return;
      setLookupResult(payload);
      if (payload?.remnant) {
        setLastResolvedLookup({
          remnant: payload.remnant,
          existingCheck: payload.existing_check || null,
          enteredNumber: payload.entered_number || nextValue,
        });
      }
      if (!payload?.remnant) {
        setMessage(`No remnant found for #${nextValue}. Mark it below if it exists physically.`);
        setMessageTone("warn");
      }
    } catch (nextError) {
      if (lookupRequestIdRef.current !== requestId) return;
      setError(friendlyErrorMessage(nextError, "Failed to look up remnant."));
    } finally {
      if (lookupRequestIdRef.current === requestId) {
        setLookupLoading(false);
      }
    }
  };

  function handleLookupSubmit(event) {
    event.preventDefault();
    return runLookupRef.current?.(lookupValue);
  }

  useEffect(() => {
    if (!sessionId) return undefined;
    const trimmedValue = lookupValue.trim();
    if (!trimmedValue) {
      lookupRequestIdRef.current += 1;
      setLookupLoading(false);
      setLookupResult(null);
      setError("");
      setMessage("");
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      runLookupRef.current?.(trimmedValue);
    }, 220);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [lookupValue, sessionId]);

  async function handleConfirm(outcome) {
    if (!currentRemnant?.id || !sessionId) return;
    setSavingOutcome(outcome);
    setError("");
    clearPendingMessageTimeout();
    setMessage("");
    try {
      const payload = await apiFetch("/api/remnant-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          remnant_id: currentRemnant.id,
          entered_number: lookupResult?.entered_number || lookupValue.trim(),
          location: locationValue,
          outcome,
        }),
      });
      triggerSuccessFeedback();
      showTransientMessage(payload?.message || (
        outcome === "seen"
          ? `#${displayRemnantId(currentRemnant)} confirmed`
          : outcome === "issue"
            ? `#${displayRemnantId(currentRemnant)} flagged for review`
            : `#${displayRemnantId(currentRemnant)} marked missing`
      ), outcome === "missing" ? "warn" : "success");
      setLocalCheckedCount((count) => count + 1);
      setLookupValue("");
      setLookupResult(null);
      pulseInputReadyState();
      inputRef.current?.focus();
      refreshHoldCount();
      refreshSessionSummary();
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, "Failed to save confirmation."));
    } finally {
      setSavingOutcome("");
    }
  }

  async function handleNotInDb() {
    if (!lookupValue.trim() || !sessionId) return;
    setSavingOutcome("not_in_db");
    setError("");
    clearPendingMessageTimeout();
    setMessage("");
    try {
      const payload = await apiFetch("/api/remnant-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          entered_number: lookupValue.trim(),
          outcome: "not_in_db",
        }),
      });
      setLookupResult(null);
      triggerSuccessFeedback();
      showTransientMessage(payload?.message || `#${lookupValue.trim()} → not in DB`, "warn");
      setLocalCheckedCount((count) => count + 1);
      setLookupValue("");
      refreshSessionSummary();
      pulseInputReadyState();
      inputRef.current?.focus();
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, "Failed to save missing-DB record."));
    } finally {
      setSavingOutcome("");
    }
  }

  function restoreLastLookup() {
    if (!lastResolvedLookup?.remnant) return;
    clearPendingMessageTimeout();
    setMessage("");
    setError("");
    setLookupValue(String(lastResolvedLookup.enteredNumber || displayRemnantId(lastResolvedLookup.remnant)));
    setLookupResult({
      entered_number: lastResolvedLookup.enteredNumber || displayRemnantId(lastResolvedLookup.remnant),
      remnant: lastResolvedLookup.remnant,
      existing_check: lastResolvedLookup.existingCheck,
    });
    inputRef.current?.focus();
  }

  return (
    <main className="font-inter min-h-screen bg-[color:var(--qc-bg-page)] text-[color:var(--qc-ink-1)]">
      <PrivateHeader profile={profile} />

      <div
        className="sticky top-0 z-30 bg-[color:var(--qc-bg-page)]"
        style={{ borderBottom: "1px solid var(--qc-line)" }}
      >
        <div className="mx-auto flex h-12 max-w-[760px] items-center justify-between px-4 sm:px-5">
          <div className="flex items-center gap-3">
            <Link
              href="/manage"
              className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--qc-ink-2)] transition-colors hover:text-[color:var(--qc-orange)]"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 16l-6-6 6-6" />
              </svg>
              Workspace
            </Link>
            <span aria-hidden="true" className="h-3.5 w-px bg-[color:var(--qc-line-strong)]" />
            <span className="text-[10.5px] font-medium uppercase tracking-[0.24em] text-[color:var(--qc-orange)]">
              Inventory Check
            </span>
          </div>
          <div className="flex items-center gap-2">
            {holdCount === 0 ? (
              <button
                type="button"
                onClick={() => setHoldConfirmOpen(true)}
                className="inline-flex h-7 items-center gap-1.5 bg-white px-3 text-[11px] font-medium text-[color:var(--qc-ink-1)] transition-colors hover:bg-[rgba(0,0,0,0.04)] hover:text-[color:var(--qc-orange)]"
                style={{
                  border: "1px solid var(--qc-line)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="7" width="10" height="8" rx="1" />
                  <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
                </svg>
                Start pass
              </button>
            ) : null}
            {localCheckedCount > 0 ? (
              <span
                className="inline-flex h-7 items-center gap-1.5 px-3 text-[11px] font-medium"
                style={{
                  backgroundColor: "var(--qc-status-available-bg)",
                  color: "var(--qc-status-available-fg)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2.5 8.5l3.5 3.5 7-7" />
                </svg>
                {localCheckedCount}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {holdConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            className="w-full max-w-sm bg-[color:var(--qc-bg-surface)] p-6"
            style={{
              border: "1px solid var(--qc-line)",
              borderRadius: "var(--qc-radius-sharp)",
              boxShadow: "var(--qc-shadow-toast)",
            }}
          >
            <p className="text-[10.5px] uppercase tracking-[0.24em] text-[color:var(--qc-ink-3)]">
              Inventory pass
            </p>
            <h2 className="mt-2 text-[20px] font-medium leading-tight tracking-[-0.015em] text-[color:var(--qc-ink-1)]">
              Start inventory double check?
            </h2>
            <p className="mt-3 text-[13px] leading-[1.6] text-[color:var(--qc-ink-2)]">
              Every non-sold remnant will be flagged for verification. As you scan each one and confirm it as <span className="font-semibold text-[color:var(--qc-ink-1)]">Seen</span>, the flag clears. Anything still flagged at the end of the pass didn&apos;t show up — that&apos;s your missing list. Customer holds and statuses are not affected.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setHoldConfirmOpen(false)}
                disabled={holdStarting}
                className="flex-1 bg-white py-3 text-[13px] font-medium text-[color:var(--qc-ink-1)] transition-colors hover:bg-[rgba(0,0,0,0.04)] disabled:opacity-60"
                style={{
                  border: "1px solid var(--qc-line)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startInventoryDoubleCheck}
                disabled={holdStarting}
                className="flex-1 py-3 text-[13px] font-medium text-white transition-colors hover:bg-[#232323] disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  backgroundColor: "var(--qc-ink-1)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                {holdStarting ? "Starting…" : "Yes, hold all"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-[760px] px-4 py-6 sm:px-5 sm:py-8">
        {holdCount !== null && holdCount > 0 ? (
          <div
            className="mb-5 flex items-center justify-between gap-3 px-4 py-3"
            style={{
              backgroundColor: "var(--qc-status-hold-bg)",
              border: "1px solid var(--qc-line)",
              borderLeft: "2px solid var(--qc-status-hold-dot)",
              borderRadius: "var(--qc-radius-sharp)",
            }}
          >
            <div>
              <p
                className="text-[10.5px] font-medium uppercase tracking-[0.20em]"
                style={{ color: "var(--qc-status-hold-fg)" }}
              >
                Inventory double check in progress
              </p>
              <p className="mt-1 text-[13px]" style={{ color: "var(--qc-status-hold-fg)" }}>
                <span className="font-semibold">{holdCount}</span> remnant{holdCount === 1 ? "" : "s"} still flagged — scan each to clear the flag
              </p>
            </div>
          </div>
        ) : holdCount === 0 && localCheckedCount > 0 ? (
          <div
            className="mb-5 flex items-center gap-2.5 px-4 py-3"
            style={{
              backgroundColor: "var(--qc-status-available-bg)",
              border: "1px solid var(--qc-line)",
              borderLeft: "2px solid var(--qc-status-available-dot)",
              borderRadius: "var(--qc-radius-sharp)",
            }}
          >
            <svg
              className="h-4 w-4 shrink-0"
              style={{ color: "var(--qc-status-available-fg)" }}
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 10.5l4 4 8-8" />
            </svg>
            <p
              className="text-[13px] font-medium"
              style={{ color: "var(--qc-status-available-fg)" }}
            >
              All flags cleared — double check complete!
            </p>
          </div>
        ) : null}

        <section
          className="bg-[color:var(--qc-bg-surface)]"
          style={{
            border: "1px solid var(--qc-line)",
            borderRadius: "var(--qc-radius-sharp)",
          }}
        >
          <div className="p-4 sm:p-5">
            <form onSubmit={handleLookupSubmit} className="flex items-end gap-3">
              <div className="shrink-0">
                <label className="mb-2 block text-[10px] font-medium uppercase tracking-[0.22em] text-[color:var(--qc-orange)]">
                  Zone
                </label>
                <input
                  ref={locationRef}
                  value={locationValue}
                  onChange={(event) => setLocationValue(event.target.value.toUpperCase().slice(0, 2))}
                  placeholder="A"
                  maxLength={2}
                  className={`h-14 w-16 text-center text-[22px] font-semibold uppercase outline-none transition-colors focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] sm:h-12 sm:w-14 sm:text-[18px] ${
                    locationValue
                      ? "bg-[color:var(--qc-orange-wash)] text-[color:var(--qc-orange)]"
                      : "bg-white text-[color:var(--qc-ink-3)]"
                  }`}
                  style={{
                    border: locationValue
                      ? "1px solid var(--qc-orange)"
                      : "1px solid var(--qc-line)",
                    borderRadius: "var(--qc-radius-sharp)",
                  }}
                />
              </div>

              <div className="min-w-0 flex-1">
                <label className="mb-2 block text-[10px] font-medium uppercase tracking-[0.22em] text-[color:var(--qc-orange)]">
                  Remnant #
                </label>
                <div className="relative">
                  <input
                    ref={inputRef}
                    value={lookupValue}
                    onChange={(event) => setLookupValue(normalizeLookupValue(event.target.value))}
                    placeholder="Enter number"
                    inputMode="numeric"
                    className={`h-14 w-full bg-white px-4 pr-11 text-[20px] font-semibold text-[color:var(--qc-ink-1)] outline-none transition-colors focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] sm:h-12 sm:text-[17px] ${
                      inputPulse ? "ring-4" : ""
                    }`}
                    style={{
                      border: inputPulse
                        ? "1px solid var(--qc-status-available-dot)"
                        : "1px solid var(--qc-line)",
                      borderRadius: "var(--qc-radius-sharp)",
                      ...(inputPulse
                        ? {
                            backgroundColor: "var(--qc-status-available-bg)",
                            "--tw-ring-color": "var(--qc-status-available-bg)",
                          }
                        : {}),
                    }}
                  />
                  {lookupLoading ? (
                    <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center">
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-[color:var(--qc-line)] border-t-[color:var(--qc-orange)]" />
                    </span>
                  ) : lookupValue.trim() ? (
                    <button
                      type="button"
                      onClick={() => { setLookupValue(""); setLookupResult(null); inputRef.current?.focus(); }}
                      className="absolute inset-y-0 right-3 inline-flex items-center text-[color:var(--qc-ink-3)] transition-colors hover:text-[color:var(--qc-ink-1)]"
                      aria-label="Clear"
                    >
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </div>

              <button
                type="submit"
                disabled={lookupLoading || !lookupValue.trim()}
                className="h-14 shrink-0 px-5 text-[13px] font-medium text-white transition-colors hover:bg-[color:var(--qc-orange)] disabled:cursor-not-allowed disabled:opacity-50 sm:h-12"
                style={{
                  backgroundColor: "var(--qc-ink-1)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                Check
              </button>
            </form>

            <div className="mt-3 flex items-center gap-2">
              {locationValue ? (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: "var(--qc-status-available-dot)" }}
                  />
                  <span className="text-[12px] text-[color:var(--qc-ink-2)]">
                    Logging all remnants to zone{" "}
                    <span className="font-medium text-[color:var(--qc-ink-1)]">{locationValue}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => { setLocationValue(""); locationRef.current?.focus(); }}
                    className="ml-1 text-[10.5px] uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)] transition-colors hover:text-[color:var(--qc-status-sold-dot)]"
                  >
                    clear
                  </button>
                </>
              ) : (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--qc-line-strong)]"
                  />
                  <span className="text-[12px] text-[color:var(--qc-ink-3)]">
                    No zone set — enter a letter above to log location
                  </span>
                </>
              )}
            </div>
          </div>

          {message ? (
            <div
              className="mx-4 mb-4 px-4 py-3 text-[13px] sm:mx-5"
              style={{
                backgroundColor:
                  messageTone === "warn"
                    ? "var(--qc-status-hold-bg)"
                    : "var(--qc-status-available-bg)",
                color:
                  messageTone === "warn"
                    ? "var(--qc-status-hold-fg)"
                    : "var(--qc-status-available-fg)",
                border: "1px solid var(--qc-line)",
                borderLeft: `2px solid ${
                  messageTone === "warn"
                    ? "var(--qc-status-hold-dot)"
                    : "var(--qc-status-available-dot)"
                }`,
                borderRadius: "var(--qc-radius-sharp)",
              }}
            >
              {message}
            </div>
          ) : null}
          {error ? (
            <div
              className="mx-4 mb-4 px-4 py-3 text-[13px] sm:mx-5"
              style={{
                backgroundColor: "var(--qc-status-sold-bg)",
                color: "var(--qc-status-sold-fg)",
                border: "1px solid var(--qc-line)",
                borderLeft: "2px solid var(--qc-status-sold-dot)",
                borderRadius: "var(--qc-radius-sharp)",
              }}
            >
              {error}
            </div>
          ) : null}

          {!currentRemnant && lookupValue.trim() && !lookupLoading ? (
            <div
              className="mx-4 mb-4 flex items-center justify-between gap-3 px-4 py-3 sm:mx-5"
              style={{
                backgroundColor: "var(--qc-status-hold-bg)",
                border: "1px solid var(--qc-line)",
                borderLeft: "2px solid var(--qc-status-hold-dot)",
                borderRadius: "var(--qc-radius-sharp)",
              }}
            >
              <p
                className="text-[13px]"
                style={{ color: "var(--qc-status-hold-fg)" }}
              >
                #{lookupValue.trim()} not found — exists physically?
              </p>
              <button
                type="button"
                onClick={handleNotInDb}
                disabled={savingOutcome === "not_in_db"}
                className="shrink-0 px-3 py-1.5 text-[12px] font-medium text-white transition-colors disabled:opacity-60"
                style={{
                  backgroundColor: "var(--qc-status-hold-dot)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                {savingOutcome === "not_in_db" ? "Saving…" : "Not in DB"}
              </button>
            </div>
          ) : null}

          {!currentRemnant && !lookupValue.trim() && lastResolvedLookup?.remnant ? (
            <div
              className="mx-4 mb-4 flex items-center justify-between gap-3 bg-[color:var(--qc-bg-page)] px-4 py-3 sm:mx-5"
              style={{
                border: "1px solid var(--qc-line)",
                borderRadius: "var(--qc-radius-sharp)",
              }}
            >
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                  Last scanned
                </p>
                <p className="mt-0.5 truncate text-[13px] font-medium text-[color:var(--qc-ink-1)]">
                  #{displayRemnantId(lastResolvedLookup.remnant)} · {lastResolvedLookup.remnant.name || "Unnamed"}
                </p>
              </div>
              <button
                type="button"
                onClick={restoreLastLookup}
                className="shrink-0 bg-white px-3 py-1.5 text-[12px] font-medium text-[color:var(--qc-ink-1)] transition-colors hover:bg-[color:var(--qc-bg-page)]"
                style={{
                  border: "1px solid var(--qc-line)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                Reopen
              </button>
            </div>
          ) : null}

          {!currentRemnant && !lookupValue.trim() && !lastResolvedLookup?.remnant ? (
            <div
              className="mx-4 mb-4 bg-[color:var(--qc-bg-page)] px-5 py-10 text-center sm:mx-5"
              style={{
                border: "1px dashed var(--qc-line-strong)",
                borderRadius: "var(--qc-radius-sharp)",
              }}
            >
              <p className="text-[13px] text-[color:var(--qc-ink-3)]">
                Enter a remnant number above to begin scanning
              </p>
              {holdCount === null || holdCount === 0 ? (
                <button
                  type="button"
                  onClick={() => setHoldConfirmOpen(true)}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium transition-colors"
                  style={{
                    backgroundColor: "var(--qc-status-hold-bg)",
                    color: "var(--qc-status-hold-fg)",
                    border: "1px solid var(--qc-line)",
                    borderRadius: "var(--qc-radius-sharp)",
                  }}
                >
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="7" width="10" height="8" rx="1" />
                    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
                  </svg>
                  Start inventory double check
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        {currentRemnant ? (
          <section
            className="mt-5 overflow-hidden bg-[color:var(--qc-bg-surface)]"
            style={{
              border: "1px solid var(--qc-line)",
              borderRadius: "var(--qc-radius-sharp)",
            }}
          >
            <div
              className="flex items-center justify-between bg-white px-5 py-3"
              style={{ borderBottom: "1px solid var(--qc-line)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--qc-orange)]">
                  #{displayRemnantId(currentRemnant)}
                </span>
                {currentRemnant.inventory_hold ? (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]"
                    style={{
                      backgroundColor: "var(--qc-status-hold-bg)",
                      color: "var(--qc-status-hold-fg)",
                      borderRadius: "var(--qc-radius-sharp)",
                    }}
                  >
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="7" width="10" height="8" rx="1" />
                      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
                    </svg>
                    Inventory hold
                  </span>
                ) : null}
                {existingCheck ? (
                  <span
                    className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]"
                    style={{
                      backgroundColor:
                        existingCheck.outcome === "seen"
                          ? "var(--qc-status-available-bg)"
                          : existingCheck.outcome === "issue"
                            ? "var(--qc-status-hold-bg)"
                            : "var(--qc-status-sold-bg)",
                      color:
                        existingCheck.outcome === "seen"
                          ? "var(--qc-status-available-fg)"
                          : existingCheck.outcome === "issue"
                            ? "var(--qc-status-hold-fg)"
                            : "var(--qc-status-sold-fg)",
                      borderRadius: "var(--qc-radius-sharp)",
                    }}
                  >
                    Already {existingCheck.outcome === "seen" ? "seen" : existingCheck.outcome === "issue" ? "flagged" : "missing"}
                  </span>
                ) : null}
              </div>
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]"
                style={{
                  backgroundColor: currentStatusStyle.backgroundColor,
                  color: currentStatusStyle.color,
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: currentStatusStyle.dot }}
                />
                {statusText(currentRemnant.status)}
              </span>
            </div>

            <div className="p-4 sm:p-5">
              <div className="flex gap-4">
                {currentRemnant.image ? (
                  <img
                    src={currentRemnant.image}
                    alt={currentRemnant.name}
                    className="h-20 w-20 shrink-0 bg-white object-contain sm:h-24 sm:w-24"
                    style={{
                      border: "1px solid var(--qc-line)",
                      borderRadius: "var(--qc-radius-sharp)",
                    }}
                  />
                ) : null}
                <div className="min-w-0">
                  <h2 className="text-[22px] font-medium leading-tight tracking-[-0.015em] text-[color:var(--qc-ink-1)] sm:text-[26px]">
                    {currentRemnant.name || "Unnamed"}
                  </h2>
                  <p className="mt-1 text-[12.5px] text-[color:var(--qc-ink-2)]">
                    {[
                      currentRemnant.company_name,
                      currentRemnant.material_name,
                      currentRemnant.thickness_name,
                      sizeText(currentRemnant),
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>

              <div
                className="mt-4 flex flex-wrap items-center gap-2 bg-[color:var(--qc-bg-page)] px-4 py-3"
                style={{
                  border: "1px solid var(--qc-line)",
                  borderRadius: "var(--qc-radius-sharp)",
                }}
              >
                <svg
                  className="h-4 w-4 shrink-0 text-[color:var(--qc-ink-3)]"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 1.5C5.515 1.5 3.5 3.515 3.5 6c0 3.75 4.5 8.5 4.5 8.5s4.5-4.75 4.5-8.5c0-2.485-2.015-4.5-4.5-4.5z" />
                  <circle cx="8" cy="6" r="1.5" />
                </svg>
                <span className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
                  DB location
                </span>
                <span
                  className={`text-[12px] font-medium ${
                    currentRemnant.location ? "text-[color:var(--qc-ink-1)]" : "text-[color:var(--qc-ink-3)]"
                  }`}
                >
                  {currentRemnant.location || "N/A"}
                </span>
                {locationValue && locationValue !== currentRemnant.location ? (
                  <>
                    <svg
                      className="h-3.5 w-3.5 shrink-0 text-[color:var(--qc-ink-3)]"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 8h8M9 5l3 3-3 3" />
                    </svg>
                    <span className="text-[12px] font-medium text-[color:var(--qc-orange)]">
                      will update to {locationValue}
                    </span>
                  </>
                ) : locationValue && locationValue === currentRemnant.location ? (
                  <>
                    <svg
                      className="h-3.5 w-3.5 shrink-0 text-[color:var(--qc-ink-3)]"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 8h8M9 5l3 3-3 3" />
                    </svg>
                    <span
                      className="text-[12px] font-medium"
                      style={{ color: "var(--qc-status-available-fg)" }}
                    >
                      matches zone {locationValue}
                    </span>
                  </>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={() => handleConfirm("seen")}
                  className="inline-flex h-14 flex-col items-center justify-center gap-0.5 text-[13px] font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--qc-status-available-fg)",
                    borderRadius: "var(--qc-radius-sharp)",
                  }}
                >
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 10.5l4 4 8-8" />
                  </svg>
                  {savingOutcome === "seen" ? "Saving…" : "Seen"}
                </button>
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={() => handleConfirm("issue")}
                  className="inline-flex h-14 flex-col items-center justify-center gap-0.5 text-[13px] font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--qc-status-hold-dot)",
                    borderRadius: "var(--qc-radius-sharp)",
                  }}
                >
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M10 6v5M10 14h.01" />
                    <path d="M3 17L10 3l7 14H3z" />
                  </svg>
                  {savingOutcome === "issue" ? "Saving…" : "Needs review"}
                </button>
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={() => handleConfirm("missing")}
                  className="inline-flex h-14 flex-col items-center justify-center gap-0.5 text-[13px] font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--qc-status-sold-dot)",
                    borderRadius: "var(--qc-radius-sharp)",
                  }}
                >
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 5l10 10M15 5L5 15" />
                  </svg>
                  {savingOutcome === "missing" ? "Saving…" : "Missing"}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {sessionSummary?.summary &&
        (sessionSummary.summary.checked_count > 0 ||
          sessionSummary.summary.not_in_db_count > 0) ? (
          <section
            className="mt-5 overflow-hidden bg-[color:var(--qc-bg-surface)]"
            style={{
              border: "1px solid var(--qc-line)",
              borderRadius: "var(--qc-radius-sharp)",
            }}
          >
            <div
              className="flex items-center justify-between gap-4 bg-white px-5 py-3"
              style={{ borderBottom: "1px solid var(--qc-line)" }}
            >
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                  Pass summary
                </p>
                <p className="mt-1 text-[13px] text-[color:var(--qc-ink-2)]">
                  <span className="font-semibold text-[color:var(--qc-ink-1)]">
                    {sessionSummary.summary.checked_count + sessionSummary.summary.not_in_db_count}
                  </span>
                  {" "}entr{(sessionSummary.summary.checked_count + sessionSummary.summary.not_in_db_count) === 1 ? "y" : "ies"} this pass
                </p>
              </div>
            </div>

            <div
              className="grid grid-cols-2 gap-px bg-[color:var(--qc-line)] sm:grid-cols-4"
              style={{ borderBottom: "1px solid var(--qc-line)" }}
            >
              {[
                {
                  label: "Seen",
                  value: sessionSummary.summary.seen_count,
                  bg: "var(--qc-status-available-bg)",
                  fg: "var(--qc-status-available-fg)",
                  dot: "var(--qc-status-available-dot)",
                },
                {
                  label: "Missing",
                  value: sessionSummary.summary.missing_count,
                  bg: "var(--qc-status-sold-bg)",
                  fg: "var(--qc-status-sold-fg)",
                  dot: "var(--qc-status-sold-dot)",
                },
                {
                  label: "Review",
                  value: sessionSummary.summary.issue_count,
                  bg: "var(--qc-status-hold-bg)",
                  fg: "var(--qc-status-hold-fg)",
                  dot: "var(--qc-status-hold-dot)",
                },
                {
                  label: "Not in DB",
                  value: sessionSummary.summary.not_in_db_count,
                  bg: "var(--qc-status-pending-bg)",
                  fg: "var(--qc-status-pending-fg)",
                  dot: "var(--qc-status-pending-dot)",
                },
              ].map((tile) => (
                <div
                  key={tile.label}
                  className="bg-[color:var(--qc-bg-surface)] px-4 py-4"
                >
                  <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
                    <span
                      aria-hidden="true"
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: tile.dot }}
                    />
                    {tile.label}
                  </p>
                  <p
                    className="mt-1 text-[24px] font-medium leading-none tracking-[-0.01em]"
                    style={{ color: tile.value > 0 ? tile.fg : "var(--qc-ink-3)" }}
                  >
                    {tile.value}
                  </p>
                </div>
              ))}
            </div>

            {sessionSummary.not_in_db_entries?.length ? (
              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10.5px] font-medium uppercase tracking-[0.20em] text-[color:var(--qc-ink-3)]">
                    Not in DB
                  </p>
                  <span className="text-[10.5px] uppercase tracking-[0.18em] text-[color:var(--qc-ink-3)]">
                    Add manually
                  </span>
                </div>
                <ul className="mt-3 divide-y" style={{ borderColor: "var(--qc-line)" }}>
                  {sessionSummary.not_in_db_entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                      style={{ borderTop: "1px solid var(--qc-line)" }}
                    >
                      <span
                        className="text-[14px] font-medium text-[color:var(--qc-ink-1)]"
                        style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
                      >
                        #{entry.entered_number || "—"}
                      </span>
                      <span
                        className="text-[11px] text-[color:var(--qc-ink-3)]"
                        style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
                      >
                        {formatScanTime(entry.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
