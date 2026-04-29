import {
  getWriteClient,
  formatRemnant,
  REMNANT_WITH_STONE_SELECT,
  writeAuditLog,
  runBestEffort,
  extractRemnantIdSearch,
  asNumber,
} from "./api-utils.js";

export const REMNANT_INVENTORY_CHECK_EVENT = "remnant_inventory_confirmed";

export function normalizeInventoryCheckOutcome(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "seen" || normalized === "exists" || normalized === "confirmed") return "seen";
  if (normalized === "missing" || normalized === "not_found" || normalized === "not-found") return "missing";
  if (normalized === "issue" || normalized === "review" || normalized === "needs_review" || normalized === "needs-review") {
    return "issue";
  }
  if (normalized === "not_in_db" || normalized === "not-in-db" || normalized === "unuploaded" || normalized === "unknown") {
    return "not_in_db";
  }
  if (normalized === "duplicate" || normalized === "duplicate_id" || normalized === "duplicate-id") {
    return "duplicate";
  }
  const error = new Error("Invalid inventory check outcome");
  error.statusCode = 400;
  throw error;
}

export function sanitizeInventorySessionId(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 120) {
    const error = new Error("Session id is required");
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

export async function fetchInventoryCheckAuditRows(client, authed, sessionId) {
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

  let effectiveOutcome = outcome;
  let duplicateLocations = null;
  let priorLocation = null;

  if (outcome === "seen") {
    const sessionAudits = await fetchInventoryCheckAuditRows(client, authed, sessionId);
    const priorAuditsForRemnant = sessionAudits.filter(
      (row) => Number(row.remnant_id) === Number(remnant.id),
    );
    const priorLocationsSet = new Set(
      priorAuditsForRemnant
        .map((row) => String(row?.meta?.location || "").trim())
        .filter(Boolean),
    );
    const currentLocation = String(location || "").trim();

    if (priorLocationsSet.size > 0 && currentLocation && !priorLocationsSet.has(currentLocation)) {
      effectiveOutcome = "duplicate";
      const allLocations = [...new Set([...priorLocationsSet, currentLocation])];
      duplicateLocations = allLocations;
      priorLocation = [...priorLocationsSet][0] || null;
    }
  }

  const remnantUpdate = {
    location,
    inventory_hold: effectiveOutcome === "duplicate",
    ...(effectiveOutcome === "seen" ? { last_seen_at: new Date().toISOString() } : {}),
  };
  const { error: updateError } = await writeClient
    .from("remnants")
    .update(remnantUpdate)
    .eq("id", remnant.id)
    .is("deleted_at", null);
  if (updateError) throw updateError;

  const remnantLabel = `#${remnant.moraware_remnant_id || remnant.id}`;
  const message = effectiveOutcome === "duplicate"
    ? `Duplicate ID — remnant ${remnantLabel} also seen at ${priorLocation || "another zone"}`
    : effectiveOutcome === "seen"
      ? `Confirmed remnant ${remnantLabel} in inventory`
      : effectiveOutcome === "issue"
        ? `Flagged remnant ${remnantLabel} for review`
        : `Marked remnant ${remnantLabel} as not seen in inventory`;

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
      outcome: effectiveOutcome,
      session_id: sessionId,
      entered_number: enteredNumber,
      location,
      ...(duplicateLocations ? { duplicate_locations: duplicateLocations } : {}),
    },
    meta: {
      source: "manage_confirm",
      session_id: sessionId,
      outcome: effectiveOutcome,
      entered_number: enteredNumber,
      location,
      ...(duplicateLocations ? { duplicate_locations: duplicateLocations } : {}),
    },
  });

  return {
    ok: true,
    outcome: effectiveOutcome,
    message,
    duplicate_locations: duplicateLocations,
    remnant: {
      ...formatRemnant({
        ...remnant,
        location,
        inventory_hold: effectiveOutcome === "duplicate",
      }),
      current_hold: null,
    },
  };
}

export async function bulkInventoryHold(client, authed) {
  const writeClient = getWriteClient(client);

  const { data: targetRemnants, error: fetchError } = await writeClient
    .from("remnants")
    .select("id")
    .neq("status", "sold")
    .is("deleted_at", null);
  if (fetchError) throw fetchError;

  if (!targetRemnants?.length) return { ok: true, count: 0 };

  const ids = targetRemnants.map((r) => r.id);
  const { error: updateError } = await writeClient
    .from("remnants")
    .update({ inventory_hold: true })
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
      message: `Started inventory double check — flagged ${count} remnants for verification`,
      new_data: { count, affected_ids: ids },
      meta: { source: "manage_confirm", action: "bulk_inventory_hold" },
    });
  }, "Audit bulk inventory hold");

  return { ok: true, count };
}

