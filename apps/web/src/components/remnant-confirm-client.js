"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
  if (normalized === "hold") return "Hold";
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
    .replace(" in inventory and marked it available", " → available")
    .replace(" in inventory and kept it marked sold", " → kept sold")
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

export default function RemnantConfirmClient() {
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

  const currentRemnant = lookupResult?.remnant || null;
  const existingCheck = lookupResult?.existing_check || null;
  const canConfirm = Boolean(currentRemnant?.id) && !savingOutcome;
  const currentStatus = String(currentRemnant?.status || "").trim().toLowerCase();

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
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8f1ea_0%,#f0e9e1_100%)] text-[var(--brand-ink)]">

      {/* ── Top bar ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-[var(--brand-line)] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[760px] items-center justify-between px-4">
          <Link
            href="/manage"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:text-[var(--brand-orange)]"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 16l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Workspace
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Inventory Check</span>
            {localCheckedCount > 0 ? (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-emerald-100 px-3 text-xs font-bold text-emerald-800">
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M2.5 8.5l3.5 3.5 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {localCheckedCount}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[760px] px-3 py-5 sm:px-5 sm:py-6">

        {/* ── Scan section ─────────────────────────────────────────── */}
        <section className="rounded-[28px] border border-[var(--brand-line)] bg-white shadow-[0_8px_32px_rgba(25,27,28,0.07)] sm:rounded-[32px]">

          {/* Zone + number inputs */}
          <div className="p-4 sm:p-5">
            <form onSubmit={handleLookupSubmit} className="flex items-end gap-3">
              {/* Zone tile */}
              <div className="shrink-0">
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--brand-orange)]">
                  Zone
                </label>
                <input
                  ref={locationRef}
                  value={locationValue}
                  onChange={(event) => setLocationValue(event.target.value.toUpperCase().slice(0, 2))}
                  placeholder="A"
                  maxLength={2}
                  className={`h-14 w-16 rounded-2xl border text-center text-2xl font-black uppercase outline-none transition-colors focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] sm:h-12 sm:w-14 sm:text-xl ${
                    locationValue
                      ? "border-[var(--brand-orange)] bg-[rgba(247,134,57,0.06)] text-[var(--brand-orange)] focus:border-[var(--brand-orange)]"
                      : "border-[var(--brand-line)] bg-[var(--brand-shell)] text-[rgba(25,27,28,0.38)] focus:border-[var(--brand-orange)]"
                  }`}
                />
              </div>

              {/* Remnant # */}
              <div className="min-w-0 flex-1">
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--brand-orange)]">
                  Remnant #
                </label>
                <div className="relative">
                  <input
                    ref={inputRef}
                    value={lookupValue}
                    onChange={(event) => setLookupValue(normalizeLookupValue(event.target.value))}
                    placeholder="Enter number"
                    inputMode="numeric"
                    className={`h-14 w-full rounded-2xl border bg-white px-4 pr-11 text-[1.25rem] font-bold text-[var(--brand-ink)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] sm:h-12 sm:text-lg ${
                      inputPulse
                        ? "border-emerald-400 bg-emerald-50 ring-4 ring-emerald-100"
                        : "border-[var(--brand-line)]"
                    }`}
                  />
                  {lookupLoading ? (
                    <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center">
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-[rgba(25,27,28,0.12)] border-t-[var(--brand-orange)]" />
                    </span>
                  ) : lookupValue.trim() ? (
                    <button
                      type="button"
                      onClick={() => { setLookupValue(""); setLookupResult(null); inputRef.current?.focus(); }}
                      className="absolute inset-y-0 right-3 inline-flex items-center text-[rgba(25,27,28,0.32)] transition-colors hover:text-[var(--brand-ink)]"
                      aria-label="Clear"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </div>

              <button
                type="submit"
                disabled={lookupLoading || !lookupValue.trim()}
                className="h-14 shrink-0 rounded-2xl bg-[var(--brand-ink)] px-5 text-sm font-bold text-white transition-colors hover:bg-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-50 sm:h-12"
              >
                Check
              </button>
            </form>

            {/* Zone status line */}
            <div className="mt-3 flex items-center gap-2">
              {locationValue ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-semibold text-[rgba(25,27,28,0.68)]">
                    Logging all remnants to zone <span className="text-[var(--brand-ink)]">{locationValue}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => { setLocationValue(""); locationRef.current?.focus(); }}
                    className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-[rgba(25,27,28,0.38)] transition-colors hover:text-rose-500"
                  >
                    clear
                  </button>
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-[rgba(25,27,28,0.18)]" />
                  <span className="text-xs text-[rgba(25,27,28,0.45)]">No zone set — enter a letter above to log location</span>
                </>
              )}
            </div>
          </div>

          {/* Toast messages */}
          {message ? (
            <div className={`mx-4 mb-4 rounded-2xl px-4 py-3 text-sm font-semibold sm:mx-5 ${
              messageTone === "warn"
                ? "border border-amber-200 bg-amber-50 text-amber-900"
                : "border border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}>
              {message}
            </div>
          ) : null}
          {error ? (
            <div className="mx-4 mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900 sm:mx-5">
              {error}
            </div>
          ) : null}

          {/* Not-in-DB banner */}
          {!currentRemnant && lookupValue.trim() && !lookupLoading ? (
            <div className="mx-4 mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 sm:mx-5">
              <p className="text-sm font-medium text-amber-950">
                #{lookupValue.trim()} not found — exists physically?
              </p>
              <button
                type="button"
                onClick={handleNotInDb}
                disabled={savingOutcome === "not_in_db"}
                className="shrink-0 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-400 disabled:opacity-60"
              >
                {savingOutcome === "not_in_db" ? "Saving…" : "Not in DB"}
              </button>
            </div>
          ) : null}

          {/* Last remnant restore */}
          {!currentRemnant && !lookupValue.trim() && lastResolvedLookup?.remnant ? (
            <div className="mx-4 mb-4 flex items-center justify-between gap-3 rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 py-3 sm:mx-5">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[rgba(25,27,28,0.45)]">Last scanned</p>
                <p className="truncate text-sm font-semibold text-[var(--brand-ink)]">
                  #{displayRemnantId(lastResolvedLookup.remnant)} · {lastResolvedLookup.remnant.name || "Unnamed"}
                </p>
              </div>
              <button
                type="button"
                onClick={restoreLastLookup}
                className="shrink-0 rounded-xl border border-[var(--brand-line)] bg-white px-3 py-1.5 text-xs font-bold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-shell)]"
              >
                Reopen
              </button>
            </div>
          ) : null}

          {/* Empty state */}
          {!currentRemnant && !lookupValue.trim() && !lastResolvedLookup?.remnant ? (
            <div className="mx-4 mb-4 rounded-2xl border border-dashed border-[rgba(25,27,28,0.14)] bg-[var(--brand-shell)] px-5 py-8 text-center sm:mx-5">
              <p className="text-sm font-medium text-[rgba(25,27,28,0.45)]">Enter a remnant number above to begin scanning</p>
            </div>
          ) : null}
        </section>

        {/* ── Remnant result card ───────────────────────────────────── */}
        {currentRemnant ? (
          <section className="mt-4 overflow-hidden rounded-[28px] border border-[var(--brand-line)] bg-white shadow-[0_8px_32px_rgba(25,27,28,0.09)] sm:rounded-[32px]">

            {/* Card header bar */}
            <div className="flex items-center justify-between border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,var(--brand-white)_100%)] px-5 py-3">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                  #{displayRemnantId(currentRemnant)}
                </span>
                {existingCheck ? (
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    existingCheck.outcome === "seen"
                      ? "bg-emerald-100 text-emerald-800"
                      : existingCheck.outcome === "issue"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-rose-100 text-rose-800"
                  }`}>
                    Already {existingCheck.outcome === "seen" ? "seen" : existingCheck.outcome === "issue" ? "flagged" : "missing"}
                  </span>
                ) : null}
              </div>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                currentStatus === "sold"
                  ? "bg-stone-900 text-white"
                  : currentStatus === "hold"
                    ? "bg-amber-100 text-amber-900"
                    : "bg-emerald-100 text-emerald-900"
              }`}>
                {statusText(currentRemnant.status)}
              </span>
            </div>

            <div className="p-4 sm:p-5">
              {/* Name + meta */}
              <div className="flex gap-4">
                {currentRemnant.image ? (
                  <img
                    src={currentRemnant.image}
                    alt={currentRemnant.name}
                    className="h-20 w-20 shrink-0 rounded-2xl border border-[var(--brand-line)] bg-white object-contain sm:h-24 sm:w-24"
                  />
                ) : null}
                <div className="min-w-0">
                  <h2 className="font-display text-[1.5rem] font-semibold leading-tight text-[var(--brand-ink)] sm:text-[1.85rem]">
                    {currentRemnant.name || "Unnamed"}
                  </h2>
                  <p className="mt-1 text-sm text-[rgba(25,27,28,0.60)]">
                    {[
                      currentRemnant.company_name,
                      currentRemnant.material_name,
                      currentRemnant.thickness_name,
                      sizeText(currentRemnant),
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>

              {/* Location row */}
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 py-3">
                <svg className="h-4 w-4 shrink-0 text-[rgba(25,27,28,0.38)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M8 1.5C5.515 1.5 3.5 3.515 3.5 6c0 3.75 4.5 8.5 4.5 8.5s4.5-4.75 4.5-8.5c0-2.485-2.015-4.5-4.5-4.5z" />
                  <circle cx="8" cy="6" r="1.5" />
                </svg>
                <span className="text-xs font-semibold text-[rgba(25,27,28,0.55)]">DB location:</span>
                <span className={`text-xs font-bold ${currentRemnant.location ? "text-sky-700" : "text-[rgba(25,27,28,0.35)]"}`}>
                  {currentRemnant.location || "N/A"}
                </span>
                {locationValue && locationValue !== currentRemnant.location ? (
                  <>
                    <svg className="h-3.5 w-3.5 shrink-0 text-[rgba(25,27,28,0.28)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M4 8h8M9 5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="text-xs font-bold text-[var(--brand-orange)]">will update to {locationValue}</span>
                  </>
                ) : locationValue && locationValue === currentRemnant.location ? (
                  <>
                    <svg className="h-3.5 w-3.5 shrink-0 text-[rgba(25,27,28,0.28)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M4 8h8M9 5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="text-xs font-bold text-emerald-600">matches zone {locationValue} ✓</span>
                  </>
                ) : null}
              </div>

              {/* Desktop action buttons */}
              <div className="mt-4 hidden grid-cols-3 gap-3 sm:grid">
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={() => handleConfirm("seen")}
                  className="inline-flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-emerald-600 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M4 10.5l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {savingOutcome === "seen" ? "Saving…" : "Seen"}
                </button>
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={() => handleConfirm("issue")}
                  className="inline-flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-amber-500 text-sm font-bold text-white transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M10 6v5M10 14h.01" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 17L10 3l7 14H3z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {savingOutcome === "issue" ? "Saving…" : "Needs Review"}
                </button>
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={() => handleConfirm("missing")}
                  className="inline-flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-rose-600 text-sm font-bold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                  </svg>
                  {savingOutcome === "missing" ? "Saving…" : "Missing"}
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {/* ── Mobile bottom action bar ──────────────────────────────── */}
      {currentRemnant ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--brand-line)] bg-white/96 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2.5 shadow-[0_-12px_32px_rgba(25,27,28,0.10)] backdrop-blur sm:hidden">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => handleConfirm("seen")}
              className="inline-flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-emerald-600 text-xs font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M4 10.5l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {savingOutcome === "seen" ? "Saving…" : "Seen"}
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => handleConfirm("issue")}
              className="inline-flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-amber-500 text-xs font-bold text-white transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M10 6v5M10 14h.01" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 17L10 3l7 14H3z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {savingOutcome === "issue" ? "Saving…" : "Review"}
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => handleConfirm("missing")}
              className="inline-flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-rose-600 text-xs font-bold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
              {savingOutcome === "missing" ? "Saving…" : "Missing"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
