import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getAdminTableConfig, listAdminTables } from "./adminDbConfig.js";
import { compareThicknessLabels } from "./thicknessOrder.js";

export const VALID_STATUSES = new Set(["available", "hold", "sold", "pending_approval"]);
export const REMNANT_SELECT = `
  id,
  moraware_remnant_id,
  company_id,
  material_id,
  thickness_id,
  finish_id,
  parent_slab_id,
  name,
  width,
  height,
  l_shape,
  l_width,
  l_height,
  status,
  inventory_hold,
  location,
  image,
  source_image_url,
  updated_at,
  created_at,
  deleted_at,
  stone_product_id,
  company:companies(id,name),
  material:materials(id,name),
  thickness:thicknesses(id,name),
  finish:finishes(id,name)
`;
export const REMNANT_WITH_STONE_SELECT = `
  ${REMNANT_SELECT},
  stone_product:stone_products(
    id,
    brand_name,
    stone_product_colors(
      role,
      color:colors(id,name)
    )
  )
`;
export const HOLD_SELECT = `
  id,
  remnant_id,
  company_id,
  hold_owner_user_id,
  hold_started_at,
  expires_at,
  status,
  customer_name,
  notes,
  job_number,
  released_at,
  released_by_user_id,
  reassigned_from_user_id,
  created_at,
  updated_at,
  hold_owner:profiles!hold_owner_user_id(id,email,full_name,system_role,company_id)
`;
export const SALE_SELECT = `
  id,
  remnant_id,
  company_id,
  sold_by_user_id,
  sold_at,
  job_number,
  notes,
  created_at,
  updated_at,
  sold_by_profile:profiles!sold_by_user_id(id,email,full_name,email)
`;
// ─── Supabase client factories ───────────────────────────────────────────────

