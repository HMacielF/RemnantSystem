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
  stone_product_id,
  company:companies(id,name),
  material:materials(id,name),
  thickness:thicknesses(id,name),
  finish:finishes(id,name)
`;
const REMNANT_WITH_STONE_SELECT = `
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
const SLAB_SELECT = `
  id,
  name,
  active,
  width,
  height,
  color_tone,
  detail_url,
  image_url,
  stone_product:stone_products(
    id,
    brand_name,
    stone_name,
    stone_product_colors(
      role,
      color:colors(id,name)
    )
  ),
  supplier:suppliers(id,name,website_url),
  material:materials(id,name),
  slab_colors(role,color:colors(id,name)),
  slab_finishes(finish:finishes(id,name)),
  slab_thicknesses(thickness:thicknesses(id,name))
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
const REMNANT_INVENTORY_CHECK_EVENT = "remnant_inventory_confirmed";

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
    price_per_sqft: row.price_per_sqft ?? null,
    colors: normalizedColors,
    primary_colors: normalizedColors,
    accent_colors: [],
  };
}

function normalizePriceValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePricePerSqft(value) {
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

async function withRemnantPriceFallback(client, rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const slabIds = [...new Set(normalizedRows.map((row) => asNumber(row?.parent_slab_id)).filter((value) => value !== null))];
  if (!slabIds.length) {
    return normalizedRows.map((row) => ({
      ...row,
      price_per_sqft: normalizePriceValue(row?.price_per_sqft),
    }));
  }

  const { data, error } = await client
    .from("slab_supplier_prices")
    .select("slab_id,finish_id,thickness_id,list_price_per_sqft,active")
    .in("slab_id", slabIds)
    .eq("active", true);
  if (error) throw error;

  const priceMap = new Map();
  for (const row of data || []) {
    const slabId = asNumber(row?.slab_id);
    if (slabId === null) continue;
    const bucket = priceMap.get(slabId) || [];
    bucket.push(row);
    priceMap.set(slabId, bucket);
  }

  return normalizedRows.map((row) => {
    const existingPrice = normalizePriceValue(row?.price_per_sqft);
    if (existingPrice !== null) {
      return {
        ...row,
        price_per_sqft: existingPrice,
      };
    }

    const slabId = asNumber(row?.parent_slab_id);
    const derivedPrice = slabId === null ? null : chooseBestSlabPrice(row, priceMap.get(slabId) || []);
    return {
      ...row,
      price_per_sqft: derivedPrice,
    };
  });
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

async function upsertRemnantManualPrice(writeClient, remnant, payload) {
  const normalizedPrice = parsePricePerSqft(payload?.price_per_sqft);
  if (normalizedPrice === null || !remnant?.id) {
    return asNumber(remnant?.parent_slab_id);
  }

  const supplierId = await ensureSupplierForManualPrice(writeClient, remnant, payload);
  if (supplierId === null) return asNumber(remnant?.parent_slab_id);

  const slabId = await ensureSlabForManualPrice(writeClient, remnant, payload, supplierId);
  if (slabId === null) return null;

  const tierId = await ensureManualPriceTier(writeClient, supplierId, payload?.material_id, normalizedPrice);
  if (tierId === null) return slabId;

  let existingQuery = writeClient
    .from("slab_supplier_prices")
    .select("id")
    .eq("slab_id", slabId)
    .eq("active", true)
    .order("id", { ascending: false })
    .limit(1);

  const numericFinishId = asNumber(payload?.finish_id);
  const numericThicknessId = asNumber(payload?.thickness_id);
  existingQuery = numericFinishId === null ? existingQuery.is("finish_id", null) : existingQuery.eq("finish_id", numericFinishId);
  existingQuery = numericThicknessId === null ? existingQuery.is("thickness_id", null) : existingQuery.eq("thickness_id", numericThicknessId);

  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throw existingError;

  const pricePayload = {
    supplier_id: supplierId,
    slab_id: slabId,
    material_id: asNumber(payload?.material_id),
    finish_id: numericFinishId,
    thickness_id: numericThicknessId,
    tier_id: tierId,
    supplier_product_name: String(payload?.name || remnant?.name || "").trim() || `Remnant ${remnant.id}`,
    list_price_per_sqft: normalizedPrice,
    price_source: "manual_manage_editor",
    active: true,
  };

  if (existing?.id) {
    const { error: updateError } = await writeClient
      .from("slab_supplier_prices")
      .update(pricePayload)
      .eq("id", existing.id);

    if (updateError) throw updateError;
    return slabId;
  }

  const { error: insertError } = await writeClient
    .from("slab_supplier_prices")
    .insert(pricePayload);

  if (insertError) throw insertError;
  return slabId;
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
  const minWidth = parseMeasurement(searchParams.get("min-width") ?? searchParams.get("minWidth"));
  const minHeight = parseMeasurement(searchParams.get("min-height") ?? searchParams.get("minHeight"));
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
  const rowsWithSharedColorsAndPrices = await withRemnantPriceFallback(getWriteClient(requiredAuthed.client), rowsWithSharedColors);
  if (!shouldEnrich) return rowsWithSharedColorsAndPrices;

  const remnantIds = rowsWithSharedColorsAndPrices.map((row) => row.id);
  const writeClient = getWriteClient(requiredAuthed.client);
  const [holdMap, saleMap, statusActorMap] = await Promise.all([
    fetchRelevantHoldMap(writeClient, remnantIds),
    fetchLatestSaleMap(writeClient, remnantIds),
    fetchStatusActorMap(writeClient, remnantIds),
  ]);

  return attachStatusMetaToRows(attachSaleToRows(attachHoldToRows(rowsWithSharedColorsAndPrices, holdMap), saleMap), statusActorMap);
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
  const [holdMap, saleMap, statusActorMap, remnantRowsResult] = await Promise.all([
    fetchRelevantHoldMap(writeClient, numericIds),
    fetchLatestSaleMap(writeClient, numericIds),
    fetchStatusActorMap(writeClient, numericIds),
    writeClient
      .from("remnants")
      .select(REMNANT_WITH_STONE_SELECT)
      .in("id", numericIds)
      .is("deleted_at", null),
  ]);
  if (remnantRowsResult.error) throw remnantRowsResult.error;
  const pricedEnrichedRows = await withRemnantPriceFallback(
    writeClient,
    (remnantRowsResult.data || []).map((row) => ({
      ...row,
      ...extractStoneProductColors(row),
    })),
  );
  const remnantMap = new Map(
    pricedEnrichedRows.map((row) => [
      Number(row.id),
      formatRemnant(row),
    ]),
  );

  return numericIds.map((remnantId) => {
    const currentSale = saleMap.get(Number(remnantId)) || null;
    return {
      ...(remnantMap.get(Number(remnantId)) || {}),
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
        ${REMNANT_WITH_STONE_SELECT}
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
  const formattedRows = (data || []).map((row) => {
    const remnant = row.remnant || {};
    return {
      ...row,
      remnant: formatRemnant({
        ...remnant,
        image: remnant.image || "",
        source_image_url: remnant.source_image_url || "",
        ...extractStoneProductColors(remnant),
      }),
    };
  });
  const enrichedRemnants = await withRemnantPriceFallback(
    getWriteClient(client),
    formattedRows.map((row) => row.remnant),
  );
  const remnantMap = new Map(enrichedRemnants.map((row) => [Number(row.id), row]));
  return formattedRows.map((row) => ({
    ...row,
    remnant: remnantMap.get(Number(row?.remnant?.id)) || row.remnant,
  }));
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
        ${REMNANT_WITH_STONE_SELECT}
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

  const formattedRows = holdRows.map((row) => {
    const remnant = row.remnant || {};
    const request = requestMap.get(Number(row.remnant_id)) || null;
    return {
      ...row,
      remnant: formatRemnant({
        ...remnant,
        ...extractStoneProductColors(remnant),
      }),
      requester_name: request?.requester_name || "",
      requester_email: request?.requester_email || "",
      requester_message: String(request?.notes || "").trim() || "",
      request_job_number: request?.job_number || "",
    };
  });
  const enrichedRemnants = await withRemnantPriceFallback(
    writeClient,
    formattedRows.map((row) => row.remnant),
  );
  const remnantMap = new Map(enrichedRemnants.map((row) => [Number(row.id), row]));
  return formattedRows.map((row) => ({
    ...row,
    remnant: remnantMap.get(Number(row?.remnant?.id)) || row.remnant,
  }));
}

export async function fetchMySold(client, profile) {
  const writeClient = getWriteClient(client);
  const { data, error } = await writeClient
    .from("remnant_sales")
    .select(`
      id,
      remnant_id,
      company_id,
      sold_by_user_id,
      sold_at,
      job_number,
      notes,
      created_at,
      updated_at,
      remnant:remnants!remnant_id(
        ${REMNANT_WITH_STONE_SELECT}
      )
    `)
    .eq("sold_by_user_id", profile.id)
    .order("sold_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const formattedRows = (Array.isArray(data) ? data : []).map((row) => {
    const remnant = row.remnant || {};
    return {
      ...row,
      remnant: formatRemnant({
        ...remnant,
        ...extractStoneProductColors(remnant),
      }),
    };
  });
  const enrichedRemnants = await withRemnantPriceFallback(
    writeClient,
    formattedRows.map((row) => row.remnant),
  );
  const remnantMap = new Map(enrichedRemnants.map((row) => [Number(row.id), row]));
  return formattedRows.map((row) => ({
    ...row,
    remnant: remnantMap.get(Number(row?.remnant?.id)) || row.remnant,
  }));
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

  await upsertRemnantManualPrice(writeClient, data, payload);

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

  const [pricedRow] = await withRemnantPriceFallback(writeClient, [{
    ...refreshedData,
    ...extractStoneProductColors(refreshedData),
  }]);

  return formatRemnant(pricedRow);
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

  await upsertRemnantManualPrice(writeClient, data, payload);

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

  const [pricedRow] = await withRemnantPriceFallback(writeClient, [{
    ...refreshedData,
    ...extractStoneProductColors(refreshedData),
  }]);

  return formatRemnant(pricedRow);
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
    .single();

  if (refreshedError) throw refreshedError;

  const [pricedRow] = await withRemnantPriceFallback(writeClient, [{
    ...refreshedData,
    ...extractStoneProductColors(refreshedData),
  }]);

  return {
    ...attachSaleToRows([formatRemnant(pricedRow)], new Map([[refreshedData.id, currentSale]]))[0],
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

  const [pricedRow] = await withRemnantPriceFallback(writeClient, [data]);
  return formatRemnant(pricedRow);
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

  const [pricedRow] = await withRemnantPriceFallback(writeClient, [data]);
  return formatRemnant(pricedRow);
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

function normalizeInventoryCheckOutcome(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "seen" || normalized === "exists" || normalized === "confirmed") return "seen";
  if (normalized === "missing" || normalized === "not_found" || normalized === "not-found") return "missing";
  if (normalized === "issue" || normalized === "review" || normalized === "needs_review" || normalized === "needs-review") {
    return "issue";
  }
  if (normalized === "not_in_db" || normalized === "not-in-db" || normalized === "unuploaded" || normalized === "unknown") {
    return "not_in_db";
  }
  const error = new Error("Invalid inventory check outcome");
  error.statusCode = 400;
  throw error;
}

function sanitizeInventorySessionId(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 120) {
    const error = new Error("Session id is required");
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

async function fetchInventoryCheckAuditRows(client, authed, sessionId) {
  const writeClient = getWriteClient(client);
  const query = writeClient
    .from("audit_logs")
    .select("*")
    .eq("event_type", REMNANT_INVENTORY_CHECK_EVENT)
    .contains("meta", { session_id: sessionId })
    .order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function lookupInventoryCheckRemnant(client, number, authed, sessionId) {
  const numeric = extractRemnantIdSearch(number);
  if (!numeric) {
    const error = new Error("Enter a remnant number");
    error.statusCode = 400;
    throw error;
  }

  const writeClient = getWriteClient(client);
  const { data, error } = await writeClient
    .from("remnants")
    .select(REMNANT_WITH_STONE_SELECT)
    .is("deleted_at", null)
    .eq("moraware_remnant_id", numeric)
    .maybeSingle();

  if (error) throw error;

  const priorRows = sessionId
    ? await fetchInventoryCheckAuditRows(client, authed, sanitizeInventorySessionId(sessionId))
    : [];
  const priorMatch = priorRows.find((row) => Number(row.remnant_id) === Number(data?.id));

  if (!data) {
    return {
      entered_number: numeric,
      remnant: null,
      existing_check: null,
    };
  }

  return {
    entered_number: numeric,
    remnant: formatRemnant(data),
    existing_check: priorMatch
      ? {
          outcome: priorMatch?.meta?.outcome || null,
          created_at: priorMatch.created_at,
          note: priorMatch.message || null,
        }
      : null,
  };
}

export async function recordInventoryCheck(client, authed, body) {
  const sessionId = sanitizeInventorySessionId(body?.session_id);
  const outcome = normalizeInventoryCheckOutcome(body?.outcome);
  const enteredNumber = extractRemnantIdSearch(body?.entered_number);
  const location = String(body?.location || "").trim() || null;
  if (!enteredNumber) {
    const error = new Error("Entered number is required");
    error.statusCode = 400;
    throw error;
  }

  const writeClient = getWriteClient(client);
  const remnantId = asNumber(body?.remnant_id);

  if (outcome === "not_in_db") {
    await writeAuditLog(writeClient, authed, {
      event_type: REMNANT_INVENTORY_CHECK_EVENT,
      entity_type: "remnant_inventory_unknown",
      entity_id: null,
      remnant_id: null,
      company_id: null,
      message: `Marked remnant #${enteredNumber} as physically present but missing from the database`,
      new_data: {
        remnant_id: null,
        moraware_remnant_id: enteredNumber,
        outcome,
        session_id: sessionId,
        entered_number: enteredNumber,
      },
      meta: {
        source: "manage_confirm",
        session_id: sessionId,
        outcome,
        entered_number: enteredNumber,
      },
    });

    return {
      ok: true,
      outcome,
      message: `Marked remnant #${enteredNumber} as physically present but missing from the database`,
      remnant: null,
    };
  }

  if (!remnantId) {
    const error = new Error("Remnant id is required");
    error.statusCode = 400;
    throw error;
  }

  const { data: remnant, error } = await writeClient
    .from("remnants")
    .select(REMNANT_WITH_STONE_SELECT)
    .eq("id", remnantId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!remnant) {
    const nextError = new Error("Remnant not found");
    nextError.statusCode = 404;
    throw nextError;
  }

  let updatedHold = null;
  if (outcome === "seen") {
    const currentHold = await fetchRelevantHoldForRemnant(writeClient, remnant.id);
    if (currentHold?.status === "active") {
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

      runBestEffort(async () => {
        await cancelPendingHoldNotifications(writeClient, currentHold.id);
        await writeAuditLog(writeClient, authed, {
          event_type: "hold_released",
          entity_type: "hold",
          entity_id: currentHold.id,
          remnant_id: remnant.id,
          company_id: remnant.company_id,
          message: `Released hold for remnant #${remnant.moraware_remnant_id || remnant.id}`,
          old_data: currentHold,
          new_data: updatedHold,
          meta: {
            source: "manage_confirm",
            action: "inventory_check_release",
            override: isPrivilegedProfile(authed.profile)
              && String(currentHold.hold_owner_user_id) !== String(authed.profile.id),
          },
        });
      }, "Release hold from inventory check");
    }
  }

  if (outcome === "seen") {
    const currentStatus = String(remnant.status || "").trim().toLowerCase();
    const nextRemnantStatus = currentStatus === "sold"
      ? remnant.status
      : (currentStatus === "hold" && !remnant.inventory_hold)
        ? remnant.status
        : "available";
    const seenUpdate = {
      last_seen_at: new Date().toISOString(),
      status: nextRemnantStatus,
      location,
    };
    if (remnant.inventory_hold) seenUpdate.inventory_hold = false;
    const { error: updateError } = await writeClient
      .from("remnants")
      .update(seenUpdate)
      .eq("id", remnant.id)
      .is("deleted_at", null);
    if (updateError) throw updateError;
  } else {
    const { error: updateError } = await writeClient
      .from("remnants")
      .update({ location })
      .eq("id", remnant.id)
      .is("deleted_at", null);
    if (updateError) throw updateError;
  }

  const message = outcome === "seen"
    ? String(remnant.status || "").trim().toLowerCase() === "sold"
      ? `Confirmed remnant #${remnant.moraware_remnant_id || remnant.id} in inventory and kept it marked sold`
      : `Confirmed remnant #${remnant.moraware_remnant_id || remnant.id} in inventory and marked it available`
    : outcome === "issue"
      ? `Flagged remnant #${remnant.moraware_remnant_id || remnant.id} for review`
      : `Marked remnant #${remnant.moraware_remnant_id || remnant.id} as not seen in inventory`;

  await writeAuditLog(writeClient, authed, {
    event_type: REMNANT_INVENTORY_CHECK_EVENT,
    entity_type: "remnant_inventory_check",
    entity_id: remnant.id,
    remnant_id: remnant.id,
    company_id: remnant.company_id,
    message,
    new_data: {
      remnant_id: remnant.id,
      moraware_remnant_id: remnant.moraware_remnant_id,
      outcome,
      session_id: sessionId,
      entered_number: enteredNumber,
      location,
    },
    meta: {
      source: "manage_confirm",
      session_id: sessionId,
      outcome,
      entered_number: enteredNumber,
      location,
    },
  });

  return {
    ok: true,
    outcome,
    message,
    remnant: {
      ...formatRemnant({
        ...remnant,
        location,
      }),
      current_hold: updatedHold,
    },
  };
}

