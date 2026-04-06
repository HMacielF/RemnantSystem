"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function isAccessDeniedError(message) {
  const normalized = String(message || "").trim().toLowerCase();
  return [
    "not authenticated",
    "invalid session",
    "profile not found",
    "your account is inactive",
    "inactive profile",
    "access denied",
    "forbidden",
  ].some((fragment) => normalized.includes(fragment));
}

async function apiFetch(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let message = "Request failed";
    try {
      const payload = await res.json();
      message = payload?.details ? `${payload.error}: ${payload.details}` : payload?.error || message;
    } catch (_error) {
      message = await res.text().catch(() => message);
    }
    throw new Error(message);
  }
  return res.json();
}

function identifierKey(identifier) {
  return JSON.stringify(identifier || {});
}

function prettyCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function timestampValueForInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isLongField(column) {
  return ["text", "json", "jsonb"].includes(column.type) || /notes|message|payload|data|error|hours/i.test(column.name);
}

function defaultValueForColumn(column) {
  if (column.defaultValue !== null && column.defaultValue !== undefined) {
    if (typeof column.defaultValue === "object") return JSON.stringify(column.defaultValue, null, 2);
    return String(column.defaultValue);
  }
  return column.type === "boolean" ? false : "";
}

function AccessNotice({ title, body, ctaHref, ctaLabel }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#1f3657_0%,#15263f_28%,#0f1727_58%,#edf2f7_58%,#edf2f7_100%)] px-6 py-10 text-[#18212d]">
      <div className="mx-auto max-w-3xl rounded-[32px] border border-white/15 bg-white/95 p-8 shadow-[0_28px_90px_rgba(11,18,32,0.18)]">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#b86f3d]">Super Admin Only</p>
        <h1 className="mt-3 text-3xl font-semibold text-[#172230]">{title}</h1>
        <p className="mt-4 text-sm leading-7 text-[#617286]">{body}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={ctaHref} className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#152238] px-5 text-sm font-semibold text-white transition hover:bg-[#f08b49]">
            {ctaLabel}
          </a>
        </div>
      </div>
    </main>
  );
}

