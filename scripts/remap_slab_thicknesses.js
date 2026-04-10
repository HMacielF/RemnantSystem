const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const REPLACEMENTS = {
  606: ["3 CM"],
  615: ["2 CM", "3 CM"],
  1000: ["2 CM", "3 CM"],
  1001: ["2 CM"],
  1002: ["3 CM"],
  1003: ["15 MM"],
  1004: ["12 MM"],
  996: ["3 CM"],
  997: ["3 CM"],
  999: ["3 CM"],
};

async function getThicknessId(name) {
  const { data: existing, error: existingError } = await supabase
    .from("thicknesses")
    .select("id")
    .eq("name", name)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("thicknesses")
    .insert({ name })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function main() {
  const targetIdsByName = {};
  for (const name of [...new Set(Object.values(REPLACEMENTS).flat())]) {
    targetIdsByName[name] = await getThicknessId(name);
  }

  const sourceIds = Object.keys(REPLACEMENTS).map(Number);
  const { data: rows, error } = await supabase
    .from("slab_thicknesses")
    .select("slab_id, thickness_id")
    .in("thickness_id", sourceIds);

  if (error) throw error;

  const slabIds = [...new Set((rows || []).map((row) => row.slab_id))];
  if (slabIds.length === 0) {
    console.log("No affected slab thickness rows found.");
    return;
  }

  const { data: allRows, error: allError } = await supabase
    .from("slab_thicknesses")
    .select("slab_id, thickness_id")
    .in("slab_id", slabIds);

  if (allError) throw allError;

  const bySlab = new Map();
  for (const row of allRows || []) {
    if (!bySlab.has(row.slab_id)) bySlab.set(row.slab_id, new Set());
    bySlab.get(row.slab_id).add(row.thickness_id);
  }

  let updated = 0;
  for (const [slabId, current] of bySlab.entries()) {
    const next = new Set();
    for (const thicknessId of current) {
      const mappedNames = REPLACEMENTS[thicknessId];
      if (mappedNames === undefined) {
        next.add(thicknessId);
        continue;
      }
      for (const name of mappedNames) next.add(targetIdsByName[name]);
    }

    const { error: deleteError } = await supabase
      .from("slab_thicknesses")
      .delete()
      .eq("slab_id", slabId);

    if (deleteError) throw deleteError;

    const insertRows = [...next].map((thickness_id) => ({ slab_id: slabId, thickness_id }));
    if (insertRows.length > 0) {
      const { error: insertError } = await supabase
        .from("slab_thicknesses")
        .insert(insertRows);

      if (insertError) throw insertError;
    }

    updated += 1;
  }

  console.log(JSON.stringify({ updatedSlabs: updated, targetIdsByName }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