function requireEnv(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function envConfig() {
  return {
    url: requireEnv(process.env.SUPABASE_URL, "SUPABASE_URL is required"),
    anonKey: requireEnv(
      process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY,
      "SUPABASE_ANON_KEY or SUPABASE_KEY is required",
    ),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

function createSupabaseClient(key, accessToken) {
  const { url } = envConfig();
  return createClient(url, key, {
    accessToken: accessToken ? async () => accessToken : undefined,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}

export function getPublicReadClient() {
  const { anonKey } = envConfig();
  return createSupabaseClient(anonKey);
}

export function getServiceClient() {
  const { serviceRoleKey } = envConfig();
  return serviceRoleKey ? createSupabaseClient(serviceRoleKey) : null;
}

export function getReadClient() {
  return getServiceClient() || getPublicReadClient();
}

export function getWriteClient(authedClient) {
  return getServiceClient() || authedClient;
}

function getAuthedClient(accessToken) {
  const { anonKey } = envConfig();
  return createSupabaseClient(anonKey, accessToken);
}

// ─── Auth cookie helpers ──────────────────────────────────────────────────────

function authError(message, clearCookie = false, status = 401) {
  const response = NextResponse.json({ error: message }, { status });
  if (clearCookie) {
    clearAuthCookies(response);
  }
  return response;
}

function authCookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge,
    path: "/",
  };
}

export function setSessionCookies(response, session) {
  if (!response || !session?.access_token) return response;

  const accessTokenMaxAge = Math.max(Number(session.expires_in) || 3600, 60);
  response.cookies.set("access_token", session.access_token, authCookieOptions(accessTokenMaxAge));

  if (session.refresh_token) {
    response.cookies.set("refresh_token", session.refresh_token, authCookieOptions(60 * 60 * 24 * 30));
  }

  return response;
}

export function clearAuthCookies(response) {
  if (!response) return response;

  response.cookies.set("access_token", "", authCookieOptions(0));
  response.cookies.set("refresh_token", "", authCookieOptions(0));
  return response;
}

export function applyAuthCookies(response, authContext) {
  if (!authContext?.refreshedSession) return response;
  return setSessionCookies(response, authContext.refreshedSession);
}

// ─── Auth context ─────────────────────────────────────────────────────────────

export async function fetchProfile(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .select("id,email,full_name,system_role,company_id,active")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createOptionalAuthedContext(request, allowedRoles = []) {
  const accessToken = request.cookies.get("access_token")?.value;
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (!accessToken && !refreshToken) return null;

  let token = accessToken || "";
  let user = null;
  let refreshedSession = null;

  if (token) {
    const publicClient = getPublicReadClient();
    const { data, error } = await publicClient.auth.getUser(token);
    if (!error && data?.user) {
      user = data.user;
    }
  }

  if (!user && refreshToken) {
    const publicClient = getPublicReadClient();
    const { data, error } = await publicClient.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (!error && data?.session?.access_token) {
      token = data.session.access_token;
      refreshedSession = data.session;
      const { data: refreshedUserData, error: refreshedUserError } =
        await publicClient.auth.getUser(token);
      if (!refreshedUserError && refreshedUserData?.user) {
        user = refreshedUserData.user;
      }
    }
  }

  if (!user || !token) return null;

  const client = getAuthedClient(token);
  const profile = await fetchProfile(client, user.id);
  if (!profile || profile.active !== true) return null;
  if (allowedRoles.length > 0 && !allowedRoles.includes(profile.system_role)) return null;

  return {
    client,
    user,
    profile,
    refreshedSession,
  };
}

export async function createRequiredAuthedContext(request, allowedRoles = []) {
  const accessToken = request.cookies.get("access_token")?.value;
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (!accessToken && !refreshToken) {
    return { errorResponse: authError("Not authenticated") };
  }

  let token = accessToken || "";
  let user = null;
  let refreshedSession = null;

  if (token) {
    const publicClient = getPublicReadClient();
    const { data, error } = await publicClient.auth.getUser(token);
    if (!error && data?.user) {
      user = data.user;
    }
  }

  if (!user && refreshToken) {
    const publicClient = getPublicReadClient();
    const { data, error } = await publicClient.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (!error && data?.session?.access_token) {
      token = data.session.access_token;
      refreshedSession = data.session;
      const { data: refreshedUserData, error: refreshedUserError } =
        await publicClient.auth.getUser(token);
      if (!refreshedUserError && refreshedUserData?.user) {
        user = refreshedUserData.user;
      }
    }
  }

  if (!user || !token) {
    return { errorResponse: authError("Invalid session", true) };
  }

  const client = getAuthedClient(token);
  const profile = await fetchProfile(client, user.id);
  if (!profile) {
    return { errorResponse: NextResponse.json({ error: "Profile not found" }, { status: 403 }) };
  }
  if (profile.active !== true) {
    return { errorResponse: NextResponse.json({ error: "Your account is inactive" }, { status: 403 }) };
  }
  if (allowedRoles.length > 0 && !allowedRoles.includes(profile.system_role)) {
    return {
      errorResponse: NextResponse.json(
        { error: `Only ${allowedRoles.join(" or ")} can perform this action` },
        { status: 403 },
      ),
    };
  }

  return {
    client,
    user,
    profile,
    refreshedSession,
  };
}

// ─── Lookup exports ───────────────────────────────────────────────────────────

export async function fetchLookupRows(tableName, client = getReadClient()) {
  const { data, error } = await client
    .from(tableName)
    .select("id,name,active")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) throw error;
  if (tableName === "thicknesses") {
    return (data || []).slice().sort((a, b) => compareThicknessLabels(a?.name, b?.name));
  }
  if (tableName === "colors") {
    const seen = new Set();
    return (data || []).reduce((rows, row) => {
      const normalizedName = normalizeColorName(row?.name);
      const key = normalizedName.toLowerCase();
      if (!normalizedName || seen.has(key)) return rows;
      seen.add(key);
      rows.push({
        ...row,
        name: normalizedName,
      });
      return rows;
    }, []);
  }
  return data || [];
}

export async function fetchStoneProductLookupRows(client = getReadClient()) {
  const { data, error } = await client
    .from("stone_products")
    .select(`
      id,
      material_id,
      display_name,
      stone_name,
      brand_name,
      active,
      stone_product_colors(
        role,
        color:colors(id,name)
      )
    `)
    .eq("active", true)
    .order("display_name", { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    material_id: row.material_id,
    display_name: row.display_name,
    stone_name: row.stone_name,
    brand_name: row.brand_name || "",
    colors: dedupeColorList(extractStoneProductColors(row).colors),
    ...extractStoneProductColors(row),
  }));
}

export async function fetchSalesRepRows(client = getReadClient()) {
  const { data, error } = await client
    .from("profiles")
    .select("id,email,full_name,system_role,company_id")
    .eq("active", true)
    .order("full_name", { ascending: true });

  if (error) throw error;
  return (data || [])
    .filter((row) => row.system_role === "status_user")
    .map((row) => ({
      ...row,
      display_name: row.full_name || row.email || "User",
    }));
}

export async function fetchNextStoneId(client = getReadClient()) {
  const { data, error } = await client
    .from("remnants")
    .select("moraware_remnant_id")
    .not("moraware_remnant_id", "is", null)
    .order("moraware_remnant_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data?.moraware_remnant_id || 0) + 1;
}

export async function fetchInventorySummary(client = getPublicReadClient(), source = "active_remnants") {
  const { data, error } = await client
    .from(source)
    .select("status");

  if (error) throw error;

  return (data || []).reduce(
    (acc, row) => {
      const status = normalizeStatus(row?.status, "available");
      acc.total += 1;
      acc[status] += 1;
      return acc;
    },
    { total: 0, available: 0, hold: 0, sold: 0 },
  );
}

export async function fetchLookupPayload(request, authContext = null) {
  if (String(new URL(request.url).searchParams.get("public") || "") === "1") {
    const { fetchPublicLookupRows } = await import("@/server/public-api");
    return fetchPublicLookupRows();
  }

  const requiredAuthed = authContext || await createRequiredAuthedContext(request);
  if (requiredAuthed?.errorResponse) {
    const error = new Error("Not authenticated");
    error.statusCode = 401;
    throw error;
  }

  const lookupClient = getWriteClient(requiredAuthed.client);

  const [companies, suppliers, materials, thicknesses, finishes, colors, stone_products] = await Promise.all([
    fetchLookupRows("companies", lookupClient),
    fetchLookupRows("suppliers", lookupClient),
    fetchLookupRows("materials", lookupClient),
    fetchLookupRows("thicknesses", lookupClient),
    fetchLookupRows("finishes", lookupClient),
    fetchLookupRows("colors", lookupClient),
    fetchStoneProductLookupRows(lookupClient),
  ]);

  return {
    companies,
    suppliers,
    materials,
    thicknesses,
    finishes,
    colors,
    stone_products,
  };
}

export async function fetchAuditLogs(client, searchParams) {
  const limit = Math.min(asNumber(searchParams.get("limit")) || 50, 200);
  let query = getWriteClient(client)
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  const remnantId = asNumber(searchParams.get("remnant_id"));
  if (remnantId) query = query.eq("remnant_id", remnantId);

  const eventType = String(searchParams.get("event_type") || "").trim();
  if (eventType) query = query.eq("event_type", eventType);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function proxyImage(target) {
  const normalizedTarget = String(target || "").trim();
  if (!normalizedTarget || !isAllowedImageProxyTarget(normalizedTarget)) {
    const error = new Error("Invalid image URL");
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch(normalizedTarget);
  if (!response.ok) {
    const error = new Error("Failed to fetch image");
    error.statusCode = response.status;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  return {
    contentType,
    buffer: Buffer.from(arrayBuffer),
  };
}

// ─── Admin table config re-exports ───────────────────────────────────────────

export { getAdminTableConfig, listAdminTables };

// ─── Data normalizers ─────────────────────────────────────────────────────────

export function asNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseMeasurement(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const normalized = String(value || "")
    .trim()
    .replace(/[""]/g, "")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) return null;

  const direct = Number(normalized);
  if (Number.isFinite(direct)) return direct;

  const mixedFractionMatch = /^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/.exec(normalized);
  if (mixedFractionMatch) {
    const whole = Number(mixedFractionMatch[1]);
    const numerator = Number(mixedFractionMatch[2]);
    const denominator = Number(mixedFractionMatch[3]);
    if (Number.isFinite(whole) && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return whole + numerator / denominator;
    }
  }

  const fractionMatch = /^(\d+)\s*\/\s*(\d+)$/.exec(normalized);
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator;
    }
  }

  return null;
}

export function normalizeStatus(value, fallback = "available") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "on hold") return "hold";
  if (VALID_STATUSES.has(normalized)) return normalized;
  return fallback;
}

export function escapeLikeValue(value) {
  return String(value || "").replace(/[,%]/g, "");
}

export function extractRemnantIdSearch(value) {
  const trimmed = String(value || "").trim();
  const match = /^#?\s*(\d+)$/.exec(trimmed);
  return match ? Number(match[1]) : null;
}

export function normalizePriceValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parsePricePerSqft(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value)
    .trim()
    .replace(/\$/g, "")
    .replace(/,/g, "");
  if (!normalized) return null;

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Number(numeric.toFixed(4));
}