export default function AdminWorkspaceClient() {
  const [authState, setAuthState] = useState("loading");
  const [profile, setProfile] = useState(null);
  const [tables, setTables] = useState([]);
  const [activeTable, setActiveTable] = useState("");
  const [rows, setRows] = useState([]);
  const [selectedIdentifier, setSelectedIdentifier] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [tableFilter, setTableFilter] = useState("");
  const [rowFilter, setRowFilter] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const activeTableMeta = useMemo(
    () => tables.find((table) => table.name === activeTable) || null,
    [tables, activeTable],
  );

  const filteredTables = useMemo(() => {
    const value = tableFilter.trim().toLowerCase();
    return tables.filter((table) => {
      if (!value) return true;
      return table.name.toLowerCase().includes(value) || table.label.toLowerCase().includes(value);
    });
  }, [tableFilter, tables]);

  const filteredRows = useMemo(() => {
    const value = rowFilter.trim().toLowerCase();
    return rows.filter((row) => {
      if (!value) return true;
      return JSON.stringify(row).toLowerCase().includes(value);
    });
  }, [rowFilter, rows]);

  const resettableSelectedRow = useMemo(() => {
    if (isCreating || !selectedIdentifier) return null;
    return rows.find((row) => identifierKey(row._identifier) === identifierKey(selectedIdentifier)) || null;
  }, [isCreating, rows, selectedIdentifier]);

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
        if (nextProfile.system_role !== "super_admin") {
          setAuthState("forbidden");
          setProfile(nextProfile);
          return;
        }
        setProfile(nextProfile);

        const metaPayload = await apiFetch("/api/admin/db/meta");
        if (!mounted) return;
        const nextTables = Array.isArray(metaPayload.tables) ? metaPayload.tables : [];
        setTables(nextTables);
        setAuthState("ready");
        if (nextTables.length > 0) {
          setActiveTable(nextTables[0].name);
        }
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
    if (authState !== "ready" || !activeTable) return;

    async function loadRows() {
      try {
        setError("");
        const payload = await apiFetch(`/api/admin/db/${encodeURIComponent(activeTable)}?limit=150`);
        const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
        setRows(nextRows);
        setSelectedIdentifier(null);
        setSelectedRow(null);
        setIsCreating(false);
      } catch (loadError) {
        setError(loadError.message);
      }
    }

    loadRows();
  }, [activeTable, authState]);

  function startCreateRow() {
    if (!activeTableMeta) return;
    setIsCreating(true);
    setSelectedIdentifier(null);
    setSelectedRow(
      activeTableMeta.columns.reduce((acc, column) => {
        acc[column.name] = defaultValueForColumn(column);
        return acc;
      }, {}),
    );
    setMessage("");
  }

  function selectRow(row) {
    setIsCreating(false);
    setSelectedIdentifier(row._identifier);
    setSelectedRow(JSON.parse(JSON.stringify(row)));
    setMessage("");
  }

  function updateSelectedField(column, value) {
    setSelectedRow((current) => ({
      ...(current || {}),
      [column.name]: column.type === "boolean" ? Boolean(value) : value,
    }));
  }

  async function reloadMeta() {
    try {
      const metaPayload = await apiFetch("/api/admin/db/meta");
      const nextTables = Array.isArray(metaPayload.tables) ? metaPayload.tables : [];
      setTables(nextTables);
      if (!nextTables.some((table) => table.name === activeTable) && nextTables.length > 0) {
        setActiveTable(nextTables[0].name);
      }
      setMessage("Table metadata refreshed.");
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  async function reloadRows() {
    if (!activeTable) return;
    try {
      const payload = await apiFetch(`/api/admin/db/${encodeURIComponent(activeTable)}?limit=150`);
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setMessage("Rows reloaded.");
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  async function saveRow(event) {
    event.preventDefault();
    if (!activeTableMeta || !selectedRow) return;

    try {
      setError("");
      setMessage("");
      const values = activeTableMeta.columns.reduce((acc, column) => {
        if (!column.editable) return acc;
        acc[column.name] = selectedRow[column.name];
        return acc;
      }, {});

      const endpoint = `/api/admin/db/${encodeURIComponent(activeTableMeta.name)}`;
      const payload = isCreating
        ? { values }
        : { identifier: selectedIdentifier, values };
      const method = isCreating ? "POST" : "PATCH";
      const result = await apiFetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const savedRow = result.row || null;
      if (!savedRow) throw new Error("No row returned from save");

      setRows((currentRows) => {
        if (isCreating) return [savedRow, ...currentRows];
        return currentRows.map((row) =>
          identifierKey(row._identifier) === identifierKey(selectedIdentifier) ? savedRow : row,
        );
      });
      setSelectedIdentifier(savedRow._identifier);
      setSelectedRow(JSON.parse(JSON.stringify(savedRow)));
      setIsCreating(false);
      setMessage("Row saved successfully.");
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  async function deleteRow() {
    if (isCreating || !activeTable || !selectedIdentifier) return;
    if (!window.confirm("Delete this row permanently?")) return;

    try {
      setError("");
      setMessage("");
      await apiFetch(`/api/admin/db/${encodeURIComponent(activeTable)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: selectedIdentifier }),
      });
      setRows((currentRows) =>
        currentRows.filter((row) => identifierKey(row._identifier) !== identifierKey(selectedIdentifier)),
      );
      setSelectedIdentifier(null);
      setSelectedRow(null);
      setMessage("Row deleted.");
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  if (authState === "loading") {
    return <main className="min-h-screen bg-[#edf2f7] px-6 py-10 text-[#18212d]">Loading super-admin workspace...</main>;
  }

  if (authState === "forbidden") {
    return (
      <AccessNotice
        title={profile ? "This route is reserved for super admins." : "You need an active management login first."}
        body={profile
          ? "Your account is signed in, but it does not have the super_admin role required for direct database editing."
          : "Sign in first, then come back here to continue in the admin workspace."}
        ctaHref={profile ? "/manage" : "/portal"}
        ctaLabel={profile ? "Open Private Workspace" : "Open Login"}
      />
    );
  }

  const visibleColumns = activeTableMeta?.columns.slice(0, 6) || [];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#1f3657_0%,#15263f_28%,#0f1727_58%,#edf2f7_58%,#edf2f7_100%)] font-sans text-[#18212d]">
      <div className="mx-auto max-w-[1800px] px-4 py-4 md:px-6 md:py-6">
        <section className="mb-4 overflow-hidden rounded-[32px] border border-white/15 bg-[linear-gradient(135deg,rgba(11,18,32,0.92),rgba(27,43,69,0.86))] px-6 py-6 text-white shadow-[0_28px_90px_rgba(11,18,32,0.18)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#f8b98a]">Super Admin Only</p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight md:text-[2.8rem]">Direct database workspace for live operations.</h1>
              <p className="mt-3 text-sm text-slate-300 md:text-base">
                Browse, edit, create, and delete records across the app tables without touching code. This workspace is only available to `super_admin`.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white">
                {profile?.full_name || profile?.email || "User"} · {profile?.system_role}
              </div>
              <Link href="/manage" className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/15">
                Back to Workspace
              </Link>
            </div>
          </div>
        </section>

        {message ? (
          <div className="mb-4 rounded-2xl bg-[#eef6f1] px-4 py-3 text-sm font-medium text-[#27543f]">{message}</div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-2xl bg-[#fff1f1] px-4 py-3 text-sm font-medium text-[#b42318]">{error}</div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_420px]">
          <aside className="rounded-[28px] border border-[#d8e1ea] bg-white/94 p-4 shadow-[0_28px_90px_rgba(11,18,32,0.18)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#62758a]">Tables</p>
                <h2 className="mt-1 text-xl font-semibold text-[#172230]">Editable schema</h2>
              </div>
              <button type="button" onClick={() => reloadMeta()} className="inline-flex h-10 items-center justify-center rounded-2xl border border-[#d0dae5] px-4 text-sm font-semibold text-[#233245] transition hover:border-[#f08b49] hover:text-[#111827]">
                Refresh
              </button>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#708296]">
                Filter tables
                <input
                  value={tableFilter}
                  onChange={(event) => setTableFilter(event.target.value)}
                  type="text"
                  placeholder="Search table names"
                  className="mt-2 h-11 w-full rounded-2xl border border-[#d8e1ea] bg-[#f8fafc] px-4 text-sm text-[#18212d] outline-none transition focus:border-[#f08b49] focus:ring-4 focus:ring-[#f08b49]/10"
                />
              </label>
            </div>
            <div className="mt-4 space-y-2">
              {filteredTables.map((table) => {
                const isActive = table.name === activeTable;
                return (
                  <button
                    key={table.name}
                    type="button"
                    onClick={() => setActiveTable(table.name)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      isActive
                        ? "border-[#f08b49] bg-[#fff4ec] shadow-sm"
                        : "border-[#e4ebf2] bg-[#f8fafc] hover:border-[#d0dae5] hover:bg-white"
                    }`}
                  >
                    <p className="text-sm font-semibold text-[#172230]">{table.label}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[#708296]">{table.name}</p>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="rounded-[28px] border border-[#d8e1ea] bg-white/95 p-4 shadow-[0_28px_90px_rgba(11,18,32,0.18)]">
            <div className="flex flex-col gap-4 border-b border-[#e4ebf2] pb-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#62758a]">Rows</p>
                <h2 className="mt-1 text-2xl font-semibold text-[#172230]">{activeTableMeta?.label || "Choose a table"}</h2>
                <p className="mt-2 text-sm text-[#617286]">
                  {activeTableMeta
                    ? `${activeTableMeta.primaryKey.join(" + ")} primary key • ${activeTableMeta.columns.length} columns`
                    : "The newest rows will appear here once a table is selected."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => reloadRows()} disabled={!activeTable} className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d0dae5] px-5 text-sm font-semibold text-[#233245] transition hover:border-[#f08b49] hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-50">
                  Reload Rows
                </button>
                <button type="button" onClick={startCreateRow} disabled={!activeTableMeta} className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#152238] px-5 text-sm font-semibold text-white transition hover:bg-[#f08b49] disabled:cursor-not-allowed disabled:opacity-50">
                  New Row
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="min-w-[220px] flex-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#708296]">
                Quick row filter
                <input
                  value={rowFilter}
                  onChange={(event) => setRowFilter(event.target.value)}
                  type="text"
                  placeholder="Filter loaded rows"
                  className="mt-2 h-11 w-full rounded-2xl border border-[#d8e1ea] bg-[#f8fafc] px-4 text-sm text-[#18212d] outline-none transition focus:border-[#f08b49] focus:ring-4 focus:ring-[#f08b49]/10"
                />
              </label>
              <div className="rounded-2xl border border-[#e4ebf2] bg-[#f8fafc] px-4 py-3 text-sm text-[#4a5c72]">
                {filteredRows.length} rows loaded
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[24px] border border-[#dfe8f0]">
              <div className="max-h-[70vh] overflow-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-[#f8fafc] text-left text-[#546679]">
                    <tr>
                      {visibleColumns.map((column) => (
                        <th key={column.name} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">
                          {column.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eef2f6] bg-white">
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={visibleColumns.length || 1} className="px-4 py-8 text-center text-sm text-[#617286]">
                          No rows match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => {
                        const active = identifierKey(row._identifier) === identifierKey(selectedIdentifier) && !isCreating;
                        return (
                          <tr
                            key={identifierKey(row._identifier)}
                            onClick={() => selectRow(row)}
                            className={`cursor-pointer transition ${active ? "bg-[#fff4ec]" : "hover:bg-[#f8fafc]"}`}
                          >
                            {visibleColumns.map((column) => (
                              <td key={column.name} className="max-w-[240px] px-4 py-3 align-top text-[#172230]">
                                <div className="truncate">{prettyCell(row[column.name])}</div>
                              </td>
                            ))}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-[#d8e1ea] bg-white/96 p-4 shadow-[0_28px_90px_rgba(11,18,32,0.18)]">
            <div className="border-b border-[#e4ebf2] pb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#62758a]">Editor</p>
              <h2 className="mt-1 text-2xl font-semibold text-[#172230]">
                {!activeTableMeta ? "No row selected" : isCreating ? `Create ${activeTableMeta.label} row` : `Edit ${activeTableMeta.label} row`}
              </h2>
              <p className="mt-2 text-sm text-[#617286]">
                {!activeTableMeta
                  ? "Select a row or create a new one to edit fields."
                  : isCreating
                    ? "Fill in the fields below and save to create a new record."
                    : `Primary key: ${activeTableMeta.primaryKey.map((key) => `${key}=${prettyCell(selectedRow?.[key])}`).join(", ")}`}
              </p>
            </div>

            <form onSubmit={saveRow} className="mt-4 space-y-4">
              <div className="space-y-4">
                {activeTableMeta?.columns.map((column) => {
                  const value = selectedRow?.[column.name];
                  const disabled = !activeTableMeta || !selectedRow || !column.editable;
                  return (
                    <label key={column.name} className="block text-sm font-semibold text-[#233245]">
                      <span className="flex items-center justify-between gap-3">
                        <span>{column.name}</span>
                        <span className="text-[11px] uppercase tracking-[0.16em] text-[#8a98aa]">{column.type}</span>
                      </span>
                      {column.type === "boolean" ? (
                        <span className="mt-2 inline-flex items-center gap-3 rounded-2xl border border-[#d8e1ea] bg-[#f8fafc] px-4 py-3 text-sm text-[#172230]">
                          <input
                            type="checkbox"
                            checked={Boolean(value)}
                            disabled={disabled}
                            onChange={(event) => updateSelectedField(column, event.target.checked)}
                          />
                          <span>{column.editable ? "Enabled" : "Read only"}</span>
                        </span>
                      ) : column.type === "enum" ? (
                        <select
                          value={value ?? ""}
                          disabled={disabled}
                          onChange={(event) => updateSelectedField(column, event.target.value)}
                          className="mt-2 h-11 w-full rounded-2xl border border-[#d8e1ea] bg-[#f8fafc] px-4 text-sm text-[#172230] outline-none focus:border-[#f08b49] focus:ring-4 focus:ring-[#f08b49]/10"
                        >
                          <option value="">Select</option>
                          {(column.options || []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : column.type === "json" || column.type === "jsonb" || isLongField(column) ? (
                        <textarea
                          rows="4"
                          value={column.type === "json" || column.type === "jsonb"
                            ? (value ? JSON.stringify(value, null, 2) : "")
                            : String(value ?? "")}
                          disabled={disabled}
                          onChange={(event) => updateSelectedField(column, event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-[#d8e1ea] bg-[#f8fafc] px-4 py-3 text-sm text-[#172230] outline-none focus:border-[#f08b49] focus:ring-4 focus:ring-[#f08b49]/10"
                        />
                      ) : (
                        <input
                          type={column.type === "bigint" || column.type === "integer" ? "number" : column.type === "timestamptz" ? "datetime-local" : "text"}
                          value={column.type === "timestamptz" ? timestampValueForInput(value) : String(value ?? "")}
                          disabled={disabled}
                          onChange={(event) => updateSelectedField(column, event.target.value)}
                          className="mt-2 h-11 w-full rounded-2xl border border-[#d8e1ea] bg-[#f8fafc] px-4 text-sm text-[#172230] outline-none focus:border-[#f08b49] focus:ring-4 focus:ring-[#f08b49]/10"
                        />
                      )}
                      {!column.editable ? <p className="mt-1 text-xs text-[#8a98aa]">Server-managed field</p> : null}
                    </label>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-[#e4ebf2] pt-4">
                <button type="submit" disabled={!activeTableMeta || !selectedRow} className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#152238] px-5 text-sm font-semibold text-white transition hover:bg-[#f08b49] disabled:cursor-not-allowed disabled:opacity-50">
                  Save Changes
                </button>
                <button type="button" onClick={() => {
                  if (isCreating && activeTableMeta) {
                    setSelectedRow(
                      activeTableMeta.columns.reduce((acc, column) => {
                        acc[column.name] = defaultValueForColumn(column);
                        return acc;
                      }, {}),
                    );
                    return;
                  }
                  setSelectedRow(resettableSelectedRow ? JSON.parse(JSON.stringify(resettableSelectedRow)) : null);
                }} className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d0dae5] px-5 text-sm font-semibold text-[#233245] transition hover:border-[#f08b49]">
                  Reset
                </button>
                <button type="button" onClick={deleteRow} disabled={isCreating || !selectedIdentifier} className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#fecaca] px-5 text-sm font-semibold text-[#b42318] transition hover:bg-[#fff1f1] disabled:cursor-not-allowed disabled:opacity-50">
                  Delete Row
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
