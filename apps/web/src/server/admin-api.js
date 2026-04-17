import {
  getWriteClient,
  getServiceClient,
  writeAuditLog,
  runBestEffort,
  asNumber,
  displayColorName,
  dedupeColorList,
  getAdminTableConfig,
  listAdminTables,
} from "./api-utils.js";

export function formatAdminIdentifier(tableConfig, row) {
  return tableConfig.primaryKey.reduce((acc, key) => {
    acc[key] = row?.[key] ?? null;
    return acc;
  }, {});
}

export function applyAdminIdentifierFilter(query, tableConfig, identifier) {
  let nextQuery = query;
  for (const key of tableConfig.primaryKey) {
    if (!Object.prototype.hasOwnProperty.call(identifier || {}, key)) {
      throw new Error(`Missing identifier field: ${key}`);
    }
    nextQuery = nextQuery.eq(key, identifier[key]);
  }
  return nextQuery;
}

function parseAdminBoolean(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseAdminTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp value: ${value}`);
  }
  return parsed.toISOString();
}

function parseAdminJson(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    throw new Error("Invalid JSON value");
  }
}

export function parseAdminColumnValue(columnName, columnConfig, rawValue) {
  if (rawValue === undefined) {
    return Object.prototype.hasOwnProperty.call(columnConfig, "defaultValue")
      ? columnConfig.defaultValue
      : undefined;
  }

  switch (columnConfig.type) {
    case "boolean":
      return parseAdminBoolean(rawValue);
    case "bigint":
    case "integer": {
      if (rawValue === null || rawValue === "") return null;
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid numeric value for ${columnName}`);
      }
      return parsed;
    }
    case "json":
    case "jsonb":
      return parseAdminJson(rawValue);
    case "timestamptz":
      return parseAdminTimestamp(rawValue);
    case "enum": {
      if (rawValue === null || rawValue === "") return null;
      const normalized = String(rawValue).trim();
      if (!columnConfig.options?.includes(normalized)) {
        throw new Error(`Invalid value for ${columnName}`);
      }
      return normalized;
    }
    default:
      return rawValue === null || rawValue === undefined || rawValue === "" ? null : String(rawValue);
  }
}

export function sanitizeAdminIdentifier(tableConfig, rawIdentifier) {
  return tableConfig.primaryKey.reduce((acc, key) => {
    const columnConfig = tableConfig.columns[key] || { type: "text" };
    const nextValue = parseAdminColumnValue(key, columnConfig, rawIdentifier?.[key]);
    if (nextValue === undefined || nextValue === null || nextValue === "") {
      throw new Error(`Missing identifier field: ${key}`);
    }
    acc[key] = nextValue;
    return acc;
  }, {});
}

export function sanitizeAdminWriteValues(tableConfig, rawValues, mode) {
  const values = {};

  for (const [columnName, columnConfig] of Object.entries(tableConfig.columns)) {
    if (columnConfig.editable === false) continue;
    const parsed = parseAdminColumnValue(columnName, columnConfig, rawValues?.[columnName]);
    if (parsed === undefined) continue;
    if (mode === "insert" && parsed === null && !columnConfig.required && !Object.prototype.hasOwnProperty.call(rawValues || {}, columnName)) {
      continue;
    }
    values[columnName] = parsed;
  }

  return values;
}

export async function createAdminUser(client, rawValues, options = {}) {
  const serviceClient = getServiceClient();
  if (!serviceClient) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to invite users");
  }

  const email = String(rawValues?.email || "").trim().toLowerCase();
  const fullName = String(rawValues?.full_name || "").trim();
  const systemRole = String(rawValues?.system_role || "").trim();
  const companyId = asNumber(rawValues?.company_id);
  const active = rawValues?.active === undefined ? true : Boolean(rawValues.active);

  if (!email) {
    throw new Error("Email is required");
  }
  if (!["super_admin", "manager", "status_user"].includes(systemRole)) {
    throw new Error("A valid system role is required");
  }

  const redirectTo = options.origin ? `${options.origin}/set-password` : undefined;
  const { data: invitedUser, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo,
      data: fullName ? { full_name: fullName } : undefined,
    },
  );

  if (inviteError) throw inviteError;
  if (!invitedUser?.user?.id) {
    throw new Error("Supabase did not return a user id for the invite");
  }

  const profilePayload = {
    id: invitedUser.user.id,
    email,
    full_name: fullName || null,
    system_role: systemRole,
    company_id: companyId,
    active,
  };

  const { data: profileRow, error: profileError } = await getWriteClient(client)
    .from("profiles")
    .upsert(profilePayload, { onConflict: "id" })
    .select("*")
    .single();

  if (profileError) throw profileError;

  return {
    row: {
      ...profileRow,
      _identifier: formatAdminIdentifier(getAdminTableConfig("profiles"), profileRow),
    },
  };
}

