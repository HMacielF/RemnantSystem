const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

function startOfRunTimestamp() {
  return new Date().toISOString();
}

async function startSlabScrapeRun(supabase, supplierId, importerKey, sourcePath = null) {
  const startedAt = startOfRunTimestamp();
  const { data, error } = await supabase
    .from("slab_scrape_runs")
    .insert({
      supplier_id: supplierId,
      importer_key: importerKey,
      source_path: sourcePath,
      status: "running",
      started_at: startedAt,
      notes: {},
    })
    .select("id,started_at")
    .single();
  if (error) throw error;
  return { id: data.id, startedAt: data.started_at || startedAt };
}

async function touchSeenSlabs(supabase, slabIds, runId, seenAt) {
  const uniqueIds = [...new Set((slabIds || []).filter(Boolean))];
  if (!uniqueIds.length) return 0;

  const { error } = await supabase
    .from("slabs")
    .update({
      last_seen_at: seenAt,
      last_scrape_run_id: runId,
      active: true,
      deactivated_at: null,
    })
    .in("id", uniqueIds);
  if (error) throw error;
  return uniqueIds.length;
}

async function deactivateUnseenSlabs(supabase, supplierId, seenIds, seenAt) {
  const { data: supplierRows, error: fetchError } = await supabase
    .from("slabs")
    .select("id")
    .eq("supplier_id", supplierId);
  if (fetchError) throw fetchError;

  const seen = new Set((seenIds || []).filter(Boolean).map((value) => String(value)));
  const unseenIds = (supplierRows || [])
    .map((row) => row.id)
    .filter((id) => !seen.has(String(id)));

  if (!unseenIds.length) return 0;

  const { error } = await supabase
    .from("slabs")
    .update({
      active: false,
      deactivated_at: seenAt,
    })
    .in("id", unseenIds);
  if (error) throw error;
  return unseenIds.length;
}

async function finalizeSlabScrapeRun(supabase, runId, stats = {}) {
  const { error } = await supabase
    .from("slab_scrape_runs")
    .update({
      status: stats.status || "completed",
      completed_at: new Date().toISOString(),
      seen_count: stats.seenCount || 0,
      inserted_count: stats.insertedCount || 0,
      updated_count: stats.updatedCount || 0,
      deactivated_count: stats.deactivatedCount || 0,
      notes: stats.notes || {},
    })
    .eq("id", runId);
  if (error) throw error;
}

module.exports = {
  startSlabScrapeRun,
  touchSeenSlabs,
  deactivateUnseenSlabs,
  finalizeSlabScrapeRun,
};
