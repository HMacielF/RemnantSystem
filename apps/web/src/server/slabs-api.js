import {
  getWriteClient,
  getReadClient,
  asNumber,
  normalizePriceValue,
  parseMeasurement,
  dedupeStringList,
  dedupeColorList,
  sanitizeExternalHttpUrl,
  writeAuditLog,
  runBestEffort,
} from "./api-utils.js";
import { uniqueSortedThicknesses } from "./thicknessOrder.js";

export const SLAB_SELECT = `
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
  slab_colors(role,color:colors(id,name,active)),
  slab_finishes(finish:finishes(id,name,active)),
  slab_thicknesses(thickness:thicknesses(id,name,active))
`;

function normalizeStoneLookupKeyPart(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueSortedStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
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

export function createGroupedNaturalStoneRows(rows = []) {
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

export function buildSlabCatalogOptions(rows = []) {
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

export function applySlabCatalogFilters(rows = [], filters = {}) {
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

export function sortSlabCatalogRows(rows = [], priceSort = "default") {
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

export function filterPricedSlabCatalogRows(rows = [], priceSort = "default") {
  if (priceSort !== "low" && priceSort !== "high") {
    return rows;
  }

  return rows.filter((row) => normalizePriceValue(row?.price_per_sqft) !== null);
}

export function normalizeSlabRow(row, priceRows = [], pricePerSqft = null) {
  const slabColors = Array.isArray(row?.slab_colors) ? row.slab_colors : [];
  const stoneProductColors = Array.isArray(row?.stone_product?.stone_product_colors)
    ? row.stone_product.stone_product_colors
    : [];
  const slabFinishes = Array.isArray(row?.slab_finishes) ? row.slab_finishes : [];
  const slabThicknesses = Array.isArray(row?.slab_thicknesses) ? row.slab_thicknesses : [];

  const colorSource = slabColors.length ? slabColors : stoneProductColors;
  const normalizedColors = dedupeColorList(
    colorSource
      .filter((item) => item?.color?.active !== false)
      .map((item) => item?.color?.name)
      .filter(Boolean),
  );
  const finishes = dedupeStringList(
    slabFinishes
      .filter((item) => item?.finish?.active !== false)
      .map((item) => item?.finish?.name)
      .filter(Boolean),
  );
  const thicknesses = dedupeStringList(
    slabThicknesses
      .filter((item) => item?.thickness?.active !== false)
      .map((item) => item?.thickness?.name)
      .filter(Boolean),
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

export function normalizeEditableSlabRow(row) {
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

export async function replaceSlabColors(writeClient, slabId, colorNames) {
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

export async function replaceSlabFinishes(writeClient, slabId, finishNames) {
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

export async function replaceSlabThicknesses(writeClient, slabId, thicknessNames) {
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

export async function ensureSlabStoneProduct(writeClient, payload) {
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
    .upsert(
      {
        material_id: materialId,
        display_name: displayName,
        stone_name: stoneName,
        brand_name: brandName,
        active: true,
      },
      { onConflict: "material_id,normalized_name", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (createError) throw createError;
  if (created?.id) return created.id;

  const { data: existing, error: existingError } = await writeClient
    .from("stone_products")
    .select("id")
    .eq("material_id", materialId)
    .eq("normalized_name", normalizedDisplayName)
    .maybeSingle();

  if (existingError) throw existingError;
  return existing?.id || null;
}

export function normalizeSlabPayload(body) {
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

export function validateSlabPayload(payload, body) {
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
    finishes: normalizedPayload.finishes !== undefined ? normalizedPayload.finishes : (existingSlab?.slab_finishes || []).map((item) => item?.finish?.name).filter(Boolean),
    thicknesses: normalizedPayload.thicknesses !== undefined ? normalizedPayload.thicknesses : (existingSlab?.slab_thicknesses || []).map((item) => item?.thickness?.name).filter(Boolean),
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
