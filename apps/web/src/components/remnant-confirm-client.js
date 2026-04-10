"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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

function normalizeSessionInput(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "")
    .slice(0, 120);
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

function outcomeLabel(value) {
  if (value === "seen") return "Seen";
  if (value === "missing") return "Missing";
  if (value === "issue") return "Needs Review";
  if (value === "not_in_db") return "Not In DB";
  return "Unknown";
}

function StatCard({ label, value, tone = "default" }) {
  const toneClass = tone === "success"
    ? "bg-emerald-50 text-emerald-900 border-emerald-200"
    : tone === "danger"
      ? "bg-rose-50 text-rose-900 border-rose-200"
      : tone === "warning"
        ? "bg-amber-50 text-amber-950 border-amber-200"
        : tone === "info"
          ? "bg-sky-50 text-sky-950 border-sky-200"
      : tone === "muted"
        ? "bg-stone-50 text-stone-900 border-stone-200"
        : "bg-white text-[var(--brand-ink)] border-[var(--brand-line)]";
  return (
    <div className={`rounded-[22px] border px-4 py-4 shadow-sm ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold">{value}</p>
    </div>
  );
}

export default function RemnantConfirmClient() {
  const [sessionId, setSessionId] = useState("");
  const [sessionInput, setSessionInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [lookupValue, setLookupValue] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [savingOutcome, setSavingOutcome] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [sessionData, setSessionData] = useState({
    summary: {
      total_count: 0,
      checked_count: 0,
      seen_count: 0,
      missing_count: 0,
      issue_count: 0,
      not_in_db_count: 0,
      unchecked_count: 0,
    },
    unseen_preview: [],
    recent: [],
  });
  const inputRef = useRef(null);

  function persistSession(nextSessionId) {
    window.localStorage.setItem(STORAGE_KEY, nextSessionId);
    setSessionId(nextSessionId);
    setSessionInput(nextSessionId);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("session", nextSessionId);
    window.history.replaceState({}, "", nextUrl);
  }

  async function refreshSession(nextSessionId) {
    if (!nextSessionId) return;
    const payload = await apiFetch(`/api/remnant-checks?session_id=${encodeURIComponent(nextSessionId)}`, {
      cache: "no-store",
    });
    setSessionData(payload);
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = normalizeSessionInput(url.searchParams.get("session"));
    const stored = normalizeSessionInput(window.localStorage.getItem(STORAGE_KEY));
    const nextSessionId = fromUrl || stored || createSessionId();
    persistSession(nextSessionId);
    refreshSession(nextSessionId)
      .catch((nextError) => setError(nextError.message || "Failed to load current pass."))
      .finally(() => {
        setLoading(false);
        inputRef.current?.focus();
      });
  }, []);

  const currentRemnant = lookupResult?.remnant || null;
  const existingCheck = lookupResult?.existing_check || null;
  const recentRows = Array.isArray(sessionData.recent) ? sessionData.recent : [];
  const unseenRows = Array.isArray(sessionData.unseen_preview) ? sessionData.unseen_preview : [];
  const summary = sessionData.summary || {};
  const canConfirm = Boolean(currentRemnant?.id) && !savingOutcome;
  const currentNumberLabel = useMemo(() => {
    const entered = lookupResult?.entered_number;
    return entered ? `#${entered}` : "";
  }, [lookupResult?.entered_number]);

  async function handleLookupSubmit(event) {
    event.preventDefault();
    if (!lookupValue.trim() || !sessionId) return;
    setLookupLoading(true);
    setError("");
    setMessage("");
    try {
      const payload = await apiFetch(
        `/api/remnant-checks?session_id=${encodeURIComponent(sessionId)}&number=${encodeURIComponent(lookupValue.trim())}`,
        { cache: "no-store" },
      );
      setLookupResult(payload);
      if (!payload?.remnant) {
        setMessage(`No remnant found for ${currentNumberLabel || `#${lookupValue.trim()}`}. If it exists physically, mark it as not in DB below.`);
      }
    } catch (nextError) {
      setError(nextError.message || "Failed to look up remnant.");
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleConfirm(outcome) {
    if (!currentRemnant?.id || !sessionId) return;
    setSavingOutcome(outcome);
    setError("");
    setMessage("");
    try {
      await apiFetch("/api/remnant-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          remnant_id: currentRemnant.id,
          entered_number: lookupResult?.entered_number || lookupValue.trim(),
          outcome,
        }),
      });
      await refreshSession(sessionId);
      setLookupResult((current) => current ? {
        ...current,
        existing_check: {
          outcome,
          created_at: new Date().toISOString(),
        },
      } : current);
      setMessage(
        outcome === "seen"
          ? `Confirmed remnant #${displayRemnantId(currentRemnant)}.`
          : outcome === "issue"
            ? `Flagged remnant #${displayRemnantId(currentRemnant)} for review.`
            : `Marked remnant #${displayRemnantId(currentRemnant)} as not seen.`,
      );
      setLookupValue("");
      inputRef.current?.focus();
    } catch (nextError) {
      setError(nextError.message || "Failed to save confirmation.");
    } finally {
      setSavingOutcome("");
    }
  }

  function startNewPass() {
    const nextSessionId = createSessionId();
    persistSession(nextSessionId);
    setLookupValue("");
    setLookupResult(null);
    setMessage("");
    setError("");
    setLoading(true);
    refreshSession(nextSessionId)
      .catch((nextError) => setError(nextError.message || "Failed to start a new pass."))
      .finally(() => {
        setLoading(false);
        inputRef.current?.focus();
      });
  }

  async function joinPass() {
    const nextSessionId = normalizeSessionInput(sessionInput);
    if (!nextSessionId) {
      setError("Enter a pass code first.");
      return;
    }
    setLookupValue("");
    setLookupResult(null);
    setMessage("");
    setError("");
    setLoading(true);
    persistSession(nextSessionId);
    refreshSession(nextSessionId)
      .catch((nextError) => setError(nextError.message || "Failed to join pass."))
      .finally(() => {
        setLoading(false);
        inputRef.current?.focus();
      });
  }

  async function copyPassCode() {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      setMessage("Pass code copied. Another phone can open the same pass and join it.");
      setError("");
    } catch (_error) {
      setError("Could not copy pass code.");
    }
  }

  async function handleNotInDb() {
    if (!lookupValue.trim() || !sessionId) return;
    setSavingOutcome("not_in_db");
    setError("");
    setMessage("");
    try {
      await apiFetch("/api/remnant-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          entered_number: lookupValue.trim(),
          outcome: "not_in_db",
        }),
      });
      await refreshSession(sessionId);
      setLookupResult(null);
      setMessage(`Marked remnant #${lookupValue.trim()} as physically present but missing from the DB.`);
      setLookupValue("");
      inputRef.current?.focus();
    } catch (nextError) {
      setError(nextError.message || "Failed to save missing-DB record.");
    } finally {
      setSavingOutcome("");
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8f1ea_0%,#f4ede6_26%,#efe7de_100%)] px-3 py-4 text-[var(--brand-ink)] sm:px-5 sm:py-6 lg:px-6 lg:py-8">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-4 sm:gap-5">
        <section className="rounded-[28px] border border-[var(--brand-line)] bg-white/94 p-4 shadow-[0_24px_70px_rgba(25,27,28,0.08)] sm:rounded-[34px] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Inventory Confirm</p>
              <h1 className="mt-2 font-display text-[2rem] font-semibold leading-none text-[var(--brand-ink)] sm:text-4xl">Physical remnant check</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[rgba(25,27,28,0.72)]">
                Enter a remnant number, confirm whether you physically saw it, and keep track of what is still unchecked in this shared pass.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:gap-3">
              <Link
                href="/manage"
                className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)] sm:w-auto"
              >
                Back to Manage
              </Link>
              <button
                type="button"
                onClick={startNewPass}
                className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--brand-orange)] sm:w-auto"
              >
                Start New Pass
              </button>
            </div>
          </div>
          <div className="mt-4 rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 py-3 sm:rounded-[24px]">
            <p className="text-sm text-[rgba(25,27,28,0.72)]">
              Pass Code: <span className="font-semibold text-[var(--brand-ink)]">{sessionId || "Loading..."}</span>
            </p>
            <p className="mt-2 text-xs leading-5 text-[rgba(25,27,28,0.62)]">
              Anyone using the same pass code joins the same run and sees the same progress.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <input
                value={sessionInput}
                onChange={(event) => setSessionInput(event.target.value)}
                placeholder="Enter pass code to join"
                className="h-11 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm text-[var(--brand-ink)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
              />
              <button
                type="button"
                onClick={joinPass}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-white)]"
              >
                Join Pass
              </button>
              <button
                type="button"
                onClick={copyPassCode}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--brand-orange)]"
              >
                Copy Code
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_380px]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-7">
              <StatCard label="Total Active" value={summary.total_count || 0} />
              <StatCard label="Checked" value={summary.checked_count || 0} />
              <StatCard label="Seen" value={summary.seen_count || 0} tone="success" />
              <StatCard label="Missing" value={summary.missing_count || 0} tone="danger" />
              <StatCard label="Needs Review" value={summary.issue_count || 0} tone="warning" />
              <StatCard label="Not In DB" value={summary.not_in_db_count || 0} tone="info" />
              <div className="col-span-2 md:col-span-1 xl:col-span-1">
                <StatCard label="Unchecked" value={summary.unchecked_count || 0} tone="muted" />
              </div>
            </div>

            <section className="sticky top-3 z-10 rounded-[26px] border border-[var(--brand-line)] bg-white/96 p-4 shadow-[0_24px_70px_rgba(25,27,28,0.08)] backdrop-blur sm:static sm:rounded-[30px] sm:bg-white/94 sm:p-5 sm:backdrop-blur-0">
              <form onSubmit={handleLookupSubmit} className="flex flex-col gap-3 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                    Remnant Number
                  </label>
                  <input
                    ref={inputRef}
                    value={lookupValue}
                    onChange={(event) => setLookupValue(event.target.value)}
                    placeholder="Enter remnant #"
                    inputMode="numeric"
                    className="h-14 w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-lg text-[var(--brand-ink)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] sm:h-12 sm:text-base"
                  />
                </div>
                <button
                  type="submit"
                  disabled={lookupLoading || !lookupValue.trim()}
                  className="inline-flex h-14 items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-5 text-base font-semibold text-white transition hover:bg-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:self-end sm:text-sm"
                >
                  {lookupLoading ? "Looking up…" : "Find Remnant"}
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
              {!currentRemnant && lookupValue.trim() ? (
                <div className="mt-4 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4">
                  <p className="text-sm font-medium text-amber-950">
                    If remnant #{lookupValue.trim()} exists physically but was never uploaded, save it here so the pass still tracks it.
                  </p>
                  <button
                    type="button"
                    onClick={handleNotInDb}
                    disabled={savingOutcome === "not_in_db"}
                    className="mt-3 inline-flex h-12 items-center justify-center rounded-2xl bg-amber-500 px-5 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingOutcome === "not_in_db" ? "Saving…" : "Exists, Not In DB"}
                  </button>
                </div>
              ) : null}

              <div className="mt-5">
                {!currentRemnant ? (
                  <div className="rounded-[24px] border border-dashed border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,var(--brand-white)_100%)] px-5 py-8 text-center text-sm leading-6 text-[rgba(25,27,28,0.62)] sm:rounded-[26px] sm:px-6 sm:py-10">
                    {loading ? "Loading current pass…" : "Enter a remnant number to begin confirming inventory."}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-[24px] border border-[var(--brand-line)] bg-white shadow-[0_24px_70px_rgba(25,27,28,0.08)] sm:rounded-[28px]">
                    <div className="grid gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
                      <div className="border-b border-[var(--brand-line)] bg-[linear-gradient(135deg,#ffffff_0%,var(--brand-white)_100%)] p-4 lg:border-b-0 lg:border-r">
                        {currentRemnant.image ? (
                          <img
                            src={currentRemnant.image}
                            alt={currentRemnant.name}
                            className="h-52 w-full rounded-[20px] border border-[var(--brand-line)] bg-white object-contain sm:h-64 sm:rounded-[22px]"
                          />
                        ) : (
                          <div className="flex h-52 items-center justify-center rounded-[20px] border border-[var(--brand-line)] bg-white text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-orange)] sm:h-64 sm:rounded-[22px]">
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
                            <h2 className="mt-2 font-display text-[1.75rem] font-semibold leading-tight text-[var(--brand-ink)] sm:text-3xl">
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
                          </div>
                          {existingCheck ? (
                            <div className={`rounded-full px-3 py-2 text-xs font-semibold ${
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

                        <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
                          <button
                            type="button"
                            disabled={!canConfirm}
                            onClick={() => handleConfirm("seen")}
                            className="inline-flex h-14 items-center justify-center rounded-2xl bg-emerald-600 px-5 text-base font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:text-sm"
                          >
                            {savingOutcome === "seen" ? "Saving…" : "Yes, I Saw It"}
                          </button>
                          <button
                            type="button"
                            disabled={!canConfirm}
                            onClick={() => handleConfirm("issue")}
                            className="inline-flex h-14 items-center justify-center rounded-2xl bg-amber-500 px-5 text-base font-semibold text-white transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:text-sm"
                          >
                            {savingOutcome === "issue" ? "Saving…" : "Something Is Wrong"}
                          </button>
                          <button
                            type="button"
                            disabled={!canConfirm}
                            onClick={() => handleConfirm("missing")}
                            className="inline-flex h-14 items-center justify-center rounded-2xl bg-rose-600 px-5 text-base font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:text-sm"
                          >
                            {savingOutcome === "missing" ? "Saving…" : "No, Not There"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded-[26px] border border-[var(--brand-line)] bg-white/94 p-4 shadow-[0_24px_70px_rgba(25,27,28,0.08)] sm:rounded-[30px] sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Unchecked Preview</p>
                  <h3 className="mt-2 font-display text-[1.6rem] font-semibold text-[var(--brand-ink)] sm:text-2xl">Still not reviewed</h3>
                </div>
              </div>
              <div className="mt-4 hidden space-y-2 lg:block">
                {unseenRows.length ? unseenRows.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 py-3">
                    <p className="text-sm font-semibold text-[var(--brand-ink)]">#{row.moraware_remnant_id || row.id} · {row.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[rgba(25,27,28,0.54)]">{statusText(row.status)}</p>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 py-5 text-sm text-[rgba(25,27,28,0.62)]">
                    Nothing left in the current preview. Keep checking or start a new pass.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[26px] border border-[var(--brand-line)] bg-white/94 p-4 shadow-[0_24px_70px_rgba(25,27,28,0.08)] sm:rounded-[30px] sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Recent Checks</p>
              <div className="mt-4 hidden space-y-2 lg:block">
                {recentRows.length ? recentRows.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--brand-ink)]">
                        #{row.entered_number || row.remnant_id}
                      </p>
                      <p className="mt-1 text-xs text-[rgba(25,27,28,0.58)]">{new Date(row.created_at).toLocaleString()}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      row.outcome === "seen"
                        ? "bg-emerald-100 text-emerald-900"
                        : row.outcome === "issue"
                          ? "bg-amber-100 text-amber-950"
                          : row.outcome === "not_in_db"
                            ? "bg-sky-100 text-sky-950"
                        : "bg-rose-100 text-rose-900"
                    }`}>
                      {outcomeLabel(row.outcome)}
                    </span>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 py-5 text-sm text-[rgba(25,27,28,0.62)]">
                    No confirmations recorded in this pass yet.
                  </div>
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
