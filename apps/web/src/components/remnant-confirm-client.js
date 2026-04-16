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
    return `${remnant.width}" x ${remnant.height}" + ${remnant.l_width}" x ${remnant.l_height}"`;
  }
  return remnant.width && remnant.height ? `${remnant.width}" x ${remnant.height}"` : "";
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
    .replace(" in inventory and marked it available", " set available")
    .replace(" in inventory and kept it marked sold", " confirmed, kept sold")
    .replace(" as physically present but missing from the database", " marked not in DB")
    .replace(" as not seen in inventory", " marked missing")
    .replace(" for review", " sent to review");
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
  const [error, setError] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [localCheckedCount, setLocalCheckedCount] = useState(0);
  const [inputPulse, setInputPulse] = useState(false);
  const [lastResolvedLookup, setLastResolvedLookup] = useState(null);
  const inputRef = useRef(null);
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

  function showTransientMessage(text) {
    const nextMessage = compactSuccessMessage(text);
    clearPendingMessageTimeout();
    setMessage(nextMessage);
    if (nextMessage) {
      messageTimeoutRef.current = window.setTimeout(() => {
        setMessage("");
        messageTimeoutRef.current = null;
      }, 1800);
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
  const seenHint = currentStatus === "sold"
    ? "Seen will keep this remnant sold."
    : currentStatus === "hold"
      ? "Seen will move this remnant back to available."
      : "Seen will refresh this remnant as available.";

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
        setLocationValue(String(payload.remnant.location || ""));
        setLastResolvedLookup({
          remnant: payload.remnant,
          existingCheck: payload.existing_check || null,
          enteredNumber: payload.entered_number || nextValue,
        });
      } else {
        setLocationValue("");
      }
      if (!payload?.remnant) {
        setMessage(`No remnant found for #${nextValue}. If it exists physically, mark it as not in the database.`);
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
          ? `Confirmed remnant #${displayRemnantId(currentRemnant)}.`
          : outcome === "issue"
            ? `Flagged remnant #${displayRemnantId(currentRemnant)} for review.`
            : `Marked remnant #${displayRemnantId(currentRemnant)} as not seen.`
      ));
      setLocalCheckedCount((count) => count + 1);
      setLookupValue("");
      setLocationValue("");
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
      showTransientMessage(payload?.message || `Marked remnant #${lookupValue.trim()} as physically present but missing from the DB.`);
      setLocalCheckedCount((count) => count + 1);
      setLookupValue("");
      setLocationValue("");
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
    setLocationValue(String(lastResolvedLookup.remnant.location || ""));
    setLookupResult({
      entered_number: lastResolvedLookup.enteredNumber || displayRemnantId(lastResolvedLookup.remnant),
      remnant: lastResolvedLookup.remnant,
      existing_check: lastResolvedLookup.existingCheck,
    });
    inputRef.current?.focus();
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8f1ea_0%,#f4ede6_26%,#efe7de_100%)] px-3 py-4 text-[var(--brand-ink)] sm:px-5 sm:py-6 lg:px-6 lg:py-8">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 sm:gap-5">
        <section className="rounded-[28px] border border-[var(--brand-line)] bg-white/94 p-4 shadow-[0_24px_70px_rgba(25,27,28,0.08)] sm:rounded-[34px] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Inventory Check</p>
              <h1 className="mt-2 font-display text-[1.85rem] font-semibold leading-tight text-[var(--brand-ink)] sm:text-[2.5rem]">Fast remnant confirmation</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[rgba(25,27,28,0.72)]">
                Enter a number, confirm what you see, and move straight to the next remnant.
              </p>
              <div className="mt-3 inline-flex items-center rounded-full bg-[var(--brand-shell)] px-3 py-1 text-xs font-semibold text-[var(--brand-ink)]">
                This device checked: {localCheckedCount}
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:gap-3">
              <Link
                href="/manage"
                className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-shell)] sm:w-auto"
              >
                Back to Workspace
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-[var(--brand-line)] bg-white/96 p-4 shadow-[0_24px_70px_rgba(25,27,28,0.08)] sm:rounded-[30px] sm:p-5">
          <form onSubmit={handleLookupSubmit} className="flex flex-col gap-3 sm:flex-row">
            <div className="min-w-0 flex-1">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                Remnant Number
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  value={lookupValue}
                  onChange={(event) => setLookupValue(normalizeLookupValue(event.target.value))}
                  placeholder="Enter remnant #"
                  inputMode="numeric"
                  className={`h-14 w-full rounded-2xl border bg-white px-4 pr-11 text-[1.2rem] font-semibold text-[var(--brand-ink)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] sm:h-12 sm:text-lg ${
                    inputPulse
                      ? "border-emerald-400 ring-4 ring-emerald-100"
                      : "border-[var(--brand-line)]"
                  }`}
                />
                {lookupLoading ? (
                  <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center justify-center">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-[rgba(25,27,28,0.16)] border-t-[var(--brand-orange)]" />
                  </span>
                ) : null}
              </div>
            </div>
            <button
              type="submit"
              disabled={lookupLoading || !lookupValue.trim()}
              className="inline-flex h-14 items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-5 text-base font-semibold text-white transition-colors hover:bg-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:self-end sm:text-sm"
            >
              {lookupLoading ? "Looking up…" : "Check"}
            </button>
          </form>

          {message ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
              {message}
            </div>
          ) : null}
          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">
              {error}
            </div>
          ) : null}
          {!currentRemnant && !lookupValue.trim() && lastResolvedLookup?.remnant ? (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-[22px] border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-orange)]">Last Remnant</p>
                <p className="truncate text-sm font-semibold text-[var(--brand-ink)]">
                  #{displayRemnantId(lastResolvedLookup.remnant)} · {lastResolvedLookup.remnant.name || "Unnamed"}
                </p>
              </div>
              <button
                type="button"
                onClick={restoreLastLookup}
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-white)]"
              >
                Reopen
              </button>
            </div>
          ) : null}
          {!currentRemnant && lookupValue.trim() ? (
            <div className="mt-4 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-sm font-medium text-amber-950">
                If remnant #{lookupValue.trim()} exists physically but is not in the system, save it below.
              </p>
              <button
                type="button"
                onClick={handleNotInDb}
                disabled={savingOutcome === "not_in_db"}
                className="mt-3 inline-flex h-12 items-center justify-center rounded-2xl bg-amber-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingOutcome === "not_in_db" ? "Saving…" : "Exists, Not In DB"}
              </button>
            </div>
          ) : null}

          <div className="mt-5">
            {!currentRemnant ? (
              <div className="rounded-[24px] border border-dashed border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,var(--brand-white)_100%)] px-5 py-8 text-center text-sm leading-6 text-[rgba(25,27,28,0.62)] sm:rounded-[26px] sm:px-6 sm:py-10">
                Enter a remnant number to begin.
              </div>
            ) : (
              <div className="overflow-hidden rounded-[24px] border border-[var(--brand-line)] bg-white shadow-[0_24px_70px_rgba(25,27,28,0.08)] sm:rounded-[28px]">
                <div className="grid gap-0 md:grid-cols-[180px_minmax(0,1fr)]">
                  <div className="hidden border-r border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,var(--brand-white)_100%)] p-4 md:block">
                    {currentRemnant.image ? (
                      <img
                        src={currentRemnant.image}
                        alt={currentRemnant.name}
                        className="h-40 w-full rounded-[20px] border border-[var(--brand-line)] bg-white object-contain"
                      />
                    ) : (
                      <div className="flex h-40 items-center justify-center rounded-[20px] border border-[var(--brand-line)] bg-white text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-orange)]">
                        No image
                      </div>
                    )}
                  </div>
                  <div className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                          Remnant #{displayRemnantId(currentRemnant)}
                        </p>
                        <h2 className="mt-2 font-display text-[1.55rem] font-semibold leading-tight text-[var(--brand-ink)] sm:text-[2rem]">
                          {currentRemnant.name || "Unnamed"}
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-[rgba(25,27,28,0.68)]">
                          {[
                            currentRemnant.company_name,
                            currentRemnant.material_name,
                            currentRemnant.thickness_name,
                            sizeText(currentRemnant),
                            statusText(currentRemnant.status),
                          ].filter(Boolean).join(" · ")}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                            currentStatus === "sold"
                              ? "bg-stone-900 text-white"
                              : currentStatus === "hold"
                                ? "bg-amber-100 text-amber-950"
                                : "bg-emerald-100 text-emerald-900"
                          }`}>
                            Current status: {statusText(currentRemnant.status)}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-[var(--brand-shell)] px-3 py-1 text-xs font-medium text-[rgba(25,27,28,0.72)]">
                            {seenHint}
                          </span>
                        </div>
                        <div className="mt-4">
                          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-orange)]">
                            Location
                          </label>
                          <input
                            value={locationValue}
                            onChange={(event) => setLocationValue(event.target.value)}
                            placeholder="Shelf, rack, yard, or shop area"
                            className="h-11 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm text-[var(--brand-ink)] outline-none transition-colors focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                          />
                        </div>
                      </div>
                      {existingCheck ? (
                        <div className={`hidden rounded-full px-3 py-2 text-xs font-semibold sm:inline-flex ${
                          existingCheck.outcome === "seen"
                            ? "bg-emerald-100 text-emerald-900"
                            : existingCheck.outcome === "issue"
                              ? "bg-amber-100 text-amber-950"
                              : "bg-rose-100 text-rose-900"
                        }`}>
                          Already marked {existingCheck.outcome === "seen" ? "seen" : existingCheck.outcome === "issue" ? "needs review" : "missing"}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-6 hidden gap-3 sm:grid">
                      <button
                        type="button"
                        disabled={!canConfirm}
                        onClick={() => handleConfirm("seen")}
                        className="inline-flex h-12 items-center justify-center rounded-2xl bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingOutcome === "seen" ? "Saving…" : "Seen"}
                      </button>
                      <button
                        type="button"
                        disabled={!canConfirm}
                        onClick={() => handleConfirm("issue")}
                        className="inline-flex h-12 items-center justify-center rounded-2xl bg-amber-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingOutcome === "issue" ? "Saving…" : "Needs Review"}
                      </button>
                      <button
                        type="button"
                        disabled={!canConfirm}
                        onClick={() => handleConfirm("missing")}
                        className="inline-flex h-12 items-center justify-center rounded-2xl bg-rose-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingOutcome === "missing" ? "Saving…" : "Missing"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      {currentRemnant ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--brand-line)] bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-18px_40px_rgba(25,27,28,0.10)] backdrop-blur sm:hidden">
          <div className="mx-auto grid max-w-[760px] grid-cols-3 gap-2">
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => handleConfirm("seen")}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingOutcome === "seen" ? "Saving…" : "Seen"}
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => handleConfirm("issue")}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-amber-500 px-3 text-sm font-semibold text-white transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingOutcome === "issue" ? "Saving…" : "Review"}
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => handleConfirm("missing")}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-rose-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingOutcome === "missing" ? "Saving…" : "Missing"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