export function dedupeStringList(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value) return false;
      const normalized = value.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export function normalizeColorName(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const key = normalized.toLowerCase();
  if (key === "white-cool" || key === "white-warm") return "White";
  if (key === "gray-light" || key === "gray-dark") return "Gray";
  return normalized;
}

export function displayColorName(value) {
  const normalized = normalizeColorName(value);
  if (!normalized) return "";
  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function dedupeColorList(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeColorName(value))
    .filter((value) => {
      if (!value) return false;
      const normalized = value.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export function sanitizeExternalHttpUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch (_error) {
    return "";
  }
}

export function cleanPathSegment(value, fallback = "file") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || fallback;
}

// ─── Stone product helpers ────────────────────────────────────────────────────

export function extractStoneProductColors(row) {
  const colorRows = Array.isArray(row?.stone_product?.stone_product_colors)
    ? row.stone_product.stone_product_colors
    : [];
  const colors = dedupeColorList(colorRows.map((item) => item?.color?.name));

  return {
    colors,
    primary_colors: colors,
    accent_colors: [],
  };
}

// DECOUPLED: while remnants stabilizes, no longer fall back to colors on the
// shared stone_products table. A remnant displays only its own colors. Restore
// the lookup body when re-merging slabs and remnants.
export function withSharedStoneColorFallback(rows, _stoneProducts) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const colors = dedupeColorList([
      ...(Array.isArray(row?.colors) ? row.colors : []),
      ...(Array.isArray(row?.primary_colors) ? row.primary_colors : []),
      ...(Array.isArray(row?.accent_colors) ? row.accent_colors : []),
    ]);
    return {
      ...row,
      colors,
      primary_colors: colors,
      accent_colors: [],
    };
  });
}