export async function bulkInventoryHold(client, authed) {
  const writeClient = getWriteClient(client);

  const { data: availableRemnants, error: fetchError } = await writeClient
    .from("remnants")
    .select("id, company_id")
    .eq("status", "available")
    .is("deleted_at", null);
  if (fetchError) throw fetchError;

  if (!availableRemnants?.length) return { ok: true, count: 0 };

  const now = new Date().toISOString();
  const holdRows = availableRemnants.map((r) => ({
    remnant_id: r.id,
    company_id: r.company_id,
    hold_owner_user_id: authed.profile.id,
    hold_started_at: now,
    expires_at: null,
    status: "active",
    customer_name: "Inventory Double Check",
    notes: "Bulk hold for inventory re-verification",
    job_number: null,
  }));

  const { error: holdError } = await writeClient.from("holds").insert(holdRows);
  if (holdError) throw holdError;

  const ids = availableRemnants.map((r) => r.id);
  const { error: updateError } = await writeClient
    .from("remnants")
    .update({ status: "hold", inventory_hold: true })
    .in("id", ids)
    .is("deleted_at", null);
  if (updateError) throw updateError;

  const count = ids.length;
  runBestEffort(async () => {
    await writeAuditLog(writeClient, authed, {
      event_type: "inventory_double_check_started",
      entity_type: "remnant_bulk",
      entity_id: null,
      remnant_id: null,
      company_id: null,
      message: `Started inventory double check — placed ${count} available remnants on hold`,
      new_data: { count, affected_ids: ids },
      meta: { source: "manage_confirm", action: "bulk_inventory_hold" },
    });
  }, "Audit bulk inventory hold");

  return { ok: true, count };
}

