"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const ROWS_PAGE_SIZE = 150;

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

function formatTimestampDisplay(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function prettyCell(value, column) {
  if (value === null || value === undefined) return "";
  if (column?.type === "timestamptz") return formatTimestampDisplay(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sortableCellValue(value, column) {
  if (value === null || value === undefined || value === "") return null;
  if (column?.type === "boolean") return value ? 1 : 0;
  if (["bigint", "integer", "numeric"].includes(column?.type)) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : String(value).toLowerCase();
  }
  if (column?.type === "timestamptz") {
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? String(value).toLowerCase() : timestamp;
  }
  if (typeof value === "object") return JSON.stringify(value).toLowerCase();
  return String(value).toLowerCase();
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

function buildDefaultRow(columns) {
  return (Array.isArray(columns) ? columns : []).reduce((acc, column) => {
    acc[column.name] = defaultValueForColumn(column);
    return acc;
  }, {});
}

function editableValuesForRow(columns, row) {
  return (Array.isArray(columns) ? columns : []).reduce((acc, column) => {
    if (column.editable === false) return acc;
    acc[column.name] = row?.[column.name] ?? defaultValueForColumn(column);
    return acc;
  }, {});
}

function AccessNotice({ title, body, ctaHref, ctaLabel }) {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,var(--brand-white)_52%,rgba(247,134,57,0.08)_100%)] px-6 py-10 text-[var(--brand-ink)]">
      <div className="mx-auto max-w-3xl rounded-[32px] border border-[var(--brand-line)] bg-white/95 p-8 shadow-[0_28px_90px_rgba(25,27,28,0.12)]">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--brand-orange)]">Super Admin Only</p>
        <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--brand-ink)]">{title}</h1>
        <p className="mt-4 text-sm leading-7 text-[color:color-mix(in_srgb,var(--brand-ink)_68%,white)]">{body}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={ctaHref} className="inline-flex h-11 items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--brand-orange)]">
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
  const [relationOptions, setRelationOptions] = useState({
    companies: [],
    materials: [],
    thicknesses: [],
    users: [],
    salesReps: [],
  });
  const [activeTable, setActiveTable] = useState("");
  const [rows, setRows] = useState([]);
  const [selectedIdentifier, setSelectedIdentifier] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [tableFilter, setTableFilter] = useState("");
  const [rowFilter, setRowFilter] = useState("");
  const [rowOffset, setRowOffset] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [visibleColumnCount, setVisibleColumnCount] = useState(12);
  const [sortConfig, setSortConfig] = useState({ column: "", direction: "asc" });
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

  const sortedRows = useMemo(() => {
    if (!sortConfig.column || !activeTableMeta) return filteredRows;
    const sortColumn = activeTableMeta.columns.find((column) => column.name === sortConfig.column);
    if (!sortColumn) return filteredRows;

    const nextRows = [...filteredRows];
    nextRows.sort((left, right) => {
      const leftValue = sortableCellValue(left[sortColumn.name], sortColumn);
      const rightValue = sortableCellValue(right[sortColumn.name], sortColumn);

      if (leftValue === rightValue) return 0;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      if (leftValue < rightValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (leftValue > rightValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return nextRows;
  }, [activeTableMeta, filteredRows, sortConfig]);

  const resettableSelectedRow = useMemo(() => {
    if (isCreating || !selectedIdentifier) return null;
    return rows.find((row) => identifierKey(row._identifier) === identifierKey(selectedIdentifier)) || null;
  }, [isCreating, rows, selectedIdentifier]);

  const activeTableName = activeTableMeta?.name || "";
  const visibleColumns = useMemo(() => {
    if (!activeTableMeta?.columns) return [];
    if (visibleColumnCount === Number.POSITIVE_INFINITY) return activeTableMeta.columns;
    return activeTableMeta.columns.slice(0, visibleColumnCount);
  }, [activeTableMeta, visibleColumnCount]);

  const defaultSelectedRow = useMemo(
    () => (activeTableMeta ? buildDefaultRow(activeTableMeta.columns) : null),
    [activeTableMeta],
  );

  const hasUnsavedChanges = useMemo(() => {
    if (!activeTableMeta || !selectedRow) return false;
    const baseline = isCreating
      ? editableValuesForRow(activeTableMeta.columns, defaultSelectedRow)
      : editableValuesForRow(activeTableMeta.columns, resettableSelectedRow);
    const current = editableValuesForRow(activeTableMeta.columns, selectedRow);
    return JSON.stringify(current) !== JSON.stringify(baseline);
  }, [activeTableMeta, defaultSelectedRow, isCreating, resettableSelectedRow, selectedRow]);

  const pageStart = totalRows === 0 ? 0 : rowOffset + 1;
  const pageEnd = totalRows === 0 ? 0 : Math.min(rowOffset + sortedRows.length, totalRows);
  const hasPreviousPage = rowOffset > 0;
  const hasNextPage = rowOffset + ROWS_PAGE_SIZE < totalRows;

  useEffect(() => {
    if (!message) return undefined;
    const timeoutId = window.setTimeout(() => setMessage(""), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    if (!error) return undefined;
    const timeoutId = window.setTimeout(() => setError(""), 4200);
    return () => window.clearTimeout(timeoutId);
  }, [error]);

  function optionsForColumn(columnName) {
    if (columnName === "company_id") return relationOptions.companies;
    if (columnName === "material_id") return relationOptions.materials;
    if (columnName === "thickness_id") return relationOptions.thicknesses;

    if (["sales_rep_user_id", "hold_owner_user_id", "sold_by_user_id"].includes(columnName)) {
      return relationOptions.salesReps;
    }

    if (/_user_id$/.test(columnName)) {
      return relationOptions.users;
    }

    return null;
  }

  function relationEmptyMessage(columnName) {
    if (columnName === "company_id") return "No active companies available";
    if (["sales_rep_user_id", "hold_owner_user_id", "sold_by_user_id"].includes(columnName)) {
      return "No active sales reps available";
    }
    if (/_user_id$/.test(columnName)) return "No users available";
    return "No options available";
  }

  function setCreateDefaults() {
    if (!activeTableMeta) return;
    setSelectedRow(buildDefaultRow(activeTableMeta.columns));
  }

  function closeEditorModal() {
    setSelectedRow(null);
    setIsCreating(false);
  }

  function toggleSort(columnName) {
    setSortConfig((current) => {
      if (current.column === columnName) {
        return {
          column: columnName,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }
      return { column: columnName, direction: "asc" };
    });
  }

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

        const [metaPayload, lookupPayload, profileRowsPayload] = await Promise.all([
          apiFetch("/api/admin/db/meta", { cache: "no-store" }),
          apiFetch("/api/lookups", { cache: "no-store" }),
          apiFetch("/api/admin/db/profiles?limit=500", { cache: "no-store" }),
        ]);
        if (!mounted) return;
        const nextTables = Array.isArray(metaPayload.tables) ? metaPayload.tables : [];
        const userRows = Array.isArray(profileRowsPayload.rows) ? profileRowsPayload.rows : [];
        const userOptions = userRows
          .map((row) => ({
            value: row.id,
            label: row.full_name || row.email || row.id,
          }))
          .filter((row) => row.value);

        const salesRepOptions = userRows
          .filter((row) => row.active && row.system_role === "status_user")
          .map((row) => ({
            value: row.id,
            label: row.full_name || row.email || row.id,
          }));

        setRelationOptions({
          companies: Array.isArray(lookupPayload.companies)
            ? lookupPayload.companies.map((row) => ({ value: String(row.id), label: row.name || String(row.id) }))
            : [],
          materials: Array.isArray(lookupPayload.materials)
            ? lookupPayload.materials.map((row) => ({ value: String(row.id), label: row.name || String(row.id) }))
            : [],
          thicknesses: Array.isArray(lookupPayload.thicknesses)
            ? lookupPayload.thicknesses.map((row) => ({ value: String(row.id), label: row.name || String(row.id) }))
            : [],
          users: userOptions,
          salesReps: salesRepOptions,
        });
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
        const payload = await apiFetch(`/api/admin/db/${encodeURIComponent(activeTable)}?limit=${ROWS_PAGE_SIZE}&offset=${rowOffset}`, { cache: "no-store" });
        const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
        setRows(nextRows);
        setTotalRows(Number(payload.total) || nextRows.length || 0);
        setSelectedIdentifier(null);
        setSelectedRow(null);
        setIsCreating(false);
      } catch (loadError) {
        setError(loadError.message);
      }
    }

    loadRows();
  }, [activeTable, authState, rowOffset]);

  useEffect(() => {
    setRowOffset(0);
    setSortConfig({ column: "", direction: "asc" });
  }, [activeTable]);

  function startCreateRow() {
    if (!activeTableMeta) return;
    setIsCreating(true);
    setSelectedIdentifier(null);
    setCreateDefaults();
    setMessage("");
  }

  function duplicateSelectedRow() {
    if (!activeTableMeta || !resettableSelectedRow) return;
    setIsCreating(true);
    setSelectedIdentifier(null);
    setSelectedRow(editableValuesForRow(activeTableMeta.columns, resettableSelectedRow));
    setMessage("Duplicating the selected row. Review fields before saving.");
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
      const metaPayload = await apiFetch("/api/admin/db/meta", { cache: "no-store" });
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
      const payload = await apiFetch(`/api/admin/db/${encodeURIComponent(activeTable)}?limit=${ROWS_PAGE_SIZE}&offset=${rowOffset}`, { cache: "no-store" });
      const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
      setRows(nextRows);
      setTotalRows(Number(payload.total) || nextRows.length || 0);
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

      const isProfileCreate = isCreating && activeTableMeta.name === "profiles";
      const endpoint = isProfileCreate
        ? "/api/admin/users"
        : `/api/admin/db/${encodeURIComponent(activeTableMeta.name)}`;
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
      setMessage(isProfileCreate ? "User invited successfully." : "Row saved successfully.");

      if (activeTableMeta.name === "profiles") {
        setRelationOptions((current) => {
          const existingUsers = current.users.filter((row) => row.value !== savedRow.id);
          const nextUser = {
            value: savedRow.id,
            label: savedRow.full_name || savedRow.email || savedRow.id,
          };
          const existingSalesReps = current.salesReps.filter((row) => row.value !== savedRow.id);
          return {
            ...current,
            users: [nextUser, ...existingUsers].sort((a, b) => a.label.localeCompare(b.label)),
            salesReps:
              savedRow.active && savedRow.system_role === "status_user"
                ? [nextUser, ...existingSalesReps].sort((a, b) => a.label.localeCompare(b.label))
                : existingSalesReps,
          };
        });
      }
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
    return <main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,var(--brand-white)_52%,rgba(247,134,57,0.08)_100%)] px-6 py-10 text-[var(--brand-ink)]">Loading super-admin workspace...</main>;
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

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,var(--brand-white)_52%,rgba(247,134,57,0.08)_100%)] font-sans text-[var(--brand-ink)]">
      <div className="mx-auto w-full max-w-[1800px] px-3 py-5 sm:px-4 md:px-6 2xl:px-8">
        <section className="mb-4 overflow-hidden rounded-[32px] border border-[var(--brand-line)] bg-[linear-gradient(135deg,rgba(255,255,255,0.99),rgba(242,242,242,0.96))] px-6 py-5 text-[var(--brand-ink)] shadow-[0_28px_90px_rgba(25,27,28,0.10)]">
          <div className="grid gap-5 lg:items-start xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,520px)]">
            <div className="max-w-4xl">
              <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-orange)]">Super Admin Workspace</p>
              <h1 className="font-display mt-3 max-w-3xl text-[1.9rem] font-semibold leading-tight text-[var(--brand-ink)] md:text-[2.35rem]">
                Direct database controls for live operations.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[rgba(35,35,35,0.72)]">
                Browse and update live app tables fast. Reserved for `super_admin`.
              </p>
            </div>

            <div className="ml-auto w-fit max-w-full rounded-[22px] border border-[var(--brand-line)] bg-white p-3.5 shadow-[0_16px_38px_rgba(25,27,28,0.06)] backdrop-blur xl:min-w-[420px]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold text-[var(--brand-ink)]">
                    {profile?.full_name || profile?.email || "User"} · {profile?.system_role}
                  </h2>
                </div>
                <form method="POST" action="/api/auth/logout" className="shrink-0">
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-3.5 text-center text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)]"
                  >
                    Log Out
                  </button>
                </form>
              </div>
              <div className="mt-3.5 grid grid-cols-3 gap-2.5">
                <Link
                  href="/manage"
                  className="inline-flex h-10 w-full items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)]"
                >
                  Remnants
                </Link>
                <Link
                  href="/slabs"
                  className="inline-flex h-10 w-full items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)]"
                >
                  Slabs
                </Link>
                <Link
                  href="/portal"
                  className="inline-flex h-10 w-full items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)]"
                >
                  Portal
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="rounded-[28px] border border-[var(--brand-line)] bg-white/94 p-4 shadow-[0_28px_90px_rgba(25,27,28,0.10)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Tables</p>
                <h2 className="font-display mt-1 text-xl font-semibold text-[var(--brand-ink)]">Editable schema</h2>
              </div>
              <button type="button" onClick={() => reloadMeta()} className="inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)]">
                Refresh
              </button>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                Filter tables
                <input
                  value={tableFilter}
                  onChange={(event) => setTableFilter(event.target.value)}
                  type="text"
                  placeholder="Search table names"
                  className="mt-2 h-11 w-full rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 text-sm text-[var(--brand-ink)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
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
                        ? "border-[var(--brand-orange)] bg-[rgba(247,134,57,0.12)] shadow-sm"
                        : "border-[var(--brand-line)] bg-[var(--brand-shell)] hover:border-[rgba(247,134,57,0.32)] hover:bg-white"
                    }`}
                  >
                    <p className="text-sm font-semibold text-[var(--brand-ink)]">{table.label}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[color:color-mix(in_srgb,var(--brand-ink)_58%,white)]">{table.name}</p>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="rounded-[28px] border border-[var(--brand-line)] bg-white/95 p-4 shadow-[0_28px_90px_rgba(25,27,28,0.10)]">
            <div className="flex flex-col gap-4 border-b border-[var(--brand-line)] pb-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Rows</p>
                <h2 className="font-display mt-1 text-2xl font-semibold text-[var(--brand-ink)]">{activeTableMeta?.label || "Choose a table"}</h2>
                <p className="mt-2 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_68%,white)]">
                  {activeTableMeta
                    ? `${activeTableMeta.primaryKey.join(" + ")} primary key • ${activeTableMeta.columns.length} columns`
                    : "The newest rows will appear here once a table is selected."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => reloadRows()} disabled={!activeTable} className="inline-flex h-11 items-center justify-center rounded-2xl border border-[var(--brand-line)] px-5 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)] disabled:cursor-not-allowed disabled:opacity-50">
                  Reload Rows
                </button>
                <button type="button" onClick={duplicateSelectedRow} disabled={!resettableSelectedRow || !activeTableMeta} className="inline-flex h-11 items-center justify-center rounded-2xl border border-[var(--brand-line)] px-5 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)] disabled:cursor-not-allowed disabled:opacity-50">
                  Duplicate Row
                </button>
                <button type="button" onClick={startCreateRow} disabled={!activeTableMeta} className="inline-flex h-11 items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-50">
                  New Row
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="min-w-[220px] flex-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
                Quick row filter
                <input
                  value={rowFilter}
                  onChange={(event) => setRowFilter(event.target.value)}
                  type="text"
                  placeholder="Filter loaded rows"
                  className="mt-2 h-11 w-full rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 text-sm text-[var(--brand-ink)] outline-none transition focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                />
              </label>
              <div className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 py-3 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_68%,white)]">
                {pageStart && pageEnd ? `${pageStart}-${pageEnd} of ${totalRows || sortedRows.length}` : `${sortedRows.length} rows loaded`}
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-3 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Columns</span>
                <select
                  value={Number.isFinite(visibleColumnCount) ? String(visibleColumnCount) : "all"}
                  onChange={(event) => setVisibleColumnCount(event.target.value === "all" ? Number.POSITIVE_INFINITY : Number(event.target.value))}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-1.5 text-sm text-[var(--brand-ink)] outline-none transition focus:border-[var(--brand-orange)]"
                >
                  <option value="6">6</option>
                  <option value="12">12</option>
                  <option value="18">18</option>
                  <option value="all">All</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRowOffset((current) => Math.max(current - ROWS_PAGE_SIZE, 0))}
                  disabled={!hasPreviousPage}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-[var(--brand-line)] px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setRowOffset((current) => current + ROWS_PAGE_SIZE)}
                  disabled={!hasNextPage}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-[var(--brand-line)] px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[24px] border border-[var(--brand-line)]">
              <div className="max-h-[70vh] overflow-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-[var(--brand-shell)] text-left text-[color:color-mix(in_srgb,var(--brand-ink)_60%,white)]">
                    <tr>
                      {visibleColumns.map((column) => (
                        <th key={column.name} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">
                          <button
                            type="button"
                            onClick={() => toggleSort(column.name)}
                            className="inline-flex items-center gap-1 text-left transition hover:text-[var(--brand-ink)]"
                          >
                            <span>{column.name}</span>
                            <span className="text-[10px] text-[color:color-mix(in_srgb,var(--brand-ink)_45%,white)]">
                              {sortConfig.column === column.name
                                ? sortConfig.direction === "asc"
                                  ? "↑"
                                  : "↓"
                                : "↕"}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--brand-line)] bg-white">
                    {sortedRows.length === 0 ? (
                      <tr>
                        <td colSpan={visibleColumns.length || 1} className="px-4 py-8 text-center text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_68%,white)]">
                          No rows match the current filter.
                        </td>
                      </tr>
                    ) : (
                      sortedRows.map((row) => {
                        const active = identifierKey(row._identifier) === identifierKey(selectedIdentifier) && !isCreating;
                        return (
                          <tr
                            key={identifierKey(row._identifier)}
                            onClick={() => selectRow(row)}
                            className={`cursor-pointer transition ${active ? "bg-[rgba(247,134,57,0.12)]" : "hover:bg-[var(--brand-shell)]"}`}
                          >
                            {visibleColumns.map((column) => (
                              <td key={column.name} className="max-w-[240px] px-4 py-3 align-top text-[var(--brand-ink)]">
                                <div className="truncate">{prettyCell(row[column.name], column)}</div>
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

        </div>
      </div>

      <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-full max-w-sm flex-col gap-3 sm:right-6 sm:top-6">
        {message ? (
          <div className="pointer-events-auto rounded-2xl border border-[rgba(60,113,82,0.18)] bg-[#eef6f1]/95 px-4 py-3 text-sm font-medium text-[#27543f] shadow-[0_18px_40px_rgba(39,84,63,0.14)] backdrop-blur">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="pointer-events-auto rounded-2xl border border-[#fecaca] bg-[#fff1f1]/95 px-4 py-3 text-sm font-medium text-[#b42318] shadow-[0_18px_40px_rgba(180,35,24,0.12)] backdrop-blur">
            {error}
          </div>
        ) : null}
      </div>

      {activeTableMeta && selectedRow ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(17,24,39,0.46)] px-3 py-6 sm:px-4 md:py-10" onClick={closeEditorModal}>
          <section
            className="w-full max-w-4xl rounded-[28px] border border-[var(--brand-line)] bg-white/98 p-4 shadow-[0_32px_120px_rgba(25,27,28,0.20)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[var(--brand-line)] pb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-orange)]">Editor</p>
                  <h2 className="font-display mt-1 text-2xl font-semibold text-[var(--brand-ink)]">
                    {isCreating ? `Create ${activeTableMeta.label} row` : `Edit ${activeTableMeta.label} row`}
                  </h2>
                  <p className="mt-2 text-sm text-[color:color-mix(in_srgb,var(--brand-ink)_68%,white)]">
                    {isCreating
                      ? activeTableName === "profiles"
                        ? "Saving here sends an invite email and creates the matching auth user and profile."
                        : "Fill in the fields below and save to create a new record."
                      : `Primary key: ${activeTableMeta.primaryKey.map((key) => `${key}=${prettyCell(selectedRow?.[key])}`).join(", ")}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeEditorModal}
                  className="inline-flex h-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-shell)]"
                >
                  Close
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${isCreating ? "border-[rgba(247,134,57,0.28)] bg-[rgba(247,134,57,0.12)] text-[var(--brand-orange-deep)]" : "border-[var(--brand-line)] bg-[var(--brand-shell)] text-[var(--brand-ink)]"}`}>
                  {isCreating ? "New Row" : "Editing Existing Row"}
                </span>
                {hasUnsavedChanges ? (
                  <span className="rounded-full border border-[rgba(247,134,57,0.28)] bg-[rgba(247,134,57,0.12)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-orange-deep)]">
                    Unsaved Changes
                  </span>
                ) : (
                  <span className="rounded-full border border-[rgba(60,113,82,0.18)] bg-[#eef6f1] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#27543f]">
                    In Sync
                  </span>
                )}
              </div>
            </div>

            <form onSubmit={saveRow} className="mt-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                {activeTableMeta.columns.map((column) => {
                  const value = selectedRow?.[column.name];
                  const disabled = !selectedRow || !column.editable;
                  const selectOptions = optionsForColumn(column.name);
                  const isWideField = column.type === "json" || column.type === "jsonb" || isLongField(column);
                  return (
                    <label key={column.name} className={`block text-sm font-semibold text-[var(--brand-ink)] ${isWideField ? "md:col-span-2" : ""}`}>
                      <span className="flex items-center justify-between gap-3">
                        <span>{column.name}</span>
                        <span className="text-[11px] uppercase tracking-[0.16em] text-[color:color-mix(in_srgb,var(--brand-ink)_50%,white)]">{column.type}</span>
                      </span>
                      {column.type === "boolean" ? (
                        <span className="mt-2 inline-flex items-center gap-3 rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 py-3 text-sm text-[var(--brand-ink)]">
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
                          className="mt-2 h-11 w-full rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 text-sm text-[var(--brand-ink)] outline-none focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                        >
                          <option value="">Select</option>
                          {(column.options || []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : selectOptions ? (
                        <select
                          value={value ?? ""}
                          disabled={disabled || selectOptions.length === 0}
                          onChange={(event) => updateSelectedField(column, event.target.value)}
                          className="mt-2 h-11 w-full rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 text-sm text-[var(--brand-ink)] outline-none focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="">
                            {selectOptions.length === 0 ? relationEmptyMessage(column.name) : "Select"}
                          </option>
                          {selectOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : isWideField ? (
                        <textarea
                          rows="4"
                          value={column.type === "json" || column.type === "jsonb"
                            ? (value ? JSON.stringify(value, null, 2) : "")
                            : String(value ?? "")}
                          disabled={disabled}
                          onChange={(event) => updateSelectedField(column, event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 py-3 text-sm text-[var(--brand-ink)] outline-none focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                        />
                      ) : (
                        <input
                          type={column.type === "bigint" || column.type === "integer" ? "number" : column.type === "timestamptz" ? "datetime-local" : "text"}
                          value={column.type === "timestamptz" ? timestampValueForInput(value) : String(value ?? "")}
                          disabled={disabled}
                          onChange={(event) => updateSelectedField(column, event.target.value)}
                          className="mt-2 h-11 w-full rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-shell)] px-4 text-sm text-[var(--brand-ink)] outline-none focus:border-[var(--brand-orange)] focus:ring-4 focus:ring-[rgba(247,134,57,0.14)]"
                        />
                      )}
                      {!column.editable ? <p className="mt-1 text-xs text-[color:color-mix(in_srgb,var(--brand-ink)_50%,white)]">Server-managed field</p> : null}
                    </label>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-[var(--brand-line)] pt-4">
                <button type="submit" disabled={!selectedRow} className="inline-flex h-11 items-center justify-center rounded-2xl bg-[var(--brand-ink)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--brand-orange)] disabled:cursor-not-allowed disabled:opacity-50">
                  Save Changes
                </button>
                <button type="button" onClick={() => {
                  if (isCreating && activeTableMeta) {
                    setCreateDefaults();
                    return;
                  }
                  setSelectedRow(resettableSelectedRow ? JSON.parse(JSON.stringify(resettableSelectedRow)) : null);
                }} className="inline-flex h-11 items-center justify-center rounded-2xl border border-[var(--brand-line)] px-5 text-sm font-semibold text-[var(--brand-ink)] transition hover:border-[var(--brand-orange)] hover:bg-[var(--brand-shell)]">
                  Reset
                </button>
                <button type="button" onClick={deleteRow} disabled={isCreating || !selectedIdentifier} className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#fecaca] px-5 text-sm font-semibold text-[#b42318] transition hover:bg-[#fff1f1] disabled:cursor-not-allowed disabled:opacity-50">
                  Delete Row
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
