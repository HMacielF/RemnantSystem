import {
  getWriteClient,
  formatRemnant,
  formatHold,
  formatSale,
  REMNANT_SELECT,
  REMNANT_WITH_STONE_SELECT,
  HOLD_SELECT,
  SALE_SELECT,
  withRemnantPriceFallback,
  extractStoneProductColors,
  withSharedStoneColorFallback,
  fetchRelevantHoldMap,
  fetchRelevantHoldForRemnant,
  fetchLatestSaleMap,
  fetchLatestSaleForRemnant,
  fetchStatusActorMap,
  fetchRemnantStatusRow,
  attachHoldToRows,
  attachSaleToRows,
  attachStatusMetaToRows,
  fetchMaterialIdsByNames,
  filterFormattedRowsByMaterial,
  fetchStoneProductIdsByBrandSearch,
  fetchStoneProductIdsByColorSearch,
  fetchRemnantIdsByFinishSearch,
  fetchStoneProductLookupRows,
  ensureStoneProduct,
  replaceStoneProductColors,
  upsertRemnantManualPrice,
  uploadImageIfPresent,
  normalizePayload,
  validateRemnantPayload,
  writeAuditLog,
  runBestEffort,
  cancelPendingHoldNotifications,
  createRequiredAuthedContext,
  fetchProfile,
  isPrivilegedProfile,
  isOwnCompanyStatusUser,
  ensureHoldPermission,
  ensureSalePermission,
  escapeLikeValue,
  extractRemnantIdSearch,
  parseMeasurement,
  normalizeStatus,
  asNumber,
  dedupeColorList,
} from "./api-utils.js";

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
  const archivedRequest = String(searchParams.get("archived") || "").trim().toLowerCase();

  const requiredAuthed =
    authContext ||
    await createRequiredAuthedContext(request, ["super_admin", "manager", "status_user"]);
  if (requiredAuthed?.errorResponse) {
    const error = new Error("Not authenticated");
    error.statusCode = 401;
    throw error;
  }

  const includeArchived =
    requiredAuthed?.profile?.system_role === "super_admin"
    && (archivedRequest === "1" || archivedRequest === "true" || archivedRequest === "all" || archivedRequest === "include");

  let resolvedMaterialIds = [...materialIds];
  // Archived rows are hidden by an RLS policy on public.remnants
  // (`using (deleted_at is null)`). When a super admin asks for the
  // archived-only view we route through the service-role client so
  // those rows become visible; everything else keeps using the
  // auth-scoped client so per-role scoping stays intact.
  const queryClient = includeArchived
    ? getWriteClient(requiredAuthed.client)
    : requiredAuthed.client;
  let query = queryClient
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
    .order("moraware_remnant_id", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (includeArchived) {
    query = query.not("deleted_at", "is", null);
  } else {
    query = query.is("deleted_at", null);
  }

  if (materialIds.length > 0) {
    query = query.in("material_id", materialIds);
  } else if (materialNames.length > 0) {
    const materialNameIds = await fetchMaterialIdsByNames(materialNames);
    if (materialNameIds.length === 0) return [];
    resolvedMaterialIds = materialNameIds;
    query = query.in("material_id", materialNameIds);
  }
  const [brandMatchedStoneProductIds, colorMatchedStoneProductIds, finishMatchedRemnantIds, companyMatchedIds] = stone
    ? await Promise.all([
        fetchStoneProductIdsByBrandSearch(getWriteClient(requiredAuthed.client), stone),
        fetchStoneProductIdsByColorSearch(getWriteClient(requiredAuthed.client), stone),
        fetchRemnantIdsByFinishSearch(getWriteClient(requiredAuthed.client), stone),
        (async () => {
          const { data: companyRows, error: companyError } = await getWriteClient(requiredAuthed.client)
            .from("companies")
            .select("id")
            .ilike("name", `%${stoneLike}%`);
          if (companyError) throw companyError;
          return (companyRows || []).map((row) => row.id).filter(Boolean);
        })(),
      ])
    : [[], [], [], []];
  const matchedStoneProductIds = [...new Set([...brandMatchedStoneProductIds, ...colorMatchedStoneProductIds])];
  if (stone && searchedRemnantId !== null) {
    const orFilters = [`name.ilike.%${stoneLike}%`, `moraware_remnant_id.eq.${searchedRemnantId}`];
    if (matchedStoneProductIds.length) {
      orFilters.push(`stone_product_id.in.(${matchedStoneProductIds.join(",")})`);
    }
    if (finishMatchedRemnantIds.length) {
      orFilters.push(`id.in.(${finishMatchedRemnantIds.join(",")})`);
    }
    if (companyMatchedIds.length) {
      orFilters.push(`company_id.in.(${companyMatchedIds.join(",")})`);
    }
    query = query.or(orFilters.join(","));
  } else if (stone) {
    if (matchedStoneProductIds.length || finishMatchedRemnantIds.length || companyMatchedIds.length) {
      const orFilters = [`name.ilike.%${stoneLike}%`];
      if (matchedStoneProductIds.length) {
        orFilters.push(`stone_product_id.in.(${matchedStoneProductIds.join(",")})`);
      }
      if (finishMatchedRemnantIds.length) {
        orFilters.push(`id.in.(${finishMatchedRemnantIds.join(",")})`);
      }
      if (companyMatchedIds.length) {
        orFilters.push(`company_id.in.(${companyMatchedIds.join(",")})`);
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

export async function createRemnant(client, authed, body) {
  const writeClient = getWriteClient(client);
  const payload = normalizePayload(body || {});
  const validationError = validateRemnantPayload(payload);
  if (validationError) {
    const error = new Error(validationError);
    error.statusCode = 400;
    throw error;
  }

  const isAdmin = authed.profile.system_role === "super_admin";
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
    status: isAdmin ? payload.status : "pending_approval",
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

export async function fetchPendingApprovals(client) {
  const writeClient = getWriteClient(client);
  const { data, error } = await writeClient
    .from("remnants")
    .select(REMNANT_SELECT)
    .eq("status", "pending_approval")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(formatRemnant);
}

export async function approveRemnant(client, authed, remnantId) {
  const writeClient = getWriteClient(client);
  const { data, error } = await writeClient
    .from("remnants")
    .update({ status: "available" })
    .eq("id", remnantId)
    .eq("status", "pending_approval")
    .is("deleted_at", null)
    .select(REMNANT_SELECT)
    .single();
  if (error) throw error;
  if (!data) {
    const notFound = new Error("Remnant not found or not pending approval");
    notFound.statusCode = 404;
    throw notFound;
  }
  runBestEffort(async () => {
    await writeAuditLog(writeClient, authed, {
      event_type: "remnant_approved",
      entity_type: "remnant",
      entity_id: data.id,
      remnant_id: data.id,
      company_id: data.company_id,
      message: `Approved remnant #${data.moraware_remnant_id || data.id} — now available`,
      new_data: data,
      meta: { source: "api", action: "approve" },
    });
  }, "Approve remnant audit");
  return formatRemnant(data);
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
  const hasImage = body?.image_file instanceof Blob || Boolean(body?.image_file?.dataUrl);
  if (!hasImage) {
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

async function clearRemnantImageRow(writeClient, remnantId) {
  const { data: existingRemnant, error: existingError } = await writeClient
    .from("remnants")
    .select("id,moraware_remnant_id,company_id,image,image_path")
    .eq("id", remnantId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existingRemnant) {
    const error = new Error("Remnant not found");
    error.statusCode = 404;
    throw error;
  }

  const { data, error } = await writeClient
    .from("remnants")
    .update({ image: null, image_path: null })
    .eq("id", remnantId)
    .select(REMNANT_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const nextError = new Error("Remnant not found");
    nextError.statusCode = 404;
    throw nextError;
  }

  return { existingRemnant, data };
}

export async function unlinkRemnantImage(client, authed, remnantId) {
  if (!remnantId) {
    const error = new Error("Invalid remnant id");
    error.statusCode = 400;
    throw error;
  }
  const writeClient = getWriteClient(client);
  const { existingRemnant, data } = await clearRemnantImageRow(writeClient, remnantId);

  runBestEffort(async () => {
    await writeAuditLog(writeClient, authed, {
      event_type: "remnant_image_unlinked",
      entity_type: "remnant",
      entity_id: data.id,
      remnant_id: data.id,
      company_id: data.company_id,
      message: `Unlinked image for remnant #${data.moraware_remnant_id || data.id}`,
      old_data: existingRemnant,
      new_data: {
        id: data.id,
        moraware_remnant_id: data.moraware_remnant_id,
        company_id: data.company_id,
        image: null,
        image_path: null,
      },
      meta: { source: "api", action: "image_unlink" },
    });
  }, "Unlink remnant image audit");

  const [pricedRow] = await withRemnantPriceFallback(writeClient, [data]);
  return formatRemnant(pricedRow);
}

export async function deleteRemnantImage(client, authed, remnantId) {
  if (!remnantId) {
    const error = new Error("Invalid remnant id");
    error.statusCode = 400;
    throw error;
  }
  const writeClient = getWriteClient(client);
  const { existingRemnant, data } = await clearRemnantImageRow(writeClient, remnantId);

  const bucket = process.env.SUPABASE_BUCKET || "remnant-images";
  const oldPath = String(existingRemnant?.image_path || "").trim();
  let storageRemoved = false;
  if (oldPath) {
    try {
      const { error: removeError } = await writeClient.storage.from(bucket).remove([oldPath]);
      if (!removeError) storageRemoved = true;
      else {
        // Treat 404-ish responses (already gone) as a successful no-op.
        const message = String(removeError?.message || "").toLowerCase();
        if (message.includes("not found") || message.includes("does not exist")) {
          storageRemoved = true;
        } else {
          throw removeError;
        }
      }
    } catch (storageError) {
      runBestEffort(async () => {
        console.warn("[deleteRemnantImage] storage remove failed", oldPath, storageError);
      }, "Storage remove warning");
    }
  } else {
    storageRemoved = true; // nothing to remove
  }

  runBestEffort(async () => {
    await writeAuditLog(writeClient, authed, {
      event_type: "remnant_image_deleted",
      entity_type: "remnant",
      entity_id: data.id,
      remnant_id: data.id,
      company_id: data.company_id,
      message: `Deleted image for remnant #${data.moraware_remnant_id || data.id}`,
      old_data: existingRemnant,
      new_data: {
        id: data.id,
        moraware_remnant_id: data.moraware_remnant_id,
        company_id: data.company_id,
        image: null,
        image_path: null,
        storage_removed: storageRemoved,
      },
      meta: { source: "api", action: "image_delete", bucket, path: oldPath || null },
    });
  }, "Delete remnant image audit");

  const [pricedRow] = await withRemnantPriceFallback(writeClient, [data]);
  return formatRemnant(pricedRow);
}

export async function fetchExternalIdsSummary(client) {
  const writeClient = getWriteClient(client);
  const { data, error } = await writeClient
    .from("remnants")
    .select("id, moraware_remnant_id, name, status")
    .is("deleted_at", null)
    .not("moraware_remnant_id", "is", null)
    .order("moraware_remnant_id", { ascending: true });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  let max = 0;
  const used = rows.map((row) => {
    const externalId = Number(row.moraware_remnant_id);
    if (Number.isFinite(externalId) && externalId > max) max = externalId;
    return {
      id: externalId,
      remnant_id: row.id,
      status: String(row.status || "").trim().toLowerCase() || "available",
      name: String(row.name || "").trim() || null,
    };
  });
  return { max, used };
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