export async function fetchInventoryHoldCount(client) {
  const writeClient = getWriteClient(client);
  const { count, error } = await writeClient
    .from("remnants")
    .select("id", { count: "exact", head: true })
    .eq("inventory_hold", true)
    .is("deleted_at", null);
  if (error) throw error;
  return { count: count ?? 0 };
}

export async function fetchInventoryCheckSession(client, authed, sessionId) {
  const normalizedSessionId = sanitizeInventorySessionId(sessionId);
  const writeClient = getWriteClient(client);
  const auditRows = await fetchInventoryCheckAuditRows(client, authed, normalizedSessionId);

  const latestByRemnantId = new Map();
  const notInDbRows = [];
  for (const row of auditRows) {
    if ((row?.meta?.outcome || null) === "not_in_db") {
      notInDbRows.push(row);
      continue;
    }
    const key = Number(row.remnant_id);
    if (!key || latestByRemnantId.has(key)) continue;
    latestByRemnantId.set(key, row);
  }

  const checkedRemnantIds = [...latestByRemnantId.keys()].filter(Boolean);
  const checkedCount = checkedRemnantIds.length;
  const seenCount = [...latestByRemnantId.values()].filter((row) => row?.meta?.outcome === "seen").length;
  const missingCount = [...latestByRemnantId.values()].filter((row) => row?.meta?.outcome === "missing").length;
  const issueCount = [...latestByRemnantId.values()].filter((row) => row?.meta?.outcome === "issue").length;
  const notInDbCount = notInDbRows.length;

  const { count: totalCount, error: totalError } = await writeClient
    .from("remnants")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  if (totalError) throw totalError;

  let unseenRows = [];
  let unseenQuery = writeClient
    .from("remnants")
    .select("id,moraware_remnant_id,name,status")
    .is("deleted_at", null)
    .order("moraware_remnant_id", { ascending: true, nullsFirst: false })
    .limit(30);

  if (checkedRemnantIds.length) {
    unseenQuery = unseenQuery.not("id", "in", `(${checkedRemnantIds.join(",")})`);
  }

  const { data: unseenData, error: unseenError } = await unseenQuery;
  if (unseenError) throw unseenError;
  unseenRows = unseenData || [];

  const recent = auditRows.slice(0, 20).map((row) => ({
    id: row.id,
    remnant_id: row.remnant_id,
    outcome: row?.meta?.outcome || null,
    entered_number: row?.meta?.entered_number || null,
    created_at: row.created_at,
    message: row.message,
  }));

  return {
    session_id: normalizedSessionId,
    summary: {
      total_count: totalCount || 0,
      checked_count: checkedCount,
      seen_count: seenCount,
      missing_count: missingCount,
      issue_count: issueCount,
      not_in_db_count: notInDbCount,
      unchecked_count: Math.max((totalCount || 0) - checkedCount, 0),
    },
    unseen_preview: unseenRows.map((row) => ({
      id: row.id,
      moraware_remnant_id: row.moraware_remnant_id,
      name: row.name,
      status: row.status,
    })),
    recent,
  };
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

function uniqueSortedStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
}