export function fetchAdminMeta() {
  return {
    tables: listAdminTables(),
  };
}

export async function createColorLookupRow(client, rawName) {
  const writeClient = getWriteClient(client);
  const name = displayColorName(rawName);
  if (!name) {
    const error = new Error("Color name is required");
    error.statusCode = 400;
    throw error;
  }

  const { data: existing, error: existingError } = await writeClient
    .from("colors")
    .select("id,name,active")
    .ilike("name", name)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id) {
    if (existing.active !== true) {
      const { data: reactivated, error: updateError } = await writeClient
        .from("colors")
        .update({ active: true, name })
        .eq("id", existing.id)
        .select("id,name,active")
        .single();

      if (updateError) throw updateError;
      return {
        ...reactivated,
        name: displayColorName(reactivated?.name),
      };
    }

    return {
      ...existing,
      name: displayColorName(existing?.name),
    };
  }

  const { data: created, error: createError } = await writeClient
    .from("colors")
    .insert({ name, active: true })
    .select("id,name,active")
    .single();

  if (createError) throw createError;

  return {
    ...created,
    name: displayColorName(created?.name),
  };
}

export async function fetchAdminTableRows(client, tableName, searchParams) {
  const tableConfig = getAdminTableConfig(tableName);
  if (!tableConfig) {
    throw new Error("Unknown admin table");
  }

  const limit = Math.min(Math.max(asNumber(searchParams.get("limit")) || 100, 1), 500);
  const offset = Math.max(asNumber(searchParams.get("offset")) || 0, 0);
  const orderBy = tableConfig.orderBy || tableConfig.primaryKey[0];

  const { data, error, count } = await getWriteClient(client)
    .from(tableName)
    .select("*", { count: "exact" })
    .order(orderBy, { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  return {
    table: tableName,
    meta: listAdminTables().find((entry) => entry.name === tableName) || null,
    total: count ?? null,
    rows: (data || []).map((row) => ({
      ...row,
      _identifier: formatAdminIdentifier(tableConfig, row),
    })),
  };
}

export async function createAdminRow(client, tableName, rawValues) {
  const tableConfig = getAdminTableConfig(tableName);
  if (!tableConfig) {
    throw new Error("Unknown admin table");
  }

  const values = sanitizeAdminWriteValues(tableConfig, rawValues || {}, "insert");
  const { data, error } = await getWriteClient(client)
    .from(tableName)
    .insert(values)
    .select("*")
    .single();

  if (error) throw error;

  return {
    row: {
      ...data,
      _identifier: formatAdminIdentifier(tableConfig, data),
    },
  };
}

export async function updateAdminRow(client, tableName, rawIdentifier, rawValues) {
  const tableConfig = getAdminTableConfig(tableName);
  if (!tableConfig) {
    throw new Error("Unknown admin table");
  }

  const identifier = sanitizeAdminIdentifier(tableConfig, rawIdentifier || {});
  const values = sanitizeAdminWriteValues(tableConfig, rawValues || {}, "update");
  if (Object.keys(values).length === 0) {
    throw new Error("No editable fields provided");
  }

  const query = getWriteClient(client)
    .from(tableName)
    .update(values)
    .select("*");
  const { data, error } = await applyAdminIdentifierFilter(query, tableConfig, identifier).single();

  if (error) throw error;

  return {
    row: {
      ...data,
      _identifier: formatAdminIdentifier(tableConfig, data),
    },
  };
}

export async function deleteAdminRow(client, tableName, rawIdentifier) {
  const tableConfig = getAdminTableConfig(tableName);
  if (!tableConfig) {
    throw new Error("Unknown admin table");
  }

  const identifier = sanitizeAdminIdentifier(tableConfig, rawIdentifier || {});
  const query = getWriteClient(client)
    .from(tableName)
    .delete()
    .select("*");
  const { data, error } = await applyAdminIdentifierFilter(query, tableConfig, identifier).single();

  if (error) throw error;

  return {
    row: {
      ...data,
      _identifier: formatAdminIdentifier(tableConfig, data),
    },
  };
}
