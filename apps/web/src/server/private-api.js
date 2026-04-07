import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { getAdminTableConfig, listAdminTables } = require("./adminDbConfig.js");
const VALID_STATUSES = new Set(["available", "hold", "sold"]);
const REMNANT_SELECT = `
  id,
  moraware_remnant_id,
  company_id,
  material_id,
  thickness_id,
  finish_id,
  name,
  width,
  height,
  l_shape,
  l_width,
  l_height,
  status,
  image,
  source_image_url,
  updated_at,
  created_at,
  stone_product_id,
  company:companies(id,name),
  material:materials(id,name),
  thickness:thicknesses(id,name),
  finish:finishes(id,name)
`;
const HOLD_SELECT = `
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
const SALE_SELECT = `
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

const requireEnv = (value, message) => {
  if (!value) {
    throw new Error(message);
  }
  return value;
};

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

function getPublicReadClient() {
  const { anonKey } = envConfig();
  return createSupabaseClient(anonKey);
}

function getServiceClient() {
  const { serviceRoleKey } = envConfig();
  return serviceRoleKey ? createSupabaseClient(serviceRoleKey) : null;
}

function getReadClient() {
  return getServiceClient() || getPublicReadClient();
}

function getWriteClient(authedClient) {
  return getServiceClient() || authedClient;
}

function getAuthedClient(accessToken) {
  const { anonKey } = envConfig();
  return createSupabaseClient(anonKey, accessToken);
}

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

function normalizeStatus(value, fallback = "available") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "on hold") return "hold";
  if (VALID_STATUSES.has(normalized)) return normalized;
  return fallback;
}

function escapeLikeValue(value) {
  return String(value || "").replace(/[,%]/g, "");
}

function extractRemnantIdSearch(value) {
  const trimmed = String(value || "").trim();
  const match = /^#?\s*(\d+)$/.exec(trimmed);
  return match ? Number(match[1]) : null;
}

function formatRemnant(row) {
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
    colors: normalizedColors,
    primary_colors: normalizedColors,
    accent_colors: [],
  };
}

function formatHold(row) {
  if (!row) return null;
  return {
    ...row,
    owner_name: row.hold_owner?.full_name || row.hold_owner?.email || "",
    owner_email: row.hold_owner?.email || "",
    customer_name: row.customer_name || "",
  };
}

function formatSale(row) {
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

function defaultHoldExpirationDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt.toISOString().slice(0, 10);
}