function normalizeStoneLookupKeyPart(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function stoneProductLookupKey(materialId, stoneName) {
  const numericMaterialId = Number(materialId);
  const normalizedName = normalizeStoneLookupKeyPart(stoneName);
  if (!Number.isFinite(numericMaterialId) || !normalizedName) return "";
  return `${numericMaterialId}:${normalizedName}`;
}

export async function ensureStoneProduct(writeClient, payload, existingStoneProductId = null) {
  const brandName = String(payload?.brand_name || "").trim() || null;
  if (existingStoneProductId) {
    if (brandName !== null) {
      const { error: updateError } = await writeClient
        .from("stone_products")
        .update({ brand_name: brandName })
        .eq("id", existingStoneProductId);

      if (updateError) throw updateError;
    }
    return existingStoneProductId;
  }
  if (!payload?.material_id || !payload?.name) return null;

  const displayName = String(payload.name || "").trim();
  if (!displayName) return null;

  const normalizedDisplayName = normalizeStoneLookupKeyPart(displayName);

  const { data: existing, error: existingError } = await writeClient
    .from("stone_products")
    .select("id")
    .eq("material_id", payload.material_id)
    .eq("normalized_name", normalizedDisplayName)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await writeClient
    .from("stone_products")
    .upsert(
      {
        material_id: payload.material_id,
        display_name: displayName,
        stone_name: displayName,
        brand_name: brandName,
        active: true,
      },
      { onConflict: "material_id,normalized_name", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (createError) throw createError;
  if (created?.id) return created.id;

  const { data: conflict, error: conflictError } = await writeClient
    .from("stone_products")
    .select("id")
    .eq("material_id", payload.material_id)
    .eq("normalized_name", normalizedDisplayName)
    .maybeSingle();

  if (conflictError) throw conflictError;
  return conflict?.id || null;
}

export async function replaceStoneProductColors(writeClient, stoneProductId, colorNamesByRole) {
  if (!stoneProductId) return;

  const allNames = dedupeColorList([
    ...(Array.isArray(colorNamesByRole?.colors) ? colorNamesByRole.colors : []),
    ...(Array.isArray(colorNamesByRole?.primary_colors) ? colorNamesByRole.primary_colors : []),
    ...(Array.isArray(colorNamesByRole?.accent_colors) ? colorNamesByRole.accent_colors : []),
  ]);

  let colorRows = [];
  if (allNames.length) {
    const { data, error } = await writeClient
      .from("colors")
      .select("id,name")
      .in("name", allNames);

    if (error) throw error;
    colorRows = data || [];
  }

  const colorIdByName = new Map(colorRows.map((row) => [row.name, row.id]));
  const missingNames = allNames.filter((name) => !colorIdByName.has(name));
  if (missingNames.length) {
    throw new Error(`Unknown colors: ${missingNames.join(", ")}`);
  }

  const { error: deleteError } = await writeClient
    .from("stone_product_colors")
    .delete()
    .eq("stone_product_id", stoneProductId);

  if (deleteError) throw deleteError;

  const rowsToInsert = [
    ...allNames.map((name) => ({
      stone_product_id: stoneProductId,
      color_id: colorIdByName.get(name),
      role: "primary",
    })),
  ];

  if (!rowsToInsert.length) return;

  const { error: insertError } = await writeClient
    .from("stone_product_colors")
    .insert(rowsToInsert);

  if (insertError) throw insertError;
}

// ─── Remnant formatters and helpers ──────────────────────────────────────────

export function formatRemnant(row) {
  if (!row) return row;
  const normalizedColors = dedupeColorList([
    ...(Array.isArray(row.colors) ? row.colors : []),
    ...(Array.isArray(row.primary_colors) ? row.primary_colors : []),
    ...(Array.isArray(row.accent_colors) ? row.accent_colors : []),
  ]);
  return {
    ...row,
    display_id: row.moraware_remnant_id || row.id,
    company_name: row.company?.name || "",
    material_name: row.material?.name || "",
    thickness_name: row.thickness?.name || "",
    finish_name: row.finish?.name || row.finish_name || "",
    brand_name: row.stone_product?.brand_name || row.brand_name || "",
    price_per_sqft: row.price_per_sqft ?? null,
    colors: normalizedColors,
    primary_colors: normalizedColors,
    accent_colors: [],
  };
}

export async function fetchRemnantStatusRow(client, remnantId) {
  const { data, error } = await client
    .from("remnants")
    .select("id,moraware_remnant_id,company_id,status,deleted_at,name,image,image_path")
    .eq("id", remnantId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchMaterialIdsByNames(names) {
  if (!Array.isArray(names) || names.length === 0) return [];

  const { data, error } = await getReadClient()
    .from("materials")
    .select("id,name")
    .in("name", names);

  if (error) throw error;
  return (data || []).map((row) => row.id).filter((id) => id !== null && id !== undefined);
}

export function filterFormattedRowsByMaterial(rows, materialIds = [], materialNames = []) {
  const normalizedIds = [...new Set((materialIds || []).map((value) => Number(value)).filter(Number.isFinite))];
  const normalizedNames = [...new Set(
    (materialNames || []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean),
  )];

  if (normalizedIds.length === 0 && normalizedNames.length === 0) {
    return Array.isArray(rows) ? rows : [];
  }

  const allowedIdSet = new Set(normalizedIds);
  const allowedNameSet = new Set(normalizedNames);

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const rowMaterialId = Number(row?.material_id);
    const rowMaterialName = String(row?.material_name || row?.material?.name || "").trim().toLowerCase();
    return (allowedIdSet.size > 0 && allowedIdSet.has(rowMaterialId))
      || (allowedNameSet.size > 0 && allowedNameSet.has(rowMaterialName));
  });
}

export async function fetchStoneProductIdsByBrandSearch(client, search) {
  const brandSearch = String(search || "").trim();
  if (!brandSearch) return [];

  const { data, error } = await client
    .from("stone_products")
    .select("id")
    .ilike("brand_name", `%${escapeLikeValue(brandSearch)}%`)
    .eq("active", true)
    .limit(200);

  if (error) throw error;
  return [...new Set((data || []).map((row) => Number(row.id)).filter(Boolean))];
}

export async function fetchStoneProductIdsByColorSearch(client, search) {
  const colorSearch = String(search || "").trim();
  if (!colorSearch) return [];

  const { data, error } = await client
    .from("stone_product_colors")
    .select("stone_product_id,color:colors!inner(name)")
    .ilike("color.name", `%${escapeLikeValue(colorSearch)}%`)
    .limit(200);

  if (error) throw error;
  return [...new Set((data || []).map((row) => Number(row.stone_product_id)).filter(Boolean))];
}

export async function fetchRemnantIdsByFinishSearch(client, search) {
  const finishSearch = String(search || "").trim();
  if (!finishSearch) return [];

  const { data, error } = await client
    .from("remnants")
    .select("id,finish:finishes!inner(name)")
    .is("deleted_at", null)
    .ilike("finish.name", `%${escapeLikeValue(finishSearch)}%`)
    .limit(200);

  if (error) throw error;
  return [...new Set((data || []).map((row) => Number(row.id)).filter(Boolean))];
}

export function normalizePayload(body) {
  const parsed = {
    name: body.name ? String(body.name).trim() : "",
    brand_name: body.brand_name ? String(body.brand_name).trim() : "",
    moraware_remnant_id: asNumber(body.moraware_remnant_id ?? body.external_id),
    company_id: asNumber(body.company_id),
    material_id: asNumber(body.material_id),
    thickness_id: asNumber(body.thickness_id),
    finish_id: asNumber(body.finish_id),
    width: parseMeasurement(body.width),
    height: parseMeasurement(body.height),
    l_shape: Boolean(body.l_shape),
    l_width: parseMeasurement(body.l_width),
    l_height: parseMeasurement(body.l_height),
    colors: dedupeColorList(
      Array.isArray(body.colors) && body.colors.length
        ? body.colors
        : [...(Array.isArray(body.primary_colors) ? body.primary_colors : []), ...(Array.isArray(body.accent_colors) ? body.accent_colors : [])],
    ),
    price_per_sqft: parsePricePerSqft(body.price_per_sqft),
    status: normalizeStatus(body.status),
  };

  parsed.primary_colors = parsed.colors;
  parsed.accent_colors = [];

  if (!parsed.l_shape) {
    parsed.l_width = null;
    parsed.l_height = null;
  }

  return parsed;
}

export function validateRemnantPayload(payload) {
  if (!payload.name || !payload.company_id || !payload.material_id || !payload.thickness_id) {
    return "Company, material, thickness, and stone name are required";
  }
  if (!payload.width || !payload.height) {
    return "Width and height are required";
  }
  return null;
}

// ─── Pricing helpers ──────────────────────────────────────────────────────────

const PRICE_BAND_START = 10;
const PRICE_BAND_SIZE = 5;

function bandSortOrderFromPrice(pricePerSqft) {
  const normalizedPrice = parsePricePerSqft(pricePerSqft);
  if (normalizedPrice === null) return null;
  if (normalizedPrice <= PRICE_BAND_START) return 0;
  return Math.floor((normalizedPrice - PRICE_BAND_START) / PRICE_BAND_SIZE);
}

function codeFromSortOrder(index) {
  let value = Number(index);
  if (!Number.isInteger(value) || value < 0) return null;

  let code = "";
  do {
    code = String.fromCharCode(65 + (value % 26)) + code;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return code;
}

function describePriceBand(pricePerSqft) {
  const sortOrder = bandSortOrderFromPrice(pricePerSqft);
  if (sortOrder === null) return null;

  const minPrice = Number((PRICE_BAND_START + sortOrder * PRICE_BAND_SIZE).toFixed(4));
  const maxPrice = Number((minPrice + PRICE_BAND_SIZE - 0.0001).toFixed(4));

  return {
    code: codeFromSortOrder(sortOrder),
    sortOrder,
    minPrice,
    maxPrice,
  };
}

function formatPriceBandUpperBound(value) {
  const rounded = Math.floor(Number(value) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function chooseBestSlabPrice(remnant, priceRows = []) {
  const normalizedRows = (Array.isArray(priceRows) ? priceRows : [])
    .filter((row) => row?.active !== false)
    .map((row) => ({
      ...row,
      list_price_per_sqft: normalizePriceValue(row?.list_price_per_sqft),
      finish_id: asNumber(row?.finish_id),
      thickness_id: asNumber(row?.thickness_id),
    }))
    .filter((row) => row.list_price_per_sqft !== null);

  if (!normalizedRows.length) return null;

  const remnantFinishId = asNumber(remnant?.finish_id);
  const remnantThicknessId = asNumber(remnant?.thickness_id);

  const exactMatch = normalizedRows.find(
    (row) =>
      (row.finish_id === null || remnantFinishId === null || row.finish_id === remnantFinishId) &&
      (row.thickness_id === null || remnantThicknessId === null || row.thickness_id === remnantThicknessId),
  );
  if (exactMatch) return exactMatch.list_price_per_sqft;

  const finishMatch = normalizedRows.find(
    (row) => row.finish_id !== null && remnantFinishId !== null && row.finish_id === remnantFinishId,
  );
  if (finishMatch) return finishMatch.list_price_per_sqft;

  const thicknessMatch = normalizedRows.find(
    (row) => row.thickness_id !== null && remnantThicknessId !== null && row.thickness_id === remnantThicknessId,
  );
  if (thicknessMatch) return thicknessMatch.list_price_per_sqft;

  return normalizedRows[0]?.list_price_per_sqft ?? null;
}

// DECOUPLED: while remnants stabilizes, this no longer reaches into
// slab_supplier_prices. Each remnant displays only its own price_per_sqft.
// Restore the slab-fallback body when re-merging slabs and remnants.
export async function withRemnantPriceFallback(_client, rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    price_per_sqft: normalizePriceValue(row?.price_per_sqft),
  }));
}

async function findCompanyName(writeClient, companyId) {
  const numericCompanyId = asNumber(companyId);
  if (numericCompanyId === null) return "";

  const { data, error } = await writeClient
    .from("companies")
    .select("name")
    .eq("id", numericCompanyId)
    .maybeSingle();

  if (error) throw error;
  return String(data?.name || "").trim();
}

async function findSupplierIdForExistingSlab(writeClient, slabId) {
  const numericSlabId = asNumber(slabId);
  if (numericSlabId === null) return null;

  const { data, error } = await writeClient
    .from("slabs")
    .select("supplier_id")
    .eq("id", numericSlabId)
    .maybeSingle();

  if (error) throw error;
  return asNumber(data?.supplier_id);
}

async function ensureSupplierForManualPrice(writeClient, remnant, payload) {
  const existingSupplierId = await findSupplierIdForExistingSlab(writeClient, remnant?.parent_slab_id);
  if (existingSupplierId !== null) return existingSupplierId;

  const candidateNames = dedupeStringList([
    payload?.brand_name,
    await findCompanyName(writeClient, payload?.company_id),
  ]);

  for (const name of candidateNames) {
    const { data, error } = await writeClient
      .from("suppliers")
      .select("id,name")
      .ilike("name", name)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data?.id) return asNumber(data.id);
  }

  const fallbackName = candidateNames[0];
  if (!fallbackName) return null;

  const { data: created, error: createError } = await writeClient
    .from("suppliers")
    .insert({
      name: fallbackName,
      active: true,
      notes: "Created from manage remnant pricing editor",
    })
    .select("id")
    .single();

  if (createError) throw createError;
  return asNumber(created?.id);
}

async function ensureManualPriceTier(writeClient, supplierId, materialId, pricePerSqft) {
  const numericSupplierId = asNumber(supplierId);
  const numericMaterialId = asNumber(materialId);
  const normalizedPrice = parsePricePerSqft(pricePerSqft);
  const band = describePriceBand(normalizedPrice);
  if (numericSupplierId === null || numericMaterialId === null || normalizedPrice === null || !band?.code) return null;

  const { data: existing, error: existingError } = await writeClient
    .from("supplier_price_tiers")
    .select("id")
    .eq("supplier_id", numericSupplierId)
    .eq("material_id", numericMaterialId)
    .eq("code", band.code)
    .eq("fixed_fee_per_sqft", 0)
    .eq("fee_percent_1", 0)
    .eq("fee_percent_2", 0)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id) return asNumber(existing.id);

  const { data: created, error: createError } = await writeClient
    .from("supplier_price_tiers")
    .insert({
      supplier_id: numericSupplierId,
      material_id: numericMaterialId,
      code: band.code,
      sort_order: band.sortOrder,
      base_price_per_sqft: band.minPrice,
      min_price_per_sqft: band.minPrice,
      max_price_per_sqft: band.maxPrice,
      fixed_fee_per_sqft: 0,
      fee_percent_1: 0,
      fee_percent_2: 0,
      notes: `Manual price band $${band.minPrice}-${formatPriceBandUpperBound(band.maxPrice)}.`,
    })
    .select("id")
    .single();

  if (createError) throw createError;
  return asNumber(created?.id);
}

async function ensureSlabMetadataLinks(writeClient, slabId, payload) {
  const numericSlabId = asNumber(slabId);
  if (numericSlabId === null) return;

  const numericThicknessId = asNumber(payload?.thickness_id);
  if (numericThicknessId !== null) {
    const { error } = await writeClient
      .from("slab_thicknesses")
      .upsert(
        { slab_id: numericSlabId, thickness_id: numericThicknessId },
        { onConflict: "slab_id,thickness_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  }

  const numericFinishId = asNumber(payload?.finish_id);
  if (numericFinishId !== null) {
    const { error } = await writeClient
      .from("slab_finishes")
      .upsert(
        { slab_id: numericSlabId, finish_id: numericFinishId },
        { onConflict: "slab_id,finish_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  }
}

async function ensureSlabForManualPrice(writeClient, remnant, payload, supplierId) {
  const numericSupplierId = asNumber(supplierId);
  const numericMaterialId = asNumber(payload?.material_id);
  if (numericSupplierId === null || numericMaterialId === null || !payload?.name) {
    return asNumber(remnant?.parent_slab_id);
  }

  let slabId = asNumber(remnant?.parent_slab_id);

  if (slabId === null) {
    const { data: existing, error: existingError } = await writeClient
      .from("slabs")
      .select("id")
      .eq("supplier_id", numericSupplierId)
      .eq("material_id", numericMaterialId)
      .eq("name", payload.name)
      .eq("active", true)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    slabId = asNumber(existing?.id);
  }

  if (slabId === null) {
    const { data: created, error: createError } = await writeClient
      .from("slabs")
      .insert({
        supplier_id: numericSupplierId,
        material_id: numericMaterialId,
        name: payload.name,
        detail_url: `manual://remnant/${remnant.id}/${cleanPathSegment(payload.name, "stone")}`,
        image_url: sanitizeExternalHttpUrl(remnant?.image || remnant?.source_image_url || ""),
        active: true,
      })
      .select("id")
      .single();

    if (createError) throw createError;
    slabId = asNumber(created?.id);
  }

  if (slabId !== null && asNumber(remnant?.parent_slab_id) !== slabId) {
    const { error: linkError } = await writeClient
      .from("remnants")
      .update({ parent_slab_id: slabId })
      .eq("id", remnant.id);

    if (linkError) throw linkError;
  }

  if (slabId !== null) {
    await ensureSlabMetadataLinks(writeClient, slabId, payload);
  }

  return slabId;
}

// DECOUPLED: while remnants stabilizes, manual price edits no longer create
// supplier rows, synthetic slab rows, or slab_supplier_prices entries. The
// remnant's own price_per_sqft is still persisted by parseRemnantPayload /
// createRemnant / updateRemnant. Restore the slab-write body when re-merging.
export async function upsertRemnantManualPrice(_writeClient, remnant, _payload) {
  return asNumber(remnant?.parent_slab_id);
}

// ─── Image helpers ────────────────────────────────────────────────────────────

function parseDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;

  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function extensionForType(contentType, fallbackName = "") {
  const fileExt = fallbackName.includes(".") ? fallbackName.split(".").pop() : "";
  if (fileExt) return fileExt.toLowerCase();

  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };

  return map[contentType] || "jpg";
}

function buildImagePath(imageKey, ext) {
  return `remnant_${cleanPathSegment(imageKey)}.${ext}`;
}

export function isAllowedImageProxyTarget(value) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const supabaseHostname = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname : null;
    const morawareHostname = process.env.MORAWARE_URL ? new URL(process.env.MORAWARE_URL).hostname : null;
    return [
      supabaseHostname,
      morawareHostname,
      "www.gramaco.com",
      "gramaco.com",
    ].filter(Boolean).includes(parsed.hostname);
  } catch (_error) {
    return false;
  }
}

export async function uploadImageIfPresent(client, imageKey, imageFile) {
  if (!imageFile) return null;

  let buffer;
  let contentType;
  let fileName = "";

  if (typeof Blob !== "undefined" && imageFile instanceof Blob) {
    buffer = Buffer.from(await imageFile.arrayBuffer());
    contentType = imageFile.type || "application/octet-stream";
    fileName = imageFile.name || "";
  } else if (imageFile?.dataUrl) {
    const parsed = parseDataUrl(imageFile.dataUrl);
    if (!parsed) {
      throw new Error("Invalid image upload format");
    }
    buffer = parsed.buffer;
    contentType = parsed.contentType;
    fileName = imageFile.name || "";
  } else {
    return null;
  }

  const ext = extensionForType(contentType, fileName);
  const imagePath = buildImagePath(imageKey, ext);
  const bucket = process.env.SUPABASE_BUCKET || "remnant-images";

  const { error: uploadError } = await client.storage.from(bucket).upload(imagePath, buffer, {
    contentType,
    upsert: true,
  });

  if (uploadError) throw uploadError;

  const { data } = client.storage.from(bucket).getPublicUrl(imagePath);
  return {
    image: data.publicUrl,
    image_path: imagePath,
  };
}

// ─── Hold helpers ─────────────────────────────────────────────────────────────

export function formatHold(row) {
  if (!row) return null;
  return {
    ...row,
    owner_name: row.hold_owner?.full_name || row.hold_owner?.email || "",
    owner_email: row.hold_owner?.email || "",
    customer_name: row.customer_name || "",
  };
}

export function formatSale(row) {
  if (!row) return null;
  return {
    ...row,
    sold_by_name: row.sold_by_profile?.full_name || row.sold_by_profile?.email || "",
  };
}

function pickRelevantHold(rows) {
  const candidates = Array.isArray(rows) ? rows : [];
  const visibleCandidates = candidates.filter((row) =>
    ["active", "expired"].includes(String(row?.status || "").toLowerCase()),
  );
  if (visibleCandidates.length === 0) return null;

  const priority = { active: 0, expired: 1 };
  return [...visibleCandidates].sort((a, b) => {
    const aPriority = priority[a.status] ?? 99;
    const bPriority = priority[b.status] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  })[0] || null;
}

export function defaultHoldExpirationDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt.toISOString().slice(0, 10);
}

export async function fetchRelevantHoldMap(client, remnantIds) {
  const ids = [...new Set((remnantIds || []).map((value) => Number(value)).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await client
    .from("holds")
    .select(HOLD_SELECT)
    .in("remnant_id", ids)
    .in("status", ["active", "expired", "sold", "released"])
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const grouped = new Map();
  (data || []).forEach((row) => {
    const list = grouped.get(row.remnant_id) || [];
    list.push(formatHold(row));
    grouped.set(row.remnant_id, list);
  });

  const result = new Map();
  grouped.forEach((rows, remnantId) => {
    result.set(remnantId, pickRelevantHold(rows));
  });
  return result;
}

export async function fetchRelevantHoldForRemnant(client, remnantId) {
  const holdMap = await fetchRelevantHoldMap(client, [remnantId]);
  return holdMap.get(Number(remnantId)) || null;
}

export async function fetchLatestSaleMap(client, remnantIds) {
  const ids = [...new Set((remnantIds || []).map((value) => Number(value)).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await client
    .from("remnant_sales")
    .select(SALE_SELECT)
    .in("remnant_id", ids)
    .order("sold_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const result = new Map();
  (data || []).forEach((row) => {
    const remnantId = Number(row.remnant_id);
    if (!remnantId || result.has(remnantId)) return;
    result.set(remnantId, formatSale(row));
  });
  return result;
}

export async function fetchStatusActorMap(client, remnantIds) {
  const ids = [...new Set((remnantIds || []).map((value) => Number(value)).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await client
    .from("audit_logs")
    .select("remnant_id,actor_user_id,actor_email,new_data,created_at")
    .eq("event_type", "remnant_status_changed")
    .in("remnant_id", ids)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const result = new Map();
  (data || []).forEach((row) => {
    const remnantId = Number(row.remnant_id);
    if (!remnantId || result.has(remnantId)) return;
    const nextStatus = String(row.new_data?.status || "").trim().toLowerCase();
    result.set(remnantId, {
      status: nextStatus,
      actor_user_id: row.actor_user_id || null,
      actor_name: row.actor_email ? String(row.actor_email).split("@")[0] : "",
      actor_email: row.actor_email || "",
    });
  });

  return result;
}

export async function fetchLatestSaleForRemnant(client, remnantId) {
  const saleMap = await fetchLatestSaleMap(client, [remnantId]);
  return saleMap.get(Number(remnantId)) || null;
}

export function attachHoldToRows(rows, holdMap) {
  return (rows || []).map((row) => ({
    ...row,
    current_hold: holdMap.get(Number(row.internal_remnant_id ?? row.id)) || null,
  }));
}

export function attachSaleToRows(rows, saleMap) {
  return (rows || []).map((row) => {
    const currentSale = saleMap.get(Number(row.internal_remnant_id ?? row.id)) || null;
    return {
      ...row,
      current_sale: currentSale,
      sold_by_name: currentSale?.sold_by_name || "",
      sold_by_user_id: currentSale?.sold_by_user_id || null,
      sold_at: currentSale?.sold_at || null,
      sold_job_number: currentSale?.job_number || "",
    };
  });
}

export function attachStatusMetaToRows(rows, statusActorMap) {
  return (rows || []).map((row) => ({
    ...row,
    current_status_actor: statusActorMap.get(Number(row.internal_remnant_id ?? row.id)) || null,
  }));
}

// ─── Permission helpers ───────────────────────────────────────────────────────

export function isPrivilegedProfile(profile) {
  return profile?.system_role === "super_admin" || profile?.system_role === "manager";
}

export function isOwnCompanyStatusUser(profile, remnant) {
  return profile?.system_role === "status_user"
    && profile?.company_id !== null
    && Number(profile.company_id) === Number(remnant?.company_id);
}

export function ensureHoldPermission(profile, remnant, hold) {
  if (isPrivilegedProfile(profile)) return;
  if (!isOwnCompanyStatusUser(profile, remnant)) {
    throw new Error("Only the hold owner, manager, or super admin can change this held remnant");
  }
  if (hold && String(hold.hold_owner_user_id) !== String(profile.id)) {
    throw new Error("Only the original sales rep can change this held remnant");
  }
}

export function ensureSalePermission(profile, remnant, sale) {
  if (isPrivilegedProfile(profile)) return;
  if (!isOwnCompanyStatusUser(profile, remnant)) {
    throw new Error("Only the original sales rep, manager, or super admin can change this sold remnant");
  }
  if (sale && String(sale.sold_by_user_id || "") !== String(profile.id)) {
    throw new Error("Only the original sales rep can change this sold remnant");
  }
}

// ─── Audit / notification ─────────────────────────────────────────────────────

export async function writeAuditLog(client, authed, entry) {
  if (!client) return;

  const payload = {
    actor_user_id: authed?.user?.id || authed?.profile?.id || null,
    actor_email: authed?.profile?.email || authed?.user?.email || null,
    actor_role: authed?.profile?.system_role || null,
    actor_company_id: authed?.profile?.company_id || null,
    event_type: entry.event_type,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id ?? null,
    remnant_id: entry.remnant_id ?? null,
    company_id: entry.company_id ?? null,
    message: entry.message ?? null,
    old_data: entry.old_data ?? null,
    new_data: entry.new_data ?? null,
    meta: entry.meta ?? null,
  };

  const { error } = await client.from("audit_logs").insert(payload);
  if (error) {
    console.error("Audit log write failed:", error);
  }
}

export async function queueNotification(client, entry) {
  if (!client) return;

  const payload = {
    notification_type: entry.notification_type,
    target_user_id: entry.target_user_id ?? null,
    target_email: entry.target_email ?? null,
    remnant_id: entry.remnant_id ?? null,
    hold_id: entry.hold_id ?? null,
    hold_request_id: entry.hold_request_id ?? null,
    payload: entry.payload ?? {},
    scheduled_for: entry.scheduled_for ?? new Date().toISOString(),
    status: entry.status ?? "pending",
  };

  const { error } = await client.from("notification_queue").insert(payload);
  if (error) {
    console.error("Notification queue write failed:", error);
  }
}

export function runBestEffort(task, label) {
  void (async () => {
    try {
      await task();
    } catch (error) {
      console.error(`${label} failed:`, error);
    }
  })();
}

export async function cancelPendingHoldNotifications(client, holdId) {
  if (!client || !holdId) return;

  const { error } = await client
    .from("notification_queue")
    .update({ status: "cancelled" })
    .eq("hold_id", holdId)
    .eq("status", "pending");

  if (error) {
    console.error("Failed to cancel pending hold notifications:", error);
  }
}

export async function scheduleHoldNotifications(client, hold) {
  if (!client || !hold?.id) return;

  const expiresAt = new Date(hold.expires_at);
  if (Number.isNaN(expiresAt.getTime())) return;

  const reminders = [
    { daysBefore: 2, notification_type: "hold_expiring_soon_2d" },
    { daysBefore: 1, notification_type: "hold_expiring_soon_1d" },
  ];

  for (const reminder of reminders) {
    const scheduledFor = new Date(expiresAt.getTime() - reminder.daysBefore * 24 * 60 * 60 * 1000);
    if (scheduledFor.getTime() > Date.now()) {
      await queueNotification(client, {
        notification_type: reminder.notification_type,
        target_user_id: hold.hold_owner_user_id,
        target_email: hold.owner_email || hold.hold_owner?.email || null,
        remnant_id: hold.remnant_id,
        hold_id: hold.id,
        scheduled_for: scheduledFor.toISOString(),
        payload: {
          remnant_id: hold.remnant_id,
          expires_at: hold.expires_at,
          job_number: hold.job_number || null,
        },
      });
    }
  }

  await queueNotification(client, {
    notification_type: "hold_expired",
    target_user_id: hold.hold_owner_user_id,
    target_email: hold.owner_email || hold.hold_owner?.email || null,
    remnant_id: hold.remnant_id,
    hold_id: hold.id,
    scheduled_for: hold.expires_at,
    payload: {
      remnant_id: hold.remnant_id,
      expires_at: hold.expires_at,
      job_number: hold.job_number || null,
    },
  });
}