export async function endInventoryPass(client, authed, sessionId) {
  const writeClient = getWriteClient(client);
  const normalizedSessionId = sanitizeInventorySessionId(sessionId);

  const { data: flagged, error: fetchError } = await writeClient
    .from("remnants")
    .select("id, moraware_remnant_id, company_id")
    .eq("inventory_hold", true)
    .is("deleted_at", null);
  if (fetchError) throw fetchError;

  if (!flagged?.length) return { ok: true, count: 0, duplicate_skipped: 0 };

  const sessionAudits = await fetchInventoryCheckAuditRows(client, authed, normalizedSessionId);
  const latestOutcomeByRemnantId = new Map();
  for (const row of sessionAudits) {
    const id = Number(row.remnant_id);
    if (!id || latestOutcomeByRemnantId.has(id)) continue;
    latestOutcomeByRemnantId.set(id, row?.meta?.outcome || null);
  }

  const sweepable = flagged.filter(
    (row) => latestOutcomeByRemnantId.get(Number(row.id)) !== "duplicate",
  );
  const duplicateSkipped = flagged.length - sweepable.length;

  if (!sweepable.length) {
    return { ok: true, count: 0, duplicate_skipped: duplicateSkipped };
  }

  const actorUserId = authed?.user?.id || authed?.profile?.id || null;
  const actorEmail = authed?.profile?.email || authed?.user?.email || null;
  const actorRole = authed?.profile?.system_role || null;
  const actorCompanyId = authed?.profile?.company_id || null;

  const auditRows = sweepable.map((row) => {
    const enteredNumber = row.moraware_remnant_id || row.id;
    return {
      actor_user_id: actorUserId,
      actor_email: actorEmail,
      actor_role: actorRole,
      actor_company_id: actorCompanyId,
      event_type: REMNANT_INVENTORY_CHECK_EVENT,
      entity_type: "remnant_inventory_check",
      entity_id: row.id,
      remnant_id: row.id,
      company_id: row.company_id,
      message: `Marked remnant #${enteredNumber} as not seen in inventory`,
      old_data: null,
      new_data: {
        remnant_id: row.id,
        moraware_remnant_id: row.moraware_remnant_id,
        outcome: "missing",
        session_id: normalizedSessionId,
        entered_number: enteredNumber,
      },
      meta: {
        source: "manage_confirm",
        session_id: normalizedSessionId,
        outcome: "missing",
        entered_number: enteredNumber,
        end_of_pass: true,
      },
    };
  });

  const { error: auditError } = await writeClient.from("audit_logs").insert(auditRows);
  if (auditError) throw auditError;

  const sweepIds = sweepable.map((row) => row.id);
  const { error: updateError } = await writeClient
    .from("remnants")
    .update({ inventory_hold: false })
    .in("id", sweepIds)
    .is("deleted_at", null);
  if (updateError) throw updateError;

  return { ok: true, count: sweepIds.length, duplicate_skipped: duplicateSkipped };
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
  const duplicateCount = [...latestByRemnantId.values()].filter((row) => row?.meta?.outcome === "duplicate").length;
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

  const notInDbEntries = notInDbRows.slice(0, 200).map((row) => ({
    id: row.id,
    entered_number: row?.meta?.entered_number || null,
    created_at: row.created_at,
    message: row.message,
  }));

  async function fetchOutcomeEntries(targetOutcome) {
    const audits = [...latestByRemnantId.values()].filter(
      (row) => (row?.meta?.outcome || null) === targetOutcome,
    );
    const ids = audits.map((row) => Number(row.remnant_id)).filter(Boolean);
    if (!ids.length) return [];

    const { data, error: queryError } = await writeClient
      .from("remnants")
      .select(REMNANT_WITH_STONE_SELECT)
      .in("id", ids)
      .is("deleted_at", null);
    if (queryError) throw queryError;

    const byId = new Map(
      (data || []).map((row) => [Number(row.id), formatRemnant(row)]),
    );
    return audits
      .map((audit) => {
        const remnant = byId.get(Number(audit.remnant_id));
        if (!remnant) return null;
        return {
          id: audit.id,
          remnant_id: audit.remnant_id,
          moraware_remnant_id: remnant.moraware_remnant_id,
          name: remnant.name,
          status: remnant.status,
          location: remnant.location,
          image: remnant.image,
          width: remnant.width,
          height: remnant.height,
          l_shape: remnant.l_shape,
          l_width: remnant.l_width,
          l_height: remnant.l_height,
          thickness_name: remnant.thickness_name,
          finish_name: remnant.finish_name,
          company_name: remnant.company_name,
          material_name: remnant.material_name,
          brand_name: remnant.brand_name,
          created_at: audit.created_at,
          end_of_pass: Boolean(audit?.meta?.end_of_pass),
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  const [missingEntries, reviewEntries, duplicateEntries] = await Promise.all([
    fetchOutcomeEntries("missing"),
    fetchOutcomeEntries("issue"),
    fetchOutcomeEntries("duplicate"),
  ]);

  const duplicateEntriesWithLocations = duplicateEntries.map((entry) => {
    const audit = latestByRemnantId.get(Number(entry.remnant_id));
    const locs = audit?.meta?.duplicate_locations || audit?.new_data?.duplicate_locations || [];
    return { ...entry, locations: Array.isArray(locs) ? locs : [] };
  });

  return {
    session_id: normalizedSessionId,
    summary: {
      total_count: totalCount || 0,
      checked_count: checkedCount,
      seen_count: seenCount,
      missing_count: missingCount,
      issue_count: issueCount,
      duplicate_count: duplicateCount,
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
    not_in_db_entries: notInDbEntries,
    missing_entries: missingEntries,
    review_entries: reviewEntries,
    duplicate_entries: duplicateEntriesWithLocations,
  };
}
