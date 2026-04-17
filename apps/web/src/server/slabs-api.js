import {
  getWriteClient,
  getReadClient,
  SLAB_SELECT,
  normalizeSlabRow,
  normalizeEditableSlabRow,
  normalizeSlabPayload,
  validateSlabPayload,
  buildSlabCatalogOptions,
  applySlabCatalogFilters,
  createGroupedNaturalStoneRows,
  filterPricedSlabCatalogRows,
  sortSlabCatalogRows,
  replaceSlabColors,
  replaceSlabFinishes,
  replaceSlabThicknesses,
  ensureSlabStoneProduct,
  normalizePriceValue,
  asNumber,
  writeAuditLog,
  runBestEffort,
} from "./api-utils.js";

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