async function fetchRelevantHoldMap(client, remnantIds) {
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

async function fetchRelevantHoldForRemnant(client, remnantId) {
  const holdMap = await fetchRelevantHoldMap(client, [remnantId]);
  return holdMap.get(Number(remnantId)) || null;
}

async function fetchLatestSaleMap(client, remnantIds) {
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

async function fetchStatusActorMap(client, remnantIds) {
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

function attachHoldToRows(rows, holdMap) {
  return (rows || []).map((row) => ({
    ...row,
    current_hold: holdMap.get(Number(row.internal_remnant_id ?? row.id)) || null,
  }));
}

function attachSaleToRows(rows, saleMap) {
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

function attachStatusMetaToRows(rows, statusActorMap) {
  return (rows || []).map((row) => ({
    ...row,
    current_status_actor: statusActorMap.get(Number(row.internal_remnant_id ?? row.id)) || null,
  }));
}

function isPrivilegedProfile(profile) {
  return profile?.system_role === "super_admin" || profile?.system_role === "manager";
}

function isOwnCompanyStatusUser(profile, remnant) {
  return profile?.system_role === "status_user"
    && profile?.company_id !== null
    && Number(profile.company_id) === Number(remnant?.company_id);
}

function ensureHoldPermission(profile, remnant, hold) {
  if (isPrivilegedProfile(profile)) return;
  if (!isOwnCompanyStatusUser(profile, remnant)) {
    throw new Error("Only the hold owner, manager, or super admin can change this held remnant");
  }
  if (hold && String(hold.hold_owner_user_id) !== String(profile.id)) {
    throw new Error("Only the original sales rep can change this held remnant");
  }
}

function ensureSalePermission(profile, remnant, sale) {
  if (isPrivilegedProfile(profile)) return;
  if (!isOwnCompanyStatusUser(profile, remnant)) {
    throw new Error("Only the original sales rep, manager, or super admin can change this sold remnant");
  }
  if (sale && String(sale.sold_by_user_id || "") !== String(profile.id)) {
    throw new Error("Only the original sales rep can change this sold remnant");
  }
}

async function fetchRemnantStatusRow(client, remnantId) {
  const { data, error } = await client
    .from("remnants")
    .select("id,moraware_remnant_id,company_id,status,deleted_at,name,image,image_path")
    .eq("id", remnantId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function fetchMaterialIdsByNames(names) {
  if (!Array.isArray(names) || names.length === 0) return [];

  const { data, error } = await getReadClient()
    .from("materials")
    .select("id,name")
    .in("name", names);

  if (error) throw error;
  return (data || []).map((row) => row.id).filter((id) => id !== null && id !== undefined);
}

async function fetchLatestSaleForRemnant(client, remnantId) {
  const saleMap = await fetchLatestSaleMap(client, [remnantId]);
  return saleMap.get(Number(remnantId)) || null;
}

function filterFormattedRowsByMaterial(rows, materialIds = [], materialNames = []) {
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

export async function fetchLookupRows(tableName, client = getReadClient()) {
  const { data, error } = await client
    .from(tableName)
    .select("id,name,active")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) throw error;
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

async function fetchStoneProductIdsByBrandSearch(client, search) {
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

async function fetchStoneProductIdsByColorSearch(client, search) {
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

async function fetchRemnantIdsByFinishSearch(client, search) {
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

export async function fetchSalesRepRows(client = getReadClient(), options = {}) {
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

  const [companies, materials, thicknesses, finishes, colors, stone_products] = await Promise.all([
    fetchLookupRows("companies", lookupClient),
    fetchLookupRows("materials", lookupClient),
    fetchLookupRows("thicknesses", lookupClient),
    fetchLookupRows("finishes", lookupClient),
    fetchLookupRows("colors", lookupClient),
    fetchStoneProductLookupRows(lookupClient),
  ]);

  return {
    companies,
    materials,
    thicknesses,
    finishes,
    colors,
    stone_products,
  };
}

export async function fetchPrivateRemnants(request, authContext = null) {
  const searchParams = new URL(request.url).searchParams;
  const materialFilters = searchParams.getAll("material");
  const materialIds = materialFilters.map(asNumber).filter((value) => value !== null);
  const materialNames = materialFilters
    .map((value) => String(value || "").trim())
    .filter((value) => value && asNumber(value) === null);
  const stone = String(searchParams.get("stone") || "").trim();
  const stoneLike = escapeLikeValue(stone);
  const searchedRemnantId = extractRemnantIdSearch(stone);
  const status = normalizeStatus(searchParams.get("status"), "");
  const minWidth = asNumber(searchParams.get("min-width") ?? searchParams.get("minWidth"));
  const minHeight = asNumber(searchParams.get("min-height") ?? searchParams.get("minHeight"));
  const shouldEnrich = String(searchParams.get("enrich") || "1") !== "0";

  const requiredAuthed =
    authContext ||
    await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (requiredAuthed?.errorResponse) {
    const error = new Error("Not authenticated");
    error.statusCode = 401;
    throw error;
  }

  let resolvedMaterialIds = [...materialIds];
  let query = requiredAuthed.client
    .from("remnants")
    .select(`
      ${REMNANT_SELECT},
      stone_product:stone_products(
        id,
        brand_name,
        stone_product_colors(
          role,
          color:colors(id,name)
        )
      )
    `)
    .is("deleted_at", null)
    .order("moraware_remnant_id", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (materialIds.length > 0) {
    query = query.in("material_id", materialIds);
  } else if (materialNames.length > 0) {
    const materialNameIds = await fetchMaterialIdsByNames(materialNames);
    if (materialNameIds.length === 0) return [];
    resolvedMaterialIds = materialNameIds;
    query = query.in("material_id", materialNameIds);
  }
  const [brandMatchedStoneProductIds, colorMatchedStoneProductIds, finishMatchedRemnantIds] = stone
    ? await Promise.all([
        fetchStoneProductIdsByBrandSearch(getWriteClient(requiredAuthed.client), stone),
        fetchStoneProductIdsByColorSearch(getWriteClient(requiredAuthed.client), stone),
        fetchRemnantIdsByFinishSearch(getWriteClient(requiredAuthed.client), stone),
      ])
    : [[], [], []];
  const matchedStoneProductIds = [...new Set([...brandMatchedStoneProductIds, ...colorMatchedStoneProductIds])];
  if (stone && searchedRemnantId !== null) {
    const orFilters = [`name.ilike.%${stoneLike}%`, `moraware_remnant_id.eq.${searchedRemnantId}`];
    if (matchedStoneProductIds.length) {
      orFilters.push(`stone_product_id.in.(${matchedStoneProductIds.join(",")})`);
    }
    if (finishMatchedRemnantIds.length) {
      orFilters.push(`id.in.(${finishMatchedRemnantIds.join(",")})`);
    }
    query = query.or(orFilters.join(","));
  } else if (stone) {
    if (matchedStoneProductIds.length || finishMatchedRemnantIds.length) {
      const orFilters = [`name.ilike.%${stoneLike}%`];
      if (matchedStoneProductIds.length) {
        orFilters.push(`stone_product_id.in.(${matchedStoneProductIds.join(",")})`);
      }
      if (finishMatchedRemnantIds.length) {
        orFilters.push(`id.in.(${finishMatchedRemnantIds.join(",")})`);
      }
      query = query.or(orFilters.join(","));
    } else {
      query = query.ilike("name", `%${stoneLike}%`);
    }
  }
  if (status) query = query.eq("status", status);
  if (minWidth !== null) query = query.gte("width", minWidth);
  if (minHeight !== null) query = query.gte("height", minHeight);

  const { data, error } = await query;
  if (error) throw error;

  const formattedRows = filterFormattedRowsByMaterial(
    (data || []).map((row) => formatRemnant({
      ...row,
      ...extractStoneProductColors(row),
    })),
    resolvedMaterialIds,
    materialNames,
  );
  const needsSharedColorFallback = formattedRows.some(
    (row) => !dedupeColorList(row.colors).length,
  );
  const rowsWithSharedColors = needsSharedColorFallback
    ? withSharedStoneColorFallback(formattedRows, await fetchStoneProductLookupRows(getWriteClient(requiredAuthed.client)))
    : formattedRows;
  if (!shouldEnrich) return rowsWithSharedColors;

  const remnantIds = rowsWithSharedColors.map((row) => row.id);
  const writeClient = getWriteClient(requiredAuthed.client);
  const [holdMap, saleMap, statusActorMap] = await Promise.all([
    fetchRelevantHoldMap(writeClient, remnantIds),
    fetchLatestSaleMap(writeClient, remnantIds),
    fetchStatusActorMap(writeClient, remnantIds),
  ]);

  return attachStatusMetaToRows(attachSaleToRows(attachHoldToRows(rowsWithSharedColors, holdMap), saleMap), statusActorMap);
}

export async function fetchRemnantEnrichment(request, ids, authContext = null) {
  const numericIds = Array.isArray(ids)
    ? [...new Set(ids.map(asNumber).filter((value) => value !== null))]
    : [];

  if (numericIds.length === 0) return [];

  const requiredAuthed =
    authContext ||
    await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (requiredAuthed?.errorResponse) {
    const error = new Error("Not authenticated");
    error.statusCode = 401;
    throw error;
  }

  const writeClient = getWriteClient(requiredAuthed.client);
  const [holdMap, saleMap, statusActorMap] = await Promise.all([
    fetchRelevantHoldMap(writeClient, numericIds),
    fetchLatestSaleMap(writeClient, numericIds),
    fetchStatusActorMap(writeClient, numericIds),
  ]);

  return numericIds.map((remnantId) => {
    const currentSale = saleMap.get(Number(remnantId)) || null;
    return {
      remnant_id: Number(remnantId),
      current_hold: holdMap.get(Number(remnantId)) || null,
      current_sale: currentSale,
      sold_by_name: currentSale?.sold_by_name || "",
      sold_by_user_id: currentSale?.sold_by_user_id || null,
      sold_at: currentSale?.sold_at || null,
      sold_job_number: currentSale?.job_number || "",
      current_status_actor: statusActorMap.get(Number(remnantId)) || null,
    };
  });
}

export async function fetchHoldRequests(client, profile, searchParams) {
  const limit = Math.min(asNumber(searchParams.get("limit")) || 100, 300);
  let query = getWriteClient(client)
    .from("hold_requests")
    .select(`
      *,
      remnant:remnants!remnant_id(
        id,
        moraware_remnant_id,
        company_id,
        name,
        status,
        image,
        source_image_url,
        width,
        height,
        l_shape,
        l_width,
        l_height,
        material:materials!material_id(name)
      ),
      sales_rep:profiles!sales_rep_user_id(id,email,full_name),
      reviewed_by:profiles!reviewed_by_user_id(id,email,full_name)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  const status = String(searchParams.get("status") || "").trim();
  if (status) query = query.eq("status", status);
  if (profile.system_role === "status_user") {
    query = query.eq("sales_rep_user_id", profile.id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => {
    const remnant = row.remnant || {};
    return {
      ...row,
      remnant: {
        ...remnant,
        display_id: remnant.moraware_remnant_id || remnant.id,
        material_name: remnant.material?.name || "",
        image: remnant.image || "",
        source_image_url: remnant.source_image_url || "",
      },
    };
  });
}

export async function fetchMyHolds(client, profile) {
  const writeClient = getWriteClient(client);
  const { data, error } = await writeClient
    .from("holds")
    .select(`
      id,
      remnant_id,
      company_id,
      hold_owner_user_id,
      hold_started_at,
      expires_at,
      status,
      notes,
      job_number,
      released_at,
      released_by_user_id,
      reassigned_from_user_id,
      created_at,
      updated_at,
      remnant:remnants!remnant_id(
        id,
        moraware_remnant_id,
        company_id,
        name,
        status,
        image,
        source_image_url,
        width,
        height,
        l_shape,
        l_width,
        l_height,
        material:materials!material_id(name)
      )
    `)
    .eq("hold_owner_user_id", profile.id)
    .in("status", ["active", "expired"])
    .order("expires_at", { ascending: true });

  if (error) throw error;

  const holdRows = Array.isArray(data) ? data : [];
  const remnantIds = [...new Set(holdRows.map((row) => Number(row.remnant_id)).filter(Boolean))];
  const requestMap = new Map();

  if (remnantIds.length) {
    const { data: requestRows, error: requestError } = await writeClient
      .from("hold_requests")
      .select("id, remnant_id, requester_name, requester_email, notes, job_number, status, created_at")
      .eq("sales_rep_user_id", profile.id)
      .eq("status", "approved")
      .in("remnant_id", remnantIds)
      .order("created_at", { ascending: false });

    if (requestError) throw requestError;

    for (const row of requestRows || []) {
      const remnantId = Number(row.remnant_id);
      if (!requestMap.has(remnantId)) {
        requestMap.set(remnantId, row);
      }
    }
  }

  return holdRows.map((row) => {
    const remnant = row.remnant || {};
    const request = requestMap.get(Number(row.remnant_id)) || null;
    return {
      ...row,
      remnant: {
        ...remnant,
        display_id: remnant.moraware_remnant_id || remnant.id,
        material_name: remnant.material?.name || "",
      },
      requester_name: request?.requester_name || "",
      requester_email: request?.requester_email || "",
      requester_message: String(request?.notes || "").trim() || "",
      request_job_number: request?.job_number || "",
    };
  });
}

export async function updateHoldRequest(client, profile, requestId, body) {
  if (!requestId) {
    const error = new Error("Invalid hold request id");
    error.statusCode = 400;
    throw error;
  }

  const status = String(body?.status || "").trim().toLowerCase();
  if (!["pending", "approved", "rejected", "cancelled"].includes(status)) {
    const error = new Error("Invalid hold request status");
    error.statusCode = 400;
    throw error;
  }

  const writeClient = getWriteClient(client);
  const { data: existingRequest, error: requestError } = await writeClient
    .from("hold_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (requestError) throw requestError;
  if (!existingRequest) {
    const error = new Error("Hold request not found");
    error.statusCode = 404;
    throw error;
  }
  if (profile.system_role === "status_user" && String(existingRequest.sales_rep_user_id || "") !== String(profile.id)) {
    const error = new Error("You can only review your own hold requests");
    error.statusCode = 403;
    throw error;
  }

  if (status === "approved") {
    const remnant = await fetchRemnantStatusRow(writeClient, existingRequest.remnant_id);
    if (!remnant || remnant.deleted_at) {
      const error = new Error("Remnant not found");
      error.statusCode = 404;
      throw error;
    }
    if (String(remnant.status || "").toLowerCase() === "sold") {
      const error = new Error("Sold remnants cannot be placed on hold");
      error.statusCode = 400;
      throw error;
    }
    const currentHold = await fetchRelevantHoldForRemnant(writeClient, existingRequest.remnant_id);
    if (currentHold && ["active", "expired"].includes(String(currentHold.status || "").toLowerCase())) {
      const error = new Error("This remnant already has a hold");
      error.statusCode = 400;
      throw error;
    }

    const jobNumber = String(body?.job_number || existingRequest.job_number || "").trim();
    if (!jobNumber) {
      const error = new Error("Job number is required to approve a hold request");
      error.statusCode = 400;
      throw error;
    }

    const holdOwnerUserId = existingRequest.sales_rep_user_id || profile.id;
    const { data: approvalResult, error: approvalError } = await writeClient.rpc("approve_hold_request", {
      p_request_id: requestId,
      p_hold_owner_user_id: holdOwnerUserId,
      p_reviewed_by_user_id: profile.id,
      p_expires_at: new Date(defaultHoldExpirationDate()).toISOString(),
      p_job_number: jobNumber,
      p_notes: String(body?.notes || existingRequest.notes || "").trim() || null,
    });

    if (approvalError) throw approvalError;

    const approvalRow = Array.isArray(approvalResult) ? approvalResult[0] : approvalResult;
    if (!approvalRow?.hold_id) {
      throw new Error("Hold approval did not return a hold id");
    }
  }

  const updateResult = status === "approved"
    ? await writeClient
        .from("hold_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle()
    : await writeClient
        .from("hold_requests")
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          reviewed_by_user_id: profile.id,
          job_number: String(body?.job_number || existingRequest.job_number || "").trim() || null,
        })
        .eq("id", requestId)
        .select("*")
        .maybeSingle();

  const { data, error } = updateResult;
  if (error) throw error;
  if (!data) {
    const nextError = new Error("Hold request not found");
    nextError.statusCode = 404;
    throw nextError;
  }

  return data;
}

export async function saveHold(client, authed, remnantId, body) {
  if (!remnantId) {
    const error = new Error("Invalid remnant id");
    error.statusCode = 400;
    throw error;
  }

  const writeClient = getWriteClient(client);
  const remnant = await fetchRemnantStatusRow(writeClient, remnantId);
  if (!remnant || remnant.deleted_at) {
    const error = new Error("Remnant not found");
    error.statusCode = 404;
    throw error;
  }

  const currentHold = await fetchRelevantHoldForRemnant(writeClient, remnantId);
  const currentSale = await fetchLatestSaleForRemnant(writeClient, remnantId);
  if (!isPrivilegedProfile(authed.profile) && !isOwnCompanyStatusUser(authed.profile, remnant)) {
    const error = new Error("Not allowed to place a hold on this remnant");
    error.statusCode = 403;
    throw error;
  }
  if (String(remnant.status || "").toLowerCase() === "sold") {
    try {
      ensureSalePermission(authed.profile, remnant, currentSale);
    } catch (permissionError) {
      permissionError.statusCode = 403;
      throw permissionError;
    }
  }

  const requestedOwnerUserId = body?.hold_owner_user_id
    ? String(body.hold_owner_user_id).trim()
    : authed.profile.id;
  const holdPayload = {
    expires_at: body?.expires_at || defaultHoldExpirationDate(),
    customer_name: String(body?.customer_name || "").trim() || null,
    notes: String(body?.notes || "").trim() || null,
    job_number: String(body?.job_number || "").trim() || null,
  };

  if (!holdPayload.expires_at) {
    const error = new Error("Expiration date is required");
    error.statusCode = 400;
    throw error;
  }
  if (!holdPayload.job_number) {
    const error = new Error("Job number is required");
    error.statusCode = 400;
    throw error;
  }
  if (!holdPayload.customer_name) {
    const error = new Error("Customer name is required");
    error.statusCode = 400;
    throw error;
  }
  const expiresAt = new Date(holdPayload.expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    const error = new Error("Expiration date is invalid");
    error.statusCode = 400;
    throw error;
  }
  if (expiresAt.getTime() <= Date.now()) {
    const error = new Error("Expiration date must be in the future");
    error.statusCode = 400;
    throw error;
  }

  if (!isPrivilegedProfile(authed.profile) && requestedOwnerUserId !== authed.profile.id) {
    const error = new Error("You can only create holds for yourself");
    error.statusCode = 403;
    throw error;
  }

  const ownerProfile = await fetchProfile(writeClient, requestedOwnerUserId);
  if (!ownerProfile || ownerProfile.active !== true) {
    const error = new Error("Hold owner is not active");
    error.statusCode = 400;
    throw error;
  }

  let holdRow = null;
  let eventType = "hold_created";
  const oldHold = currentHold;

  if (currentHold && ["active", "expired"].includes(currentHold.status)) {
    ensureHoldPermission(authed.profile, remnant, currentHold);
    if (!isPrivilegedProfile(authed.profile) && requestedOwnerUserId !== currentHold.hold_owner_user_id) {
      const error = new Error("Only a manager or super admin can reassign a hold");
      error.statusCode = 403;
      throw error;
    }

    const { data, error } = await writeClient
      .from("holds")
      .update({
        hold_owner_user_id: requestedOwnerUserId,
        expires_at: holdPayload.expires_at,
        customer_name: holdPayload.customer_name,
        notes: holdPayload.notes,
        job_number: holdPayload.job_number,
        status: "active",
        reassigned_from_user_id:
          requestedOwnerUserId !== currentHold.hold_owner_user_id
            ? currentHold.hold_owner_user_id
            : currentHold.reassigned_from_user_id,
      })
      .eq("id", currentHold.id)
      .select(HOLD_SELECT)
      .single();

    if (error) throw error;
    holdRow = formatHold(data);
    eventType = requestedOwnerUserId !== currentHold.hold_owner_user_id ? "hold_reassigned" : "hold_renewed";
  } else {
    const { data, error } = await writeClient
      .from("holds")
      .insert({
        remnant_id: remnantId,
        company_id: remnant.company_id,
        hold_owner_user_id: requestedOwnerUserId,
        hold_started_at: new Date().toISOString(),
        expires_at: holdPayload.expires_at,
        status: "active",
        customer_name: holdPayload.customer_name,
        notes: holdPayload.notes,
        job_number: holdPayload.job_number,
      })
      .select(HOLD_SELECT)
      .single();

    if (error) throw error;
    holdRow = formatHold(data);
  }

  await writeClient.from("remnants").update({ status: "hold" }).eq("id", remnantId);

  runBestEffort(async () => {
    await cancelPendingHoldNotifications(writeClient, holdRow.id);
    await scheduleHoldNotifications(writeClient, holdRow);
    await writeAuditLog(writeClient, authed, {
      event_type: eventType,
      entity_type: "hold",
      entity_id: holdRow.id,
      remnant_id: remnantId,
      company_id: remnant.company_id,
      message: `${eventType.replaceAll("_", " ")} for remnant #${remnant.moraware_remnant_id || remnant.id}`,
      old_data: oldHold,
      new_data: holdRow,
      meta: {
        source: "api",
        override: isPrivilegedProfile(authed.profile) && String(requestedOwnerUserId) !== String(authed.profile.id),
      },
    });
  }, "Save hold sidecar");

  return { hold: holdRow };
}

export async function releaseHold(client, authed, holdId) {
  if (!holdId) {
    const error = new Error("Invalid hold id");
    error.statusCode = 400;
    throw error;
  }

  const writeClient = getWriteClient(client);
  const { data: holdRow, error: holdError } = await writeClient
    .from("holds")
    .select(HOLD_SELECT)
    .eq("id", holdId)
    .maybeSingle();

  if (holdError) throw holdError;
  if (!holdRow) {
    const error = new Error("Hold not found");
    error.statusCode = 404;
    throw error;
  }

  const remnant = await fetchRemnantStatusRow(writeClient, holdRow.remnant_id);
  ensureHoldPermission(authed.profile, remnant, holdRow);

  const { data, error } = await writeClient
    .from("holds")
    .update({
      status: "released",
      released_at: new Date().toISOString(),
      released_by_user_id: authed.profile.id,
    })
    .eq("id", holdId)
    .select(HOLD_SELECT)
    .single();

  if (error) throw error;
  await writeClient.from("remnants").update({ status: "available" }).eq("id", holdRow.remnant_id);

  runBestEffort(async () => {
    await cancelPendingHoldNotifications(writeClient, holdId);
    await writeAuditLog(writeClient, authed, {
      event_type: "hold_released",
      entity_type: "hold",
      entity_id: holdId,
      remnant_id: holdRow.remnant_id,
      company_id: holdRow.company_id,
      message: `Released hold for remnant #${remnant.moraware_remnant_id || remnant.id}`,
      old_data: formatHold(holdRow),
      new_data: formatHold(data),
      meta: {
        source: "api",
        override: isPrivilegedProfile(authed.profile)
          && String(holdRow.hold_owner_user_id) !== String(authed.profile.id),
      },
    });
  }, "Release hold sidecar");

  return { hold: formatHold(data) };
}

export async function createRemnant(client, authed, body) {
  const writeClient = getWriteClient(client);
  const payload = normalizePayload(body || {});
  const validationError = validateRemnantPayload(payload);
  if (validationError) {
    const error = new Error(validationError);
    error.statusCode = 400;
    throw error;
  }

  const stoneProductId = await ensureStoneProduct(writeClient, payload);
  const imageData = await uploadImageIfPresent(writeClient, payload.name || `new-${Date.now()}`, body?.image_file);
  const insertPayload = {
    moraware_remnant_id: payload.moraware_remnant_id,
    company_id: payload.company_id,
    material_id: payload.material_id,
    thickness_id: payload.thickness_id,
    finish_id: payload.finish_id,
    name: payload.name,
    width: payload.width,
    height: payload.height,
    l_shape: payload.l_shape,
    l_width: payload.l_width,
    l_height: payload.l_height,
    stone_product_id: stoneProductId,
    status: payload.status,
    hash: body?.hash ? String(body.hash).trim() : `manual:${Date.now()}`,
    deleted_at: null,
    ...(imageData || {}),
  };

  const { data, error } = await writeClient
    .from("remnants")
    .insert(insertPayload)
    .select(REMNANT_SELECT)
    .single();

  if (error) throw error;

  await replaceStoneProductColors(writeClient, stoneProductId, {
    colors: payload.colors,
  });

  const { data: refreshedData, error: refreshedError } = await writeClient
    .from("remnants")
    .select(`
      ${REMNANT_SELECT},
      stone_product:stone_products(
        id,
        brand_name,
        stone_product_colors(
          role,
          color:colors(id,name)
        )
      )
    `)
    .eq("id", data.id)
    .single();

  if (refreshedError) throw refreshedError;

  runBestEffort(async () => {
    await writeAuditLog(writeClient, authed, {
      event_type: "remnant_created",
      entity_type: "remnant",
      entity_id: refreshedData.id,
      remnant_id: refreshedData.id,
      company_id: refreshedData.company_id,
      message: `Created remnant #${refreshedData.moraware_remnant_id || refreshedData.id}`,
      new_data: refreshedData,
      meta: {
        source: "api",
        action: "create",
      },
    });
  }, "Create remnant audit");

  return formatRemnant({
    ...refreshedData,
    ...extractStoneProductColors(refreshedData),
  });
}

export async function updateRemnant(client, authed, remnantId, body) {
  if (!remnantId) {
    const error = new Error("Invalid remnant id");
    error.statusCode = 400;
    throw error;
  }

  const writeClient = getWriteClient(client);
  const payload = normalizePayload(body || {});
  const validationError = validateRemnantPayload(payload);
  if (validationError) {
    const error = new Error(validationError);
    error.statusCode = 400;
    throw error;
  }

  const { data: existingRemnant, error: existingError } = await writeClient
    .from("remnants")
    .select(REMNANT_SELECT)
    .eq("id", remnantId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (!existingRemnant) {
    const error = new Error("Remnant not found");
    error.statusCode = 404;
    throw error;
  }

  const imageData = await uploadImageIfPresent(writeClient, remnantId, body?.image_file);
  const reuseExistingStoneProduct =
    Number(existingRemnant.material_id) === Number(payload.material_id)
    && String(existingRemnant.name || "").trim() === String(payload.name || "").trim();
  const stoneProductId = await ensureStoneProduct(
    writeClient,
    payload,
    reuseExistingStoneProduct ? existingRemnant.stone_product_id : null,
  );
  const incomingStoneId = Object.prototype.hasOwnProperty.call(body || {}, "moraware_remnant_id")
    || Object.prototype.hasOwnProperty.call(body || {}, "external_id");
  const updatePayload = {
    company_id: payload.company_id,
    material_id: payload.material_id,
    thickness_id: payload.thickness_id,
    finish_id: payload.finish_id,
    name: payload.name,
    width: payload.width,
    height: payload.height,
    l_shape: payload.l_shape,
    l_width: payload.l_width,
    l_height: payload.l_height,
    stone_product_id: stoneProductId,
    ...(imageData || {}),
    moraware_remnant_id: incomingStoneId ? payload.moraware_remnant_id : existingRemnant.moraware_remnant_id,
  };

  const { data, error } = await writeClient
    .from("remnants")
    .update(updatePayload)
    .eq("id", remnantId)
    .select(REMNANT_SELECT)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const nextError = new Error("No remnant was updated. This usually means RLS blocked the write or the row was not found.");
    nextError.statusCode = 403;
    throw nextError;
  }

  await replaceStoneProductColors(writeClient, stoneProductId, {
    colors: payload.colors,
  });

  const { data: refreshedData, error: refreshedError } = await writeClient
    .from("remnants")
    .select(`
      ${REMNANT_SELECT},
      stone_product:stone_products(
        id,
        brand_name,
        stone_product_colors(
          role,
          color:colors(id,name)
        )
      )
    `)
    .eq("id", remnantId)
    .maybeSingle();

  if (refreshedError) throw refreshedError;
  if (!refreshedData) {
    const nextError = new Error("Remnant not found after update");
    nextError.statusCode = 404;
    throw nextError;
  }

  runBestEffort(async () => {
    await writeAuditLog(writeClient, authed, {
      event_type: "remnant_updated",
      entity_type: "remnant",
      entity_id: refreshedData.id,
      remnant_id: refreshedData.id,
      company_id: refreshedData.company_id,
      message: `Updated remnant #${refreshedData.moraware_remnant_id || refreshedData.id}`,
      old_data: existingRemnant,
      new_data: refreshedData,
      meta: {
        source: "api",
        action: "update",
      },
    });
  }, "Update remnant audit");

  return formatRemnant({
    ...refreshedData,
    ...extractStoneProductColors(refreshedData),
  });
}

export async function updateRemnantStatus(client, authed, remnantId, body) {
  if (!remnantId) {
    const error = new Error("Invalid remnant id");
    error.statusCode = 400;
    throw error;
  }

  const writeClient = getWriteClient(client);
  const status = normalizeStatus(body?.status);
  const soldJobNumber = String(body?.sold_job_number || "").trim();
  const soldNotes = String(body?.sold_notes || "").trim() || null;
  if (status === "hold") {
    const error = new Error("Use the hold workflow to place or renew holds");
    error.statusCode = 400;
    throw error;
  }
  if (status === "sold" && !soldJobNumber) {
    const error = new Error("Sold job number is required");
    error.statusCode = 400;
    throw error;
  }

  const existingRemnant = await fetchRemnantStatusRow(writeClient, remnantId);
  if (!existingRemnant) {
    const error = new Error("Remnant not found");
    error.statusCode = 404;
    throw error;
  }
  if (existingRemnant.deleted_at) {
    const error = new Error("Deleted remnants cannot change status");
    error.statusCode = 400;
    throw error;
  }
  if (!isPrivilegedProfile(authed.profile) && !isOwnCompanyStatusUser(authed.profile, existingRemnant)) {
    const error = new Error("Not allowed to update this remnant");
    error.statusCode = 403;
    throw error;
  }

  const currentHold = await fetchRelevantHoldForRemnant(writeClient, remnantId);
  let currentSale = await fetchLatestSaleForRemnant(writeClient, remnantId);
  if (currentHold && ["active", "expired"].includes(currentHold.status)) {
    ensureHoldPermission(authed.profile, existingRemnant, currentHold);
  }
  if (String(existingRemnant.status || "").toLowerCase() === "sold") {
    try {
      ensureSalePermission(authed.profile, existingRemnant, currentSale);
    } catch (permissionError) {
      permissionError.statusCode = 403;
      throw permissionError;
    }
  }

  let updatedHold = null;
  let holdStatusAuditTask = null;
  if (status === "available" && currentHold?.status === "active") {
    const { data: releasedHold, error: holdError } = await writeClient
      .from("holds")
      .update({
        status: "released",
        released_at: new Date().toISOString(),
        released_by_user_id: authed.profile.id,
      })
      .eq("id", currentHold.id)
      .select(HOLD_SELECT)
      .single();

    if (holdError) throw holdError;
    updatedHold = formatHold(releasedHold);
    holdStatusAuditTask = async () => {
      await cancelPendingHoldNotifications(writeClient, currentHold.id);
      await writeAuditLog(writeClient, authed, {
        event_type: "hold_released",
        entity_type: "hold",
        entity_id: currentHold.id,
        remnant_id: remnantId,
        company_id: existingRemnant.company_id,
        message: `Released hold for remnant #${existingRemnant.moraware_remnant_id || existingRemnant.id}`,
        old_data: currentHold,
        new_data: updatedHold,
        meta: {
          source: "api",
          action: "status_release",
          override: isPrivilegedProfile(authed.profile)
            && String(currentHold.hold_owner_user_id) !== String(authed.profile.id),
        },
      });
    };
  }

  if (status === "sold" && currentHold?.status && currentHold.status !== "sold") {
    const { data: soldHold, error: holdError } = await writeClient
      .from("holds")
      .update({
        status: "sold",
        released_at: new Date().toISOString(),
        released_by_user_id: authed.profile.id,
      })
      .eq("id", currentHold.id)
      .select(HOLD_SELECT)
      .single();

    if (holdError) throw holdError;
    updatedHold = formatHold(soldHold);
    holdStatusAuditTask = async () => {
      await cancelPendingHoldNotifications(writeClient, currentHold.id);
      await writeAuditLog(writeClient, authed, {
        event_type: "hold_sold",
        entity_type: "hold",
        entity_id: currentHold.id,
        remnant_id: remnantId,
        company_id: existingRemnant.company_id,
        message: `Marked held remnant #${existingRemnant.moraware_remnant_id || existingRemnant.id} as sold`,
        old_data: currentHold,
        new_data: updatedHold,
        meta: {
          source: "api",
          action: "status_sold",
          override: isPrivilegedProfile(authed.profile)
            && String(currentHold.hold_owner_user_id) !== String(authed.profile.id),
        },
      });
    };
  }

  if (status === "sold") {
    const soldByUserId = body?.sold_by_user_id ? String(body.sold_by_user_id).trim() : authed.profile.id;
    if (!isPrivilegedProfile(authed.profile) && soldByUserId !== authed.profile.id) {
      const error = new Error("You can only mark sales under your own user");
      error.statusCode = 403;
      throw error;
    }
    const soldByProfile = await fetchProfile(writeClient, soldByUserId);
    if (!soldByProfile || soldByProfile.active !== true) {
      const error = new Error("Sold-by user is not active");
      error.statusCode = 400;
      throw error;
    }
    if (soldByProfile.system_role !== "status_user") {
      const error = new Error("Sold-by user must be a sales rep");
      error.statusCode = 400;
      throw error;
    }

    const { data: saleData, error: saleError } = await writeClient
      .from("remnant_sales")
      .insert({
        remnant_id: remnantId,
        company_id: existingRemnant.company_id,
        sold_by_user_id: soldByUserId,
        sold_at: new Date().toISOString(),
        job_number: soldJobNumber,
        notes: soldNotes,
      })
      .select(SALE_SELECT)
      .single();

    if (saleError) throw saleError;
    currentSale = formatSale(saleData);
  }

  const { data, error } = await writeClient
    .from("remnants")
    .update({ status })
    .eq("id", remnantId)
    .select(REMNANT_SELECT)
    .single();

  if (error) throw error;
  if (!currentSale && data.status === "sold") {
    currentSale = await fetchLatestSaleForRemnant(writeClient, remnantId);
  }

  if (holdStatusAuditTask) {
    runBestEffort(holdStatusAuditTask, "Update hold state from remnant status");
  }
  runBestEffort(async () => {
    await writeAuditLog(writeClient, authed, {
      event_type: "remnant_status_changed",
      entity_type: "remnant",
      entity_id: data.id,
      remnant_id: data.id,
      company_id: data.company_id,
      message: `Changed status for remnant #${data.moraware_remnant_id || data.id} to ${data.status}`,
      old_data: existingRemnant,
      new_data: {
        id: data.id,
        moraware_remnant_id: data.moraware_remnant_id,
        company_id: data.company_id,
        status: data.status,
        current_sale: currentSale,
      },
      meta: {
        source: "api",
        action: "status_change",
        hold_id: updatedHold?.id || currentHold?.id || null,
      },
    });
  }, "Update remnant status audit");

  return {
    ...attachSaleToRows([formatRemnant(data)], new Map([[data.id, currentSale]]))[0],
    current_hold: updatedHold || currentHold || null,
  };
}

export async function archiveRemnant(client, authed, remnantId) {
  if (!remnantId) {
    const error = new Error("Invalid remnant id");
    error.statusCode = 400;
    throw error;
  }

  const writeClient = getWriteClient(client);
  const { data: existingRemnant, error: existingError } = await writeClient
    .from("remnants")
    .select("id,moraware_remnant_id,company_id,deleted_at,status")
    .eq("id", remnantId)
    .maybeSingle();

  if (existingError) throw existingError;
  const { data, error } = await client.rpc("soft_delete_remnant", {
    p_remnant_id: remnantId,
  });

  if (error) throw error;

  runBestEffort(async () => {
    await writeAuditLog(writeClient, authed, {
      event_type: "remnant_archived",
      entity_type: "remnant",
      entity_id: data.id,
      remnant_id: data.id,
      company_id: data.company_id,
      message: `Archived remnant #${data.moraware_remnant_id || data.id}`,
      old_data: existingRemnant,
      new_data: {
        id: data.id,
        moraware_remnant_id: data.moraware_remnant_id,
        company_id: data.company_id,
        deleted_at: data.deleted_at,
        status: data.status,
      },
      meta: {
        source: "api",
        action: "archive",
      },
    });
  }, "Archive remnant audit");

  return formatRemnant(data);
}

export async function updateRemnantImage(client, authed, remnantId, body) {
  if (!remnantId) {
    const error = new Error("Invalid remnant id");
    error.statusCode = 400;
    throw error;
  }
  if (!body?.image_file?.dataUrl) {
    const error = new Error("Image file is required");
    error.statusCode = 400;
    throw error;
  }

  const writeClient = getWriteClient(client);
  const { data: existingRemnant, error: existingError } = await writeClient
    .from("remnants")
    .select("id,moraware_remnant_id,company_id,image,image_path")
    .eq("id", remnantId)
    .maybeSingle();

  if (existingError) throw existingError;
  const imageData = await uploadImageIfPresent(writeClient, remnantId, body.image_file);
  const { data, error } = await writeClient
    .from("remnants")
    .update(imageData)
    .eq("id", remnantId)
    .select(REMNANT_SELECT)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const nextError = new Error("Remnant not found");
    nextError.statusCode = 404;
    throw nextError;
  }

  runBestEffort(async () => {
    await writeAuditLog(writeClient, authed, {
      event_type: "remnant_image_updated",
      entity_type: "remnant",
      entity_id: data.id,
      remnant_id: data.id,
      company_id: data.company_id,
      message: `Updated image for remnant #${data.moraware_remnant_id || data.id}`,
      old_data: existingRemnant,
      new_data: {
        id: data.id,
        moraware_remnant_id: data.moraware_remnant_id,
        company_id: data.company_id,
        image: data.image,
        image_path: data.image_path,
      },
      meta: {
        source: "api",
        action: "image_update",
      },
    });
  }, "Update remnant image audit");

  return formatRemnant(data);
}

export async function fetchRemnantHold(client, remnantId) {
  if (!remnantId) {
    const error = new Error("Invalid remnant id");
    error.statusCode = 400;
    throw error;
  }

  const writeClient = getWriteClient(client);
  const remnant = await fetchRemnantStatusRow(writeClient, remnantId);
  if (!remnant) {
    const error = new Error("Remnant not found");
    error.statusCode = 404;
    throw error;
  }

  const hold = await fetchRelevantHoldForRemnant(writeClient, remnantId);
  return { hold };
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

export async function processHoldExpirations(client, authed) {
  const writeClient = getWriteClient(client);
  const { data, error } = await writeClient
    .from("holds")
    .select(HOLD_SELECT)
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString());

  if (error) throw error;

  const expired = [];
  for (const holdRow of data || []) {
    const { data: updatedHold, error: updateError } = await writeClient
      .from("holds")
      .update({ status: "expired" })
      .eq("id", holdRow.id)
      .select(HOLD_SELECT)
      .single();

    if (updateError) throw updateError;

    await cancelPendingHoldNotifications(writeClient, holdRow.id);
    await queueNotification(writeClient, {
      notification_type: "hold_expired",
      target_user_id: holdRow.hold_owner_user_id,
      target_email: holdRow.hold_owner?.email || null,
      remnant_id: holdRow.remnant_id,
      hold_id: holdRow.id,
      payload: {
        remnant_id: holdRow.remnant_id,
        expires_at: holdRow.expires_at,
        job_number: holdRow.job_number || null,
      },
    });

    await writeAuditLog(writeClient, authed, {
      event_type: "hold_expired",
      entity_type: "hold",
      entity_id: holdRow.id,
      remnant_id: holdRow.remnant_id,
      company_id: holdRow.company_id,
      message: `Expired hold #${holdRow.id} for remnant ${holdRow.remnant_id}`,
      old_data: formatHold(holdRow),
      new_data: formatHold(updatedHold),
      meta: {
        source: "api",
        action: "expire_hold",
        override: true,
      },
    });

    expired.push(formatHold(updatedHold));
  }

  return { expired };
}

export async function fetchSlabs(client = getPublicReadClient()) {
  const { data, error } = await client
    .from("slabs")
    .select(`
      id,
      name,
      width,
      height,
      color_tone,
      detail_url,
      image_url,
      supplier:suppliers(id,name,website_url),
      material:materials(id,name),
      slab_colors(role,color:colors(id,name)),
      slab_finishes(finish:finishes(id,name)),
      slab_thicknesses(thickness:thicknesses(id,name))
    `)
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) throw error;

  const slabIds = (data || []).map((row) => Number(row.id)).filter(Boolean);
  const priceCodeMap = new Map();

  if (slabIds.length > 0) {
    const { data: priceRows, error: priceError } = await getReadClient()
      .from("slab_price_codes")
      .select("slab_id,finish_id,thickness_id,size_label,price_code,price_code_sort_order")
      .in("slab_id", slabIds);

    if (priceError) throw priceError;

    for (const row of priceRows || []) {
      const slabId = Number(row?.slab_id);
      if (!slabId) continue;
      const bucket = priceCodeMap.get(slabId) || [];
      bucket.push(row);
      priceCodeMap.set(slabId, bucket);
    }
  }

  return (data || []).map((row) => normalizeSlabRow(row, priceCodeMap.get(Number(row.id)) || []));
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

export function fetchAdminMeta() {
  return {
    tables: listAdminTables(),
  };
}

function asNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAdminIdentifier(tableConfig, row) {
  return tableConfig.primaryKey.reduce((acc, key) => {
    acc[key] = row?.[key] ?? null;
    return acc;
  }, {});
}

function applyAdminIdentifierFilter(query, tableConfig, identifier) {
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

function parseAdminColumnValue(columnName, columnConfig, rawValue) {
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

function sanitizeAdminIdentifier(tableConfig, rawIdentifier) {
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

function sanitizeAdminWriteValues(tableConfig, rawValues, mode) {
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

async function writeAuditLog(client, authed, entry) {
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

async function queueNotification(client, entry) {
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

function runBestEffort(task, label) {
  void (async () => {
    try {
      await task();
    } catch (error) {
      console.error(`${label} failed:`, error);
    }
  })();
}

async function cancelPendingHoldNotifications(client, holdId) {
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

async function scheduleHoldNotifications(client, hold) {
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

function cleanPathSegment(value, fallback = "file") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || fallback;
}

function buildImagePath(imageKey, ext) {
  return `remnant_${cleanPathSegment(imageKey)}.${ext}`;
}

function sanitizeExternalHttpUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch (_error) {
    return "";
  }
}

function dedupeStringList(values) {
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

function normalizeColorName(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const key = normalized.toLowerCase();
  if (key === "white-cool" || key === "white-warm") return "White";
  if (key === "gray-light" || key === "gray-dark") return "Gray";
  return normalized;
}

function dedupeColorList(values) {
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

function normalizeStoneLookupKeyPart(value) {
  return String(value || "").trim().toLowerCase();
}

function stoneProductLookupKey(materialId, stoneName) {
  const numericMaterialId = Number(materialId);
  const normalizedName = normalizeStoneLookupKeyPart(stoneName);
  if (!Number.isFinite(numericMaterialId) || !normalizedName) return "";
  return `${numericMaterialId}:${normalizedName}`;
}

function extractStoneProductColors(row) {
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

function withSharedStoneColorFallback(rows, stoneProducts) {
  const fallbackMap = new Map(
    (Array.isArray(stoneProducts) ? stoneProducts : [])
      .map((row) => [stoneProductLookupKey(row.material_id, row.display_name || row.stone_name), row])
      .filter(([key]) => Boolean(key)),
  );

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const colors = dedupeColorList([
      ...(Array.isArray(row?.colors) ? row.colors : []),
      ...(Array.isArray(row?.primary_colors) ? row.primary_colors : []),
      ...(Array.isArray(row?.accent_colors) ? row.accent_colors : []),
    ]);
    if (colors.length) {
      return {
        ...row,
        colors,
        primary_colors: colors,
        accent_colors: [],
      };
    }

    const fallback = fallbackMap.get(stoneProductLookupKey(row?.material_id, row?.name));
    if (!fallback) {
      return {
        ...row,
        colors,
        primary_colors: colors,
        accent_colors: [],
      };
    }

    const fallbackColors = dedupeColorList(fallback.colors);
    return {
      ...row,
      colors: fallbackColors,
      primary_colors: fallbackColors,
      accent_colors: [],
    };
  });
}

async function ensureStoneProduct(writeClient, payload, existingStoneProductId = null) {
  if (existingStoneProductId) return existingStoneProductId;
  if (!payload?.material_id || !payload?.name) return null;

  const displayName = String(payload.name || "").trim();
  if (!displayName) return null;

  const { data: existing, error: existingError } = await writeClient
    .from("stone_products")
    .select("id")
    .eq("material_id", payload.material_id)
    .eq("display_name", displayName)
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await writeClient
    .from("stone_products")
    .insert({
      material_id: payload.material_id,
      display_name: displayName,
      stone_name: displayName,
      active: true,
    })
    .select("id")
    .single();

  if (createError) throw createError;
  return created?.id || null;
}

async function replaceStoneProductColors(writeClient, stoneProductId, colorNamesByRole) {
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

function normalizeSlabRow(row, priceRows = []) {
  const slabColors = Array.isArray(row?.slab_colors) ? row.slab_colors : [];
  const slabFinishes = Array.isArray(row?.slab_finishes) ? row.slab_finishes : [];
  const slabThicknesses = Array.isArray(row?.slab_thicknesses) ? row.slab_thicknesses : [];

  const primary_colors = slabColors
    .filter((item) => item?.role === "primary" && item?.color?.name)
    .map((item) => item.color.name);
  const accent_colors = slabColors
    .filter((item) => item?.role === "accent" && item?.color?.name)
    .map((item) => item.color.name);
  const finishes = slabFinishes.map((item) => item?.finish?.name).filter(Boolean);
  const thicknesses = slabThicknesses.map((item) => item?.thickness?.name).filter(Boolean);
  const pricing_codes = [...new Set(
    (Array.isArray(priceRows) ? priceRows : [])
      .map((item) => item?.price_code)
      .filter(Boolean),
  )];

  return {
    id: row.id,
    name: row.name,
    width: row.width || "",
    height: row.height || "",
    color_tone: row.color_tone || "",
    detail_url: sanitizeExternalHttpUrl(row.detail_url),
    image_url: sanitizeExternalHttpUrl(row.image_url),
    supplier: row.supplier?.name || "",
    supplier_website_url: row.supplier?.website_url || "",
    material: row.material?.name || "",
    primary_colors,
    accent_colors,
    finishes,
    thicknesses,
    pricing_codes,
  };
}

function isAllowedImageProxyTarget(value) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const supabaseHostname = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname : null;
    const morawareHostname = process.env.MORAWARE_URL ? new URL(process.env.MORAWARE_URL).hostname : null;
    return [supabaseHostname, morawareHostname].filter(Boolean).includes(parsed.hostname);
  } catch (_error) {
    return false;
  }
}

async function uploadImageIfPresent(client, imageKey, imageFile) {
  if (!imageFile?.dataUrl) return null;

  const parsed = parseDataUrl(imageFile.dataUrl);
  if (!parsed) {
    throw new Error("Invalid image upload format");
  }

  const ext = extensionForType(parsed.contentType, imageFile.name);
  const imagePath = buildImagePath(imageKey, ext);
  const bucket = process.env.SUPABASE_BUCKET || "remnant-images";

  const { error: uploadError } = await client.storage.from(bucket).upload(imagePath, parsed.buffer, {
    contentType: parsed.contentType,
    upsert: true,
  });

  if (uploadError) throw uploadError;

  const { data } = client.storage.from(bucket).getPublicUrl(imagePath);
  return {
    image: data.publicUrl,
    image_path: imagePath,
  };
}

function normalizePayload(body) {
  const parsed = {
    name: body.name ? String(body.name).trim() : "",
    moraware_remnant_id: asNumber(body.moraware_remnant_id ?? body.external_id),
    company_id: asNumber(body.company_id),
    material_id: asNumber(body.material_id),
    thickness_id: asNumber(body.thickness_id),
    finish_id: asNumber(body.finish_id),
    width: asNumber(body.width),
    height: asNumber(body.height),
    l_shape: Boolean(body.l_shape),
    l_width: asNumber(body.l_width),
    l_height: asNumber(body.l_height),
    colors: dedupeColorList(
      Array.isArray(body.colors) && body.colors.length
        ? body.colors
        : [...(Array.isArray(body.primary_colors) ? body.primary_colors : []), ...(Array.isArray(body.accent_colors) ? body.accent_colors : [])],
    ),
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

function validateRemnantPayload(payload) {
  if (!payload.name || !payload.company_id || !payload.material_id || !payload.thickness_id) {
    return "Company, material, thickness, and stone name are required";
  }
  if (!payload.width || !payload.height) {
    return "Width and height are required";
  }
  return null;
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

export { getWriteClient };
