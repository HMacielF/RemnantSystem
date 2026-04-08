import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

const ACTIVE_REMNANT_SELECT = "*";
const HOLD_SELECT = `
    id,
    remnant_id,
    company_id,
    status,
    created_at,
    updated_at
`;
const SALE_SELECT = `
    id,
    remnant_id,
    company_id,
    sold_at,
    created_at,
    updated_at
`;
const VALID_STATUSES = new Set(["available", "hold", "sold"]);

function envConfig() {
  return {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function createSupabaseClient(key) {
  const { url } = envConfig();
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY/SUPABASE_KEY are required");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getPublicReadClient() {
  return createSupabaseClient(envConfig().anonKey);
}

function getTrustedReadClient() {
  const { serviceRoleKey, anonKey } = envConfig();
  return createSupabaseClient(serviceRoleKey || anonKey);
}

function getServiceClient() {
  const { serviceRoleKey } = envConfig();
  return serviceRoleKey ? createSupabaseClient(serviceRoleKey) : null;
}

let cachedMailTransport = null;

function smtpConfig() {
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host: String(process.env.SMTP_HOST || "").trim(),
    port: Number.isFinite(port) ? port : 587,
    user: String(process.env.SMTP_USER || "").trim(),
    pass: String(process.env.SMTP_PASS || "").trim(),
    from: String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim(),
  };
}

function isSmtpConfigured() {
  const config = smtpConfig();
  return Boolean(config.host && config.port && config.user && config.pass && config.from);
}

function getMailTransport() {
  if (cachedMailTransport) return cachedMailTransport;

  const config = smtpConfig();
  if (!isSmtpConfigured()) {
    throw new Error("SMTP is not configured");
  }

  cachedMailTransport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  return cachedMailTransport;
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

function formatHold(row) {
  if (!row) return null;
  return row;
}

function formatSale(row) {
  if (!row) return null;
  return row;
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

function resolveEffectiveFinish(row) {
  const directFinish = String(row?.finish?.name || row?.finish_name || "").trim();
  if (directFinish) return directFinish;

  const finishes = dedupeStringList(row?.slab_finishes);
  if (finishes.length === 1) return finishes[0];
  if (finishes.length <= 1) return "";

  const text = [
    row?.name,
    row?.stone_product?.display_name,
    row?.stone_product?.stone_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const matched = finishes.find((finish) => {
    const normalizedFinish = finish.toLowerCase();
    return text.includes(`${normalizedFinish} finish`) || text.includes(normalizedFinish);
  });

  return matched || "";
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

function formatPublicRemnant(row) {
  return {
    ...row,
    display_id: row.id,
    internal_remnant_id: row.internal_remnant_id ?? null,
    company_name: row.company || "",
    material_name: row.material || "",
    thickness_name: row.thickness || "",
    brand_name: row.brand_name || "",
    colors: dedupeColorList(row.colors),
  };
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

async function fetchVisibleActiveRemnantRows({ internalIds = [], externalIds = [] } = {}) {
  const normalizedInternalIds = [...new Set((internalIds || []).map((value) => Number(value)).filter(Boolean))];
  const normalizedExternalIds = [...new Set((externalIds || []).map((value) => Number(value)).filter(Boolean))];
  if (!normalizedInternalIds.length && !normalizedExternalIds.length) return [];

  let query = getPublicReadClient()
    .from("active_remnants")
    .select("internal_remnant_id,id,status");

  if (normalizedInternalIds.length && normalizedExternalIds.length) {
    query = query.or(
      `internal_remnant_id.in.(${normalizedInternalIds.join(",")}),id.in.(${normalizedExternalIds.join(",")})`,
    );
  } else if (normalizedInternalIds.length) {
    query = query.in("internal_remnant_id", normalizedInternalIds);
  } else {
    query = query.in("id", normalizedExternalIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function resolveVisiblePublicRemnant({ internalRemnantId = null, externalRemnantId = null } = {}) {
  const rows = await fetchVisibleActiveRemnantRows({
    internalIds: internalRemnantId ? [internalRemnantId] : [],
    externalIds: externalRemnantId ? [externalRemnantId] : [],
  });

  const byInternalId = internalRemnantId
    ? rows.find((row) => Number(row.internal_remnant_id) === Number(internalRemnantId))
    : null;
  const byExternalId = externalRemnantId
    ? rows.find((row) => Number(row.id) === Number(externalRemnantId))
    : null;

  if (internalRemnantId && externalRemnantId) {
    if (
      byInternalId &&
      byExternalId &&
      Number(byInternalId.internal_remnant_id) === Number(byExternalId.internal_remnant_id)
    ) {
      return byInternalId;
    }
    return null;
  }

  return byInternalId || byExternalId || null;
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

export async function fetchPublicLookupRows() {
  const { data, error } = await getPublicReadClient()
    .from("active_remnants")
    .select("company,material,thickness");

  if (error) throw error;

  const uniqueRows = (values) =>
    Array.from(
      new Set(
        (values || [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ).map((name) => ({ id: name, name, active: true }));

  const sortByName = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));

  return {
    companies: sortByName(uniqueRows((data || []).map((row) => row.company))),
    materials: sortByName(uniqueRows((data || []).map((row) => row.material))),
    thicknesses: sortByName(uniqueRows((data || []).map((row) => row.thickness))),
  };
}

export async function fetchInventorySummary() {
  const { data, error } = await getPublicReadClient()
    .from("active_remnants")
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

export async function fetchSalesRepRows(options = {}) {
  const companyId = Number(options.companyId || 0);
  const { data, error } = await getTrustedReadClient()
    .from("profiles")
    .select("id,email,full_name,system_role,company_id")
    .eq("active", true)
    .order("full_name", { ascending: true });

  if (error) throw error;

  return (data || [])
    .filter(
      (row) =>
        row.system_role === "status_user" &&
        companyId > 0 &&
        Number(row.company_id) === companyId,
    )
    .map((row) => ({
      id: row.id,
      full_name: row.full_name,
      display_name: row.full_name || row.email || "User",
      company_id: row.company_id,
    }));
}

export async function fetchPublicSalesRepRows(options = {}) {
  const internalRemnantId = asNumber(options.internalRemnantId ?? options.remnantId);
  const externalRemnantId = asNumber(options.externalRemnantId ?? options.displayRemnantId);
  const visibleRemnant = await resolveVisiblePublicRemnant({
    internalRemnantId,
    externalRemnantId,
  });
  if (!visibleRemnant) return [];

  const trustedClient = getServiceClient() || getTrustedReadClient();
  const { data, error } = await trustedClient
    .from("remnants")
    .select("id,company_id,deleted_at")
    .eq("id", visibleRemnant.internal_remnant_id)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.deleted_at) return [];

  return fetchSalesRepRows({ companyId: data.company_id });
}

export function getPublicRemnantFilters(searchParams) {
  const material = searchParams.getAll("material");
  return {
    materialNames: material.map((value) => String(value || "").trim()).filter(Boolean),
    stone: String(searchParams.get("stone") || "").trim(),
    status: normalizeStatus(searchParams.get("status"), ""),
    minWidth: parseMeasurement(searchParams.get("min-width") ?? searchParams.get("minWidth")),
    minHeight: parseMeasurement(searchParams.get("min-height") ?? searchParams.get("minHeight")),
  };
}

export async function fetchPublicRemnants(filters) {
  const stoneLike = escapeLikeValue(filters.stone);
  const searchedRemnantId = extractRemnantIdSearch(filters.stone);
  const publicClient = getPublicReadClient();
  const [brandMatchedStoneProductIds, colorMatchedStoneProductIds, finishMatchedRemnantIds] = filters.stone
    ? await Promise.all([
        fetchStoneProductIdsByBrandSearch(getTrustedReadClient(), filters.stone),
        fetchStoneProductIdsByColorSearch(getTrustedReadClient(), filters.stone),
        fetchRemnantIdsByFinishSearch(getTrustedReadClient(), filters.stone),
      ])
    : [[], [], []];
  const matchedStoneProductIds = [...new Set([...brandMatchedStoneProductIds, ...colorMatchedStoneProductIds])];

  let query = publicClient
    .from("active_remnants")
    .select(ACTIVE_REMNANT_SELECT)
    .order("id", { ascending: true });

  if (filters.materialNames.length > 0) {
    query = query.in("material", filters.materialNames);
  }
  if (filters.stone && searchedRemnantId !== null) {
    const orFilters = [`name.ilike.%${stoneLike}%`, `id.eq.${searchedRemnantId}`];
    if (matchedStoneProductIds.length) {
      orFilters.push(`stone_product_id.in.(${matchedStoneProductIds.join(",")})`);
    }
    if (finishMatchedRemnantIds.length) {
      orFilters.push(`internal_remnant_id.in.(${finishMatchedRemnantIds.join(",")})`);
    }
    query = query.or(orFilters.join(","));
  } else if (filters.stone) {
    if (matchedStoneProductIds.length || finishMatchedRemnantIds.length) {
      const orFilters = [`name.ilike.%${stoneLike}%`];
      if (matchedStoneProductIds.length) {
        orFilters.push(`stone_product_id.in.(${matchedStoneProductIds.join(",")})`);
      }
      if (finishMatchedRemnantIds.length) {
        orFilters.push(`internal_remnant_id.in.(${finishMatchedRemnantIds.join(",")})`);
      }
      query = query.or(orFilters.join(","));
    } else {
      query = query.ilike("name", `%${stoneLike}%`);
    }
  }
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.minWidth !== null) query = query.gte("width", filters.minWidth);
  if (filters.minHeight !== null) query = query.gte("height", filters.minHeight);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const stoneProductIds = [...new Set(rows.map((row) => Number(row.stone_product_id)).filter(Boolean))];
  let brandByStoneProductId = new Map();
  if (stoneProductIds.length) {
    const { data: stoneProducts, error: stoneProductError } = await getTrustedReadClient()
      .from("stone_products")
      .select("id,brand_name")
      .in("id", stoneProductIds);

    if (stoneProductError) throw stoneProductError;
    brandByStoneProductId = new Map(
      (stoneProducts || []).map((row) => [Number(row.id), String(row.brand_name || "").trim()]),
    );
  }

  return rows.map((row) =>
    formatPublicRemnant({
      ...row,
      brand_name: brandByStoneProductId.get(Number(row.stone_product_id)) || "",
    }),
  );
}

export async function fetchPublicRemnantEnrichment(remnantIds) {
  const numericIds = [...new Set((remnantIds || []).map((value) => Number(value)).filter(Boolean))];
  if (numericIds.length === 0) return [];

  const visibleRows = await fetchVisibleActiveRemnantRows({ internalIds: numericIds });
  const visibleIds = visibleRows.map((row) => Number(row.internal_remnant_id)).filter(Boolean);
  if (visibleIds.length === 0) return [];

  const trustedClient = getTrustedReadClient();
  const [holdMap, saleMap, remnantColorRows] = await Promise.all([
    fetchRelevantHoldMap(trustedClient, visibleIds),
    fetchLatestSaleMap(trustedClient, visibleIds),
    trustedClient
      .from("remnants")
      .select(`
        id,
        name,
        parent_slab_id,
        finish:finishes(name),
        stone_product:stone_products(
          brand_name,
          display_name,
          stone_name,
          stone_product_colors(
            color:colors(name)
          )
        ),
        slab_finishes:slabs(
          slab_finishes(
            finish:finishes(name)
          )
        )
      `)
      .in("id", visibleIds)
      .then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      }),
  ]);
  const colorMap = new Map(
    remnantColorRows.map((row) => [
      Number(row.id),
      dedupeColorList(
        (Array.isArray(row?.stone_product?.stone_product_colors) ? row.stone_product.stone_product_colors : [])
          .map((item) => item?.color?.name),
      ),
    ]),
  );
  const finishMap = new Map(
    remnantColorRows.map((row) => {
      const slabFinishes = Array.isArray(row?.slab_finishes?.slab_finishes)
        ? row.slab_finishes.slab_finishes.map((item) => item?.finish?.name)
        : [];
      return [
        Number(row.id),
        resolveEffectiveFinish({
          ...row,
          slab_finishes: slabFinishes,
        }),
      ];
    }),
  );

  return visibleIds.map((remnantId) => {
    const currentSale = saleMap.get(Number(remnantId)) || null;
    return {
      remnant_id: Number(remnantId),
      current_hold: holdMap.get(Number(remnantId)) || null,
      current_sale: currentSale,
      sold_at: currentSale?.sold_at || null,
      brand_name: String(remnantColorRows.find((row) => Number(row.id) === Number(remnantId))?.stone_product?.brand_name || "").trim(),
      finish_name: finishMap.get(Number(remnantId)) || "",
      colors: colorMap.get(Number(remnantId)) || [],
    };
  });
}

async function writeAuditLog(client, entry) {
  const { error } = await client.from("audit_logs").insert({
    actor_user_id: null,
    actor_email: null,
    actor_role: null,
    actor_company_id: null,
    event_type: entry.event_type,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id ?? null,
    remnant_id: entry.remnant_id ?? null,
    company_id: entry.company_id ?? null,
    message: entry.message ?? null,
    old_data: entry.old_data ?? null,
    new_data: entry.new_data ?? null,
    meta: entry.meta ?? null,
  });

  if (error) {
    console.error("Audit log write failed:", error);
  }
}

async function queueNotification(client, entry) {
  const { data, error } = await client
    .from("notification_queue")
    .insert({
    notification_type: entry.notification_type,
    target_user_id: entry.target_user_id ?? null,
    target_email: entry.target_email ?? null,
    remnant_id: entry.remnant_id ?? null,
    hold_id: entry.hold_id ?? null,
    hold_request_id: entry.hold_request_id ?? null,
    payload: entry.payload ?? {},
    scheduled_for: entry.scheduled_for ?? new Date().toISOString(),
    status: entry.status ?? "pending",
    error: entry.error ?? null,
  })
    .select("id,status")
    .single();

  if (error) {
    console.error("Notification queue write failed:", error);
    return null;
  }

  return data || null;
}

async function updateNotificationStatus(client, notificationId, status, errorMessage = null) {
  if (!notificationId) return;

  const payload = {
    status,
    error: errorMessage ? String(errorMessage).slice(0, 1000) : null,
  };

  if (status === "sent") {
    payload.sent_at = new Date().toISOString();
  }

  const { error } = await client
    .from("notification_queue")
    .update(payload)
    .eq("id", notificationId);

  if (error) {
    console.error("Notification queue status update failed:", error);
  }
}

async function fetchProfileSummary(client, profileId) {
  const normalizedId = String(profileId || "").trim();
  if (!normalizedId) return null;

  const { data, error } = await client
    .from("profiles")
    .select("id,email,full_name")
    .eq("id", normalizedId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function emailSummaryLine(label, value) {
  const text = String(value || "").trim();
  return text ? `${label}: ${text}` : null;
}

async function sendHoldRequestEmail({ salesRep, holdRequest, remnant }) {
  if (!salesRep?.email) {
    throw new Error("Sales rep email is missing");
  }

  const transport = getMailTransport();
  const from = smtpConfig().from;
  const displayId = remnant?.id || holdRequest?.external_remnant_id || holdRequest?.remnant_id || "";
  const heading = [
    String(remnant?.brand_name || "").trim(),
    String(remnant?.name || "").trim(),
  ].filter(Boolean).join(" ").trim() || String(remnant?.name || "").trim() || `Remnant #${displayId}`;
  const subheading = [
    String(remnant?.material_name || "").trim(),
    String(remnant?.company_name || "").trim(),
  ].filter(Boolean).join(" · ");
  const size = remnant?.l_shape
    ? `${remnant?.width}" x ${remnant?.height}" + ${remnant?.l_width}" x ${remnant?.l_height}"`
    : remnant?.width && remnant?.height
      ? `${remnant.width}" x ${remnant.height}"`
      : "";

  const lines = [
    `A client just requested a hold in Remnant System.`,
    "",
    emailSummaryLine("Sales rep", salesRep?.full_name || salesRep?.email),
    emailSummaryLine("Requester", holdRequest?.requester_name),
    emailSummaryLine("Requester email", holdRequest?.requester_email),
    emailSummaryLine("Remnant", heading),
    emailSummaryLine("Remnant ID", displayId ? `#${displayId}` : ""),
    emailSummaryLine("Details", subheading),
    emailSummaryLine("Size", size),
    emailSummaryLine("Finish", remnant?.finish_name),
    emailSummaryLine("Thickness", remnant?.thickness_name),
    emailSummaryLine("Job number", holdRequest?.job_number),
    emailSummaryLine("Notes", holdRequest?.notes),
  ].filter(Boolean);

  await transport.sendMail({
    from,
    to: salesRep.email,
    subject: `New hold request for #${displayId}${heading ? ` · ${heading}` : ""}`,
    text: lines.join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#232323;line-height:1.5">
        <p>A client just requested a hold in Remnant System.</p>
        <table style="border-collapse:collapse">
          ${[
            ["Sales rep", salesRep?.full_name || salesRep?.email],
            ["Requester", holdRequest?.requester_name],
            ["Requester email", holdRequest?.requester_email],
            ["Remnant", heading],
            ["Remnant ID", displayId ? `#${displayId}` : ""],
            ["Details", subheading],
            ["Size", size],
            ["Finish", remnant?.finish_name],
            ["Thickness", remnant?.thickness_name],
            ["Job number", holdRequest?.job_number],
            ["Notes", holdRequest?.notes],
          ]
            .filter(([, value]) => String(value || "").trim())
            .map(
              ([label, value]) => `
                <tr>
                  <td style="padding:4px 12px 4px 0;font-weight:700;vertical-align:top">${label}</td>
                  <td style="padding:4px 0">${String(value)}</td>
                </tr>`,
            )
            .join("")}
        </table>
      </div>`,
  });
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

export async function createPublicHoldRequest(body) {
  const serviceSupabase = getServiceClient();
  if (!serviceSupabase) {
    const error = new Error("Public hold requests require SUPABASE_SERVICE_ROLE_KEY on the server");
    error.statusCode = 500;
    throw error;
  }

  const internalRemnantId = asNumber(body.remnant_id ?? body.internal_remnant_id);
  const externalRemnantId = asNumber(body.external_remnant_id ?? body.remnant_id);
  const requesterName = String(body.requester_name || body.name || "").trim();
  const requesterEmail = String(body.requester_email || body.email || "").trim();
  const salesRepUserId = body.sales_rep_user_id ? String(body.sales_rep_user_id).trim() : null;
  const salesRepName = String(body.sales_rep_name || "").trim();

  const missingFields = [];
  if (!externalRemnantId) missingFields.push("external_remnant_id (or remnant_id)");
  if (!requesterName) missingFields.push("requester_name");
  if (!requesterEmail) missingFields.push("requester_email");

  if (missingFields.length > 0) {
    const error = new Error("Missing required fields");
    error.statusCode = 400;
    error.payload = { error: "Missing required fields", missing_fields: missingFields };
    throw error;
  }

  const visibleRemnant = await resolveVisiblePublicRemnant({
    internalRemnantId,
    externalRemnantId,
  });
  if (!visibleRemnant) {
    const error = new Error("Remnant not found");
    error.statusCode = 404;
    throw error;
  }

  const { data: resolvedRemnant, error: remnantError } = await serviceSupabase
    .from("remnants")
    .select("id,moraware_remnant_id,company_id,status,deleted_at")
    .eq("id", visibleRemnant.internal_remnant_id)
    .maybeSingle();

  if (remnantError) throw remnantError;

  if (!resolvedRemnant || resolvedRemnant.deleted_at) {
    const error = new Error("Remnant not found");
    error.statusCode = 404;
    throw error;
  }
  if (resolvedRemnant.status === "sold") {
    const error = new Error("Sold remnants cannot receive hold requests");
    error.statusCode = 400;
    throw error;
  }

  if (salesRepUserId) {
    const validSalesReps = await fetchSalesRepRows({
      companyId: Number(resolvedRemnant.company_id || 1),
    });
    const isValidSalesRep = validSalesReps.some((row) => String(row.id) === salesRepUserId);
    if (!isValidSalesRep) {
      const error = new Error("Selected sales rep is not available for this remnant");
      error.statusCode = 400;
      throw error;
    }
  }

  const salesRepProfile = salesRepUserId
    ? await fetchProfileSummary(serviceSupabase, salesRepUserId)
    : null;

  const insertPayload = {
    remnant_id: resolvedRemnant.id,
    company_id: resolvedRemnant.company_id || null,
    requester_name: requesterName,
    requester_email: requesterEmail,
    sales_rep_user_id: salesRepUserId || null,
    sales_rep_name: salesRepProfile?.full_name || salesRepName || null,
    notes: String(body.notes || "").trim() || null,
    job_number: String(body.job_number || "").trim() || null,
    status: "pending",
  };

  const { data: createdRequest, error } = await serviceSupabase
    .from("hold_requests")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) throw error;

  runBestEffort(async () => {
    const notificationRow = await queueNotification(serviceSupabase, {
      notification_type: "hold_request_created",
      target_user_id: salesRepUserId || null,
      target_email: salesRepProfile?.email || null,
      remnant_id: resolvedRemnant.id,
      hold_request_id: createdRequest?.id || null,
      payload: {
        requester_name: requesterName,
        requester_email: requesterEmail,
        job_number: insertPayload.job_number,
      },
    });

    if (notificationRow?.id) {
      if (!salesRepProfile?.email) {
        await updateNotificationStatus(
          serviceSupabase,
          notificationRow.id,
          "failed",
          "No sales rep email available for this hold request",
        );
      } else if (!isSmtpConfigured()) {
        await updateNotificationStatus(
          serviceSupabase,
          notificationRow.id,
          "failed",
          "SMTP is not configured on the server",
        );
      } else {
        try {
          await sendHoldRequestEmail({
            salesRep: salesRepProfile,
            holdRequest: {
              ...insertPayload,
              external_remnant_id: externalRemnantId,
            },
            remnant: visibleRemnant,
          });
          await updateNotificationStatus(serviceSupabase, notificationRow.id, "sent");
        } catch (emailError) {
          await updateNotificationStatus(serviceSupabase, notificationRow.id, "failed", emailError?.message || emailError);
        }
      }
    }

    await writeAuditLog(serviceSupabase, {
      event_type: "hold_request_created",
      entity_type: "hold_request",
      entity_id: createdRequest?.id || null,
      remnant_id: resolvedRemnant.id,
      company_id: resolvedRemnant.company_id || null,
      message: `Created public hold request for remnant #${externalRemnantId}`,
      new_data: insertPayload,
      meta: {
        source: "public",
        hold_request_id: createdRequest?.id || null,
        external_remnant_id: externalRemnantId,
        requester_name: requesterName,
        requester_email: requesterEmail,
      },
    });
  }, "Hold request sidecar");

  return { success: true };
}