const THICKNESS_ORDER = new Map([
  ["6 MM", 1],
  ["10 MM", 2],
  ["12 MM", 3],
  ["15 MM", 4],
  ["2 CM", 5],
  ["3 CM", 6],
]);

function normalizeThicknessLabel(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function compareThicknessLabels(left, right) {
  const normalizedLeft = normalizeThicknessLabel(left);
  const normalizedRight = normalizeThicknessLabel(right);
  const leftRank = THICKNESS_ORDER.get(normalizedLeft);
  const rightRank = THICKNESS_ORDER.get(normalizedRight);

  if (leftRank !== undefined || rightRank !== undefined) {
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    if (leftRank !== rightRank) return leftRank - rightRank;
  }

  return normalizedLeft.localeCompare(normalizedRight);
}

function uniqueSortedThicknesses(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))].sort(compareThicknessLabels);
}

const NATURAL_STONE_GROUP_MATERIALS = new Set([
  "granite",
  "marble",
  "quartzite",
  "soapstone",
  "dolomitic marble",
]);

function normalizeSlabGroupingKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNaturalStoneGroupingMaterial(material) {
  return NATURAL_STONE_GROUP_MATERIALS.has(normalizeSlabGroupingKeyPart(material));
}

function canonicalNaturalStoneGroupName(row = {}) {
  let value = String(row?.stone_name || row?.name || "").trim();
  if (!value) return "";

  value = value
    .replace(/\s+·\s+Block\s+.+$/i, "")
    .replace(/\s+·\s+Batch\s+.+$/i, "")
    .replace(/\b(polished|honed|leathered|leather|brushed|flamed|textured)\b/gi, " ")
    .replace(/\b(granite|marble|quartzite|soapstone|dolomitic marble)\b/gi, " ")
    .replace(/\bslab\b/gi, " ")
    .replace(/\b\d+(?:\s+\d+\/\d+|\/\d+)?\s*"?\s*thick\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(mm|cm)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return value;
}

function createGroupedNaturalStoneRows(rows = []) {
  const grouped = new Map();
  const passthroughRows = [];

  for (const row of rows) {
    if (!isNaturalStoneGroupingMaterial(row?.material)) {
      passthroughRows.push({ ...row, is_group: false });
      continue;
    }

    const groupingName = canonicalNaturalStoneGroupName(row) || row?.stone_name || row?.name || "";
    const groupingKey = [
      normalizeSlabGroupingKeyPart(row?.material),
      normalizeSlabGroupingKeyPart(groupingName),
    ].join("::");
    const bucket = grouped.get(groupingKey) || [];
    bucket.push(row);
    grouped.set(groupingKey, bucket);
  }

  const groupedRows = [...grouped.entries()].map(([groupKey, members]) => {
    if (members.length <= 1) {
      return { ...members[0], is_group: false };
    }

    const sortedMembers = [...members].sort((left, right) => {
      const supplierCompare = String(left?.supplier || "").localeCompare(String(right?.supplier || ""));
      if (supplierCompare !== 0) return supplierCompare;
      const nameCompare = String(left?.name || "").localeCompare(String(right?.name || ""));
      if (nameCompare !== 0) return nameCompare;
      return Number(left?.id || 0) - Number(right?.id || 0);
    });
    const hero = sortedMembers[0] || {};
    const suppliers = uniqueSortedStrings(sortedMembers.map((item) => item?.supplier).filter(Boolean));
    const colors = uniqueSortedStrings(sortedMembers.flatMap((item) => [
      ...(Array.isArray(item?.primary_colors) ? item.primary_colors : []),
      ...(Array.isArray(item?.accent_colors) ? item.accent_colors : []),
    ]));
    const finishes = uniqueSortedStrings(sortedMembers.flatMap((item) =>
      Array.isArray(item?.finishes) ? item.finishes : []
    ));
    const thicknesses = uniqueSortedThicknesses(sortedMembers.flatMap((item) =>
      Array.isArray(item?.thicknesses) ? item.thicknesses : []
    ));
    const pricingCodes = uniqueSortedStrings(sortedMembers.flatMap((item) =>
      Array.isArray(item?.pricing_codes) ? item.pricing_codes : []
    ));
    const availablePrices = sortedMembers
      .map((item) => normalizePriceValue(item?.price_per_sqft))
      .filter((value) => value !== null);

    return {
      ...hero,
      id: `group:${groupKey}`,
      name: hero?.stone_name || hero?.name || "",
      stone_name: hero?.stone_name || hero?.name || "",
      brand_name: "",
      supplier: suppliers.join(", "),
      suppliers,
      detail_url: "",
      primary_colors: colors,
      accent_colors: [],
      finishes,
      thicknesses,
      pricing_codes: pricingCodes,
      price_per_sqft: availablePrices.length ? Math.min(...availablePrices) : null,
      is_group: true,
      group_kind: "natural_stone",
      group_count: sortedMembers.length,
      group_rows: sortedMembers.map((item) => ({ ...item, is_group: false })),
    };
  });

  return [...groupedRows, ...passthroughRows].sort((left, right) =>
    String(left?.name || "").localeCompare(String(right?.name || "")),
  );
}

function normalizeFinishToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function basicFinishFamilyFor(rawFinish, material = "") {
  const finish = normalizeFinishToken(rawFinish);
  const materialName = normalizeFinishToken(material);
  if (!finish) return "";

  // Branded Cambria finish term; keep under Polished for now, but review separately.
  if (finish === "cambria luxe") {
    return "Polished";
  }

  if (finish === "satin ridge") {
    return "Textured";
  }

  if (finish === "lava") {
    return "Textured";
  }

  if (
    finish.includes("polish")
    || finish.includes("gloss")
    || finish.includes("shiny")
  ) {
    return "Polished";
  }

  if (
    finish.includes("leather")
    || finish.includes("textur")
    || finish.includes("brush")
    || finish.includes("rough")
    || finish.includes("concrete")
    || finish.includes("hammer")
    || finish.includes("flame")
    || finish.includes("caress")
    || finish.includes("river")
    || finish.includes("antique")
  ) {
    return "Textured";
  }

  if (
    finish.includes("matte")
    || finish.includes("honed")
    || finish.includes("suede")
    || finish.includes("volcano")
    || finish.includes("satin")
    || finish.includes("silk")
    || finish.includes("cashmere")
    || finish.includes("velvet")
    || finish === "natural"
    || finish.includes("nature")
    || finish.includes("soft touch")
  ) {
    return "Matte";
  }

  // Natural-stone terms that usually indicate surface texture rather than flat matte.
  if (
    materialName.includes("granite")
    || materialName.includes("marble")
    || materialName.includes("quartzite")
    || materialName.includes("soapstone")
  ) {
    if (finish.includes("split") || finish.includes("cleft")) {
      return "Textured";
    }
  }

  return "Other";
}

function slabFinishFamilies(row = {}) {
  return uniqueSortedStrings(
    (Array.isArray(row?.finishes) ? row.finishes : [])
      .map((finish) => basicFinishFamilyFor(finish, row?.material))
      .filter(Boolean),
  );
}

function buildSlabFinishFilterOptions(rows = []) {
  const aliasesByFamily = new Map();

  for (const row of rows) {
    const rawFinishes = Array.isArray(row?.finishes) ? row.finishes : [];
    for (const finish of rawFinishes) {
      const family = basicFinishFamilyFor(finish, row?.material);
      if (!family) continue;
      const bucket = aliasesByFamily.get(family) || new Set();
      if (finish) bucket.add(String(finish).trim());
      aliasesByFamily.set(family, bucket);
    }
  }

  return [...aliasesByFamily.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([value, aliases]) => {
      const sortedAliases = [...aliases].sort((left, right) => left.localeCompare(right));
      const distinctAliases = sortedAliases.filter(
        (alias) => normalizeFinishToken(alias) !== normalizeFinishToken(value),
      );
      return {
        value,
        label: distinctAliases.length
          ? `${value} (${distinctAliases.join(", ")})`
          : value,
        aliases: distinctAliases,
      };
    });
}

function buildSlabCatalogOptions(rows = []) {
  return {
    brands: uniqueSortedStrings(rows.map((row) => row.brand_name || row.supplier)),
    suppliers: uniqueSortedStrings(rows.map((row) => row.supplier)),
    materials: uniqueSortedStrings(rows.map((row) => row.material)),
    finish_filters: buildSlabFinishFilterOptions(rows),
    thicknesses: uniqueSortedThicknesses(rows.flatMap((row) => row.thicknesses || [])),
    colors: uniqueSortedStrings(
      rows.flatMap((row) => [
        ...(Array.isArray(row?.primary_colors) ? row.primary_colors : []),
        ...(Array.isArray(row?.accent_colors) ? row.accent_colors : []),
      ]),
    ),
  };
}

function applySlabCatalogFilters(rows = [], filters = {}) {
  const search = String(filters?.search || "").trim().toLowerCase();
  const brand = String(filters?.brand || "").trim();
  const supplier = String(filters?.supplier || "").trim();
  const material = String(filters?.material || "").trim();
  const finish = String(filters?.finish || "").trim();
  const thickness = String(filters?.thickness || "").trim();

  return rows.filter((row) => {
    if (brand && (row.brand_name || row.supplier) !== brand) return false;
    if (supplier && row.supplier !== supplier) return false;
    if (material && row.material !== material) return false;
    if (finish && !slabFinishFamilies(row).includes(finish)) return false;
    if (thickness && !(Array.isArray(row.thicknesses) ? row.thicknesses : []).includes(thickness)) return false;

    if (!search) return true;
    const haystack = [
      row.name,
      row.brand_name,
      row.supplier,
      row.material,
      row.width,
      row.height,
      row.color_tone,
      ...(row.pricing_codes || []),
      ...(row.primary_colors || []),
      ...(row.accent_colors || []),
      ...(row.finishes || []),
      ...(row.thicknesses || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(search);
  });
}

function sortSlabCatalogRows(rows = [], priceSort = "default") {
  if (priceSort !== "low" && priceSort !== "high") {
    return rows;
  }

  return [...rows].sort((left, right) => {
    const leftPrice = normalizePriceValue(left?.price_per_sqft);
    const rightPrice = normalizePriceValue(right?.price_per_sqft);

    if (leftPrice === null && rightPrice === null) return 0;
    if (leftPrice === null) return 1;
    if (rightPrice === null) return -1;

    return priceSort === "low" ? leftPrice - rightPrice : rightPrice - leftPrice;
  });
}

function filterPricedSlabCatalogRows(rows = [], priceSort = "default") {
  if (priceSort !== "low" && priceSort !== "high") {
    return rows;
  }

  return rows.filter((row) => normalizePriceValue(row?.price_per_sqft) !== null);
}

export async function fetchSlabs(client = null, options = {}) {
  const readClient = client ? getWriteClient(client) : getReadClient();
  const { data, error } = await readClient
    .from("slabs")
    .select(SLAB_SELECT)
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) throw error;

  const slabIds = (data || []).map((row) => Number(row.id)).filter(Boolean);
  const priceCodeMap = new Map();
  const slabPriceMap = new Map();

  if (slabIds.length > 0) {
    const { data: slabPriceRows, error: slabPriceError } = await getReadClient()
      .from("slab_supplier_prices")
      .select("slab_id,list_price_per_sqft,active")
      .in("slab_id", slabIds)
      .eq("active", true);

    if (slabPriceError) throw slabPriceError;

    for (const row of slabPriceRows || []) {
      const slabId = Number(row?.slab_id);
      const price = normalizePriceValue(row?.list_price_per_sqft);
      if (!slabId || price === null) continue;
      const current = slabPriceMap.get(slabId);
      if (current === undefined || price < current) {
        slabPriceMap.set(slabId, price);
      }
    }

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

  const normalizedRows = (data || [])
    .map((row) =>
      normalizeSlabRow(
        row,
        priceCodeMap.get(Number(row.id)) || [],
        slabPriceMap.get(Number(row.id)) ?? null,
      ),
    )
    .filter((row) => Boolean(row.image_url));

  const catalogOptions = buildSlabCatalogOptions(normalizedRows);
  const filteredRows = applySlabCatalogFilters(normalizedRows, options);
  const groupedRows = createGroupedNaturalStoneRows(filteredRows);
  const pricedRows = filterPricedSlabCatalogRows(groupedRows, options?.priceSort);
  const sortedRows = sortSlabCatalogRows(pricedRows, options?.priceSort);

  const requestedPage = Number.parseInt(String(options?.page || "1"), 10);
  const requestedPageSize = Number.parseInt(String(options?.pageSize || "24"), 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = Number.isFinite(requestedPageSize) && requestedPageSize > 0
    ? Math.min(requestedPageSize, 60)
    : 24;
  const start = (page - 1) * pageSize;
  const rows = sortedRows.slice(start, start + pageSize);

  return {
    rows,
    total: sortedRows.length,
    page,
    pageSize,
    hasMore: start + rows.length < sortedRows.length,
    options: catalogOptions,
  };
}

export async function fetchSlabById(client, slabId) {
  const numericSlabId = asNumber(slabId);
  if (numericSlabId === null) {
    const error = new Error("Invalid slab id");
    error.statusCode = 400;
    throw error;
  }

  const { data, error } = await getWriteClient(client)
    .from("slabs")
    .select(SLAB_SELECT)
    .eq("id", numericSlabId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const nextError = new Error("Slab not found");
    nextError.statusCode = 404;
    throw nextError;
  }

  return normalizeEditableSlabRow(data);
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

function parseMeasurement(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const normalized = String(value || "")
    .trim()
    .replace(/["”]/g, "")
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

function displayColorName(value) {
  const normalized = normalizeColorName(value);
  if (!normalized) return "";
  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
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

function normalizeStoneLookupKeyPart(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
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

  let existingQuery = writeClient
    .from("stone_products")
    .select("id")
    .eq("material_id", payload.material_id)
    .eq("display_name", displayName)
    .limit(1);

  if (brandName) {
    existingQuery = existingQuery.eq("brand_name", brandName);
  }

  const { data: existing, error: existingError } = await existingQuery.maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await writeClient
    .from("stone_products")
    .insert({
      material_id: payload.material_id,
      display_name: displayName,
      stone_name: displayName,
      brand_name: brandName,
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

async function replaceSlabColors(writeClient, slabId, colorNames) {
  const numericSlabId = asNumber(slabId);
  if (numericSlabId === null) return;

  const allNames = dedupeColorList(colorNames);
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
    .from("slab_colors")
    .delete()
    .eq("slab_id", numericSlabId);

  if (deleteError) throw deleteError;
  if (!allNames.length) return;

  const rowsToInsert = allNames.map((name) => ({
    slab_id: numericSlabId,
    color_id: colorIdByName.get(name),
    role: "primary",
  }));

  const { error: insertError } = await writeClient
    .from("slab_colors")
    .insert(rowsToInsert);

  if (insertError) throw insertError;
}

async function replaceSlabFinishes(writeClient, slabId, finishNames) {
  const numericSlabId = asNumber(slabId);
  if (numericSlabId === null) return;

  const allNames = dedupeStringList(finishNames);
  let finishRows = [];
  if (allNames.length) {
    const { data, error } = await writeClient
      .from("finishes")
      .select("id,name")
      .in("name", allNames);

    if (error) throw error;
    finishRows = data || [];
  }

  const finishIdByName = new Map(finishRows.map((row) => [row.name, row.id]));
  const missingNames = allNames.filter((name) => !finishIdByName.has(name));
  if (missingNames.length) {
    throw new Error(`Unknown finishes: ${missingNames.join(", ")}`);
  }

  const { error: deleteError } = await writeClient
    .from("slab_finishes")
    .delete()
    .eq("slab_id", numericSlabId);

  if (deleteError) throw deleteError;
  if (!allNames.length) return;

  const rowsToInsert = allNames.map((name) => ({
    slab_id: numericSlabId,
    finish_id: finishIdByName.get(name),
  }));

  const { error: insertError } = await writeClient
    .from("slab_finishes")
    .insert(rowsToInsert);

  if (insertError) throw insertError;
}

async function replaceSlabThicknesses(writeClient, slabId, thicknessNames) {
  const numericSlabId = asNumber(slabId);
  if (numericSlabId === null) return;

  const allNames = dedupeStringList(thicknessNames);
  let thicknessRows = [];
  if (allNames.length) {
    const { data, error } = await writeClient
      .from("thicknesses")
      .select("id,name")
      .in("name", allNames);

    if (error) throw error;
    thicknessRows = data || [];
  }

  const thicknessIdByName = new Map(thicknessRows.map((row) => [row.name, row.id]));
  const missingNames = allNames.filter((name) => !thicknessIdByName.has(name));
  if (missingNames.length) {
    throw new Error(`Unknown thicknesses: ${missingNames.join(", ")}`);
  }

  const { error: deleteError } = await writeClient
    .from("slab_thicknesses")
    .delete()
    .eq("slab_id", numericSlabId);

  if (deleteError) throw deleteError;
  if (!allNames.length) return;

  const rowsToInsert = allNames.map((name) => ({
    slab_id: numericSlabId,
    thickness_id: thicknessIdByName.get(name),
  }));

  const { error: insertError } = await writeClient
    .from("slab_thicknesses")
    .insert(rowsToInsert);

  if (insertError) throw insertError;
}

function normalizeSlabRow(row, priceRows = [], pricePerSqft = null) {
  const slabColors = Array.isArray(row?.slab_colors) ? row.slab_colors : [];
  const stoneProductColors = Array.isArray(row?.stone_product?.stone_product_colors)
    ? row.stone_product.stone_product_colors
    : [];
  const slabFinishes = Array.isArray(row?.slab_finishes) ? row.slab_finishes : [];
  const slabThicknesses = Array.isArray(row?.slab_thicknesses) ? row.slab_thicknesses : [];

  const colorSource = slabColors.length ? slabColors : stoneProductColors;
  const normalizedColors = dedupeColorList(
    colorSource.map((item) => item?.color?.name).filter(Boolean),
  );
  const finishes = dedupeStringList(
    slabFinishes.map((item) => item?.finish?.name).filter(Boolean),
  );
  const thicknesses = dedupeStringList(
    slabThicknesses.map((item) => item?.thickness?.name).filter(Boolean),
  );
  const pricing_codes = [...new Set(
    (Array.isArray(priceRows) ? priceRows : [])
      .map((item) => item?.price_code)
      .filter(Boolean),
  )];

  return {
    id: row.id,
    name: row.name,
    stone_name: row.stone_product?.stone_name || row.name,
    stone_product_id: row.stone_product?.id || null,
    width: row.width || "",
    height: row.height || "",
    color_tone: row.color_tone || "",
    detail_url: sanitizeExternalHttpUrl(row.detail_url),
    image_url: sanitizeExternalHttpUrl(row.image_url),
    brand_name: row.stone_product?.brand_name || "",
    supplier: row.supplier?.name || "",
    supplier_website_url: row.supplier?.website_url || "",
    material: row.material?.name || "",
    primary_colors: normalizedColors,
    accent_colors: [],
    finishes,
    thicknesses,
    pricing_codes,
    price_per_sqft: pricePerSqft,
  };
}

function normalizeEditableSlabRow(row) {
  const normalized = normalizeSlabRow(row);
  return {
    ...normalized,
    active: row?.active !== false,
    supplier_id: row?.supplier?.id || null,
    material_id: row?.material?.id || null,
    stone_product_id: row?.stone_product?.id || null,
    colors: normalized.primary_colors,
  };
}

async function ensureSlabStoneProduct(writeClient, payload) {
  const materialId = asNumber(payload?.material_id);
  const stoneName = String(payload?.name || "").trim();
  const brandName = String(payload?.brand_name || "").trim() || null;
  if (materialId === null || !stoneName) return null;

  const displayName = brandName ? `${brandName} ${stoneName}` : stoneName;
  const normalizedStoneName = normalizeStoneLookupKeyPart(stoneName);
  const normalizedBrandName = normalizeStoneLookupKeyPart(brandName);
  const normalizedDisplayName = normalizeStoneLookupKeyPart(displayName);

  const { data: normalizedMatch, error: normalizedMatchError } = await writeClient
    .from("stone_products")
    .select("id,material_id,brand_name,stone_name,display_name,normalized_name")
    .eq("material_id", materialId)
    .eq("normalized_name", normalizedDisplayName)
    .maybeSingle();

  if (normalizedMatchError) throw normalizedMatchError;
  if (normalizedMatch?.id) return normalizedMatch.id;

  const { data: candidates, error: candidateError } = await writeClient
    .from("stone_products")
    .select("id,material_id,brand_name,stone_name,display_name,normalized_name")
    .eq("material_id", materialId)
    .limit(1000);

  if (candidateError) throw candidateError;

  const rows = Array.isArray(candidates) ? candidates : [];
  const exactBrandMatch = rows.find((row) =>
    normalizeStoneLookupKeyPart(row?.stone_name) === normalizedStoneName &&
    normalizeStoneLookupKeyPart(row?.brand_name) === normalizedBrandName,
  );
  if (exactBrandMatch?.id) return exactBrandMatch.id;

  const displayMatch = rows.find(
    (row) => normalizeStoneLookupKeyPart(row?.display_name) === normalizedDisplayName,
  );
  if (displayMatch?.id) return displayMatch.id;

  const brandlessMatch = rows.find((row) =>
    normalizeStoneLookupKeyPart(row?.stone_name) === normalizedStoneName &&
    !normalizeStoneLookupKeyPart(row?.brand_name),
  );
  if (!normalizedBrandName && brandlessMatch?.id) return brandlessMatch.id;

  const { data: created, error: createError } = await writeClient
    .from("stone_products")
    .insert({
      material_id: materialId,
      display_name: displayName,
      stone_name: stoneName,
      brand_name: brandName,
      active: true,
    })
    .select("id")
    .single();

  if (createError?.code === "23505") {
    const { data: retryRows, error: retryError } = await writeClient
      .from("stone_products")
      .select("id,brand_name,stone_name,display_name,normalized_name")
      .eq("material_id", materialId)
      .limit(100);
    if (retryError) throw retryError;

    const retryMatch = (retryRows || []).find((row) =>
      normalizeStoneLookupKeyPart(row?.display_name) === normalizedDisplayName ||
      (
        normalizeStoneLookupKeyPart(row?.stone_name) === normalizedStoneName &&
        normalizeStoneLookupKeyPart(row?.brand_name) === normalizedBrandName
      ),
    );
    if (retryMatch?.id) return retryMatch.id;
  }

  if (createError) throw createError;
  return created?.id || null;
}

function isAllowedImageProxyTarget(value) {
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

function normalizeSlabPayload(body) {
  return {
    name: body.name ? String(body.name).trim() : "",
    brand_name: body.brand_name === undefined ? undefined : String(body.brand_name || "").trim(),
    supplier_id: body.supplier_id === undefined ? undefined : asNumber(body.supplier_id),
    material_id: body.material_id === undefined ? undefined : asNumber(body.material_id),
    active: body.active === undefined ? undefined : Boolean(body.active),
    width:
      body.width === "" || body.width === undefined || body.width === null
        ? (body.width === undefined ? undefined : null)
        : parseMeasurement(body.width),
    height:
      body.height === "" || body.height === undefined || body.height === null
        ? (body.height === undefined ? undefined : null)
        : parseMeasurement(body.height),
    detail_url: body.detail_url === undefined ? undefined : sanitizeExternalHttpUrl(body.detail_url),
    image_url: body.image_url === undefined ? undefined : sanitizeExternalHttpUrl(body.image_url),
    colors: body.colors === undefined ? undefined : dedupeColorList(body.colors),
    finishes: body.finishes === undefined ? undefined : dedupeStringList(body.finishes),
    thicknesses: body.thicknesses === undefined ? undefined : dedupeStringList(body.thicknesses),
  };
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

function validateSlabPayload(payload, body) {
  if (!payload.name) {
    return "Slab name is required";
  }

  if (!payload.supplier_id) {
    return "Supplier is required";
  }

  if (!payload.material_id) {
    return "Material is required";
  }

  if (body?.width !== undefined && body?.width !== null && String(body.width).trim() !== "" && payload.width === null) {
    return "Slab width is invalid";
  }

  if (body?.height !== undefined && body?.height !== null && String(body.height).trim() !== "" && payload.height === null) {
    return "Slab height is invalid";
  }

  return null;
}

export async function updateSlab(client, authed, slabId, body) {
  const numericSlabId = asNumber(slabId);
  if (numericSlabId === null) {
    const error = new Error("Invalid slab id");
    error.statusCode = 400;
    throw error;
  }

  const writeClient = getWriteClient(client);
  const normalizedPayload = normalizeSlabPayload(body || {});

  const { data: existingSlab, error: existingError } = await writeClient
    .from("slabs")
    .select(SLAB_SELECT)
    .eq("id", numericSlabId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (!existingSlab) {
    const error = new Error("Slab not found");
    error.statusCode = 404;
    throw error;
  }

  const payload = {
    name: normalizedPayload.name || existingSlab.name || "",
    brand_name: normalizedPayload.brand_name !== undefined
      ? normalizedPayload.brand_name
      : (existingSlab?.stone_product?.brand_name || ""),
    supplier_id: normalizedPayload.supplier_id !== undefined
      ? normalizedPayload.supplier_id
      : (existingSlab?.supplier?.id || null),
    material_id: normalizedPayload.material_id !== undefined
      ? normalizedPayload.material_id
      : (existingSlab?.material?.id || null),
    active: normalizedPayload.active !== undefined
      ? normalizedPayload.active
      : (existingSlab?.active !== false),
    width: normalizedPayload.width !== undefined ? normalizedPayload.width : existingSlab.width,
    height: normalizedPayload.height !== undefined ? normalizedPayload.height : existingSlab.height,
    detail_url: normalizedPayload.detail_url !== undefined ? normalizedPayload.detail_url : existingSlab.detail_url,
    image_url: normalizedPayload.image_url !== undefined ? normalizedPayload.image_url : existingSlab.image_url,
    colors: normalizedPayload.colors !== undefined
      ? normalizedPayload.colors
      : normalizeEditableSlabRow(existingSlab).colors,
    finishes: normalizedPayload.finishes !== undefined ? normalizedPayload.finishes : dedupeStringList(
      (existingSlab?.slab_finishes || []).map((item) => item?.finish?.name).filter(Boolean),
    ),
    thicknesses: normalizedPayload.thicknesses !== undefined ? normalizedPayload.thicknesses : dedupeStringList(
      (existingSlab?.slab_thicknesses || []).map((item) => item?.thickness?.name).filter(Boolean),
    ),
  };

  const validationError = validateSlabPayload(payload, body || {});
  if (validationError) {
    const error = new Error(validationError);
    error.statusCode = 400;
    throw error;
  }

  const stoneProductId = await ensureSlabStoneProduct(writeClient, payload);

  const { error: updateError } = await writeClient
    .from("slabs")
    .update({
      name: payload.name,
      supplier_id: payload.supplier_id,
      material_id: payload.material_id,
      stone_product_id: stoneProductId,
      active: payload.active,
      deactivated_at: payload.active ? null : new Date().toISOString(),
      width: payload.width,
      height: payload.height,
      detail_url: payload.detail_url,
      image_url: payload.image_url,
    })
    .eq("id", numericSlabId);

  if (updateError) throw updateError;

  await replaceSlabColors(writeClient, numericSlabId, payload.colors);
  await replaceSlabFinishes(writeClient, numericSlabId, payload.finishes);
  await replaceSlabThicknesses(writeClient, numericSlabId, payload.thicknesses);

  const { data: refreshedSlab, error: refreshedError } = await writeClient
    .from("slabs")
    .select(SLAB_SELECT)
    .eq("id", numericSlabId)
    .maybeSingle();

  if (refreshedError) throw refreshedError;
  if (!refreshedSlab) {
    const error = new Error("Slab not found after update");
    error.statusCode = 404;
    throw error;
  }

  runBestEffort(async () => {
    await writeAuditLog(writeClient, authed, {
      event_type: payload.active ? "slab_updated" : "slab_archived",
      entity_type: "slab",
      entity_id: numericSlabId,
      message: payload.active ? `Updated slab #${numericSlabId}` : `Archived slab #${numericSlabId}`,
      old_data: existingSlab,
      new_data: refreshedSlab,
      meta: {
        source: "api",
        action: payload.active ? "update" : "archive",
      },
    });
  }, "Update slab audit");

  return normalizeEditableSlabRow(refreshedSlab);
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
