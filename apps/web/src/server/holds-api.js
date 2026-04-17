import {
  getWriteClient,
  formatRemnant,
  formatHold,
  formatSale,
  REMNANT_WITH_STONE_SELECT,
  HOLD_SELECT,
  SALE_SELECT,
  withRemnantPriceFallback,
  extractStoneProductColors,
  fetchRemnantStatusRow,
  fetchRelevantHoldForRemnant,
  fetchLatestSaleForRemnant,
  defaultHoldExpirationDate,
  isPrivilegedProfile,
  isOwnCompanyStatusUser,
  ensureHoldPermission,
  ensureSalePermission,
  fetchProfile,
  writeAuditLog,
  runBestEffort,
  cancelPendingHoldNotifications,
  scheduleHoldNotifications,
  queueNotification,
  asNumber,
} from "./api-utils.js";

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
