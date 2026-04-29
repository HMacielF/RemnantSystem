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

  if (outcome === "seen") {
    const seenUpdate = {
      last_seen_at: new Date().toISOString(),
      location,
      inventory_hold: false,
    };
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

  const remnantLabel = `#${remnant.moraware_remnant_id || remnant.id}`;
  const message = outcome === "seen"
    ? `Confirmed remnant ${remnantLabel} in inventory`
    : outcome === "issue"
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
        ...(outcome === "seen" ? { inventory_hold: false } : {}),
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
