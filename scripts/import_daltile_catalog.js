const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");
const {
  startSlabScrapeRun,
  touchSeenSlabs,
  deactivateUnseenSlabs,
  finalizeSlabScrapeRun,
} = require("./slab_scrape_tracking");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_DIR = path.join(__dirname, "..", "scrapers", "slab_scraper", "output", "daltile");

if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function latestFile(prefix) {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort();
  if (!files.length) throw new Error(`No files found for prefix ${prefix}`);
  return path.join(OUTPUT_DIR, files[files.length - 1]);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sanitize(value) {
  return String(value || "").replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return sanitize(value).toLowerCase();
}

function splitCsv(value) {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function normalizeFinish(value) {
  const lowered = String(value || "").trim().toLowerCase();
  if (!lowered) return null;
  if (lowered === "polished" || lowered === "polish") return "Polished";
  if (lowered === "matte") return "Matte";
  if (lowered === "honed") return "Honed";
  if (lowered === "leather" || lowered === "leathered") return "Brushed";
  return sanitize(value);
}

function normalizeThicknessToken(value) {
  const compact = String(value || "").toLowerCase().replace(/\s+/g, "");
  if (!compact) return null;
  if (compact === "1cm") return "1 CM";
  if (compact === "2cm" || compact === "20mm") return "2 CM";
  if (compact === "3cm" || compact === "30mm") return "3 CM";
  if (compact === "6mm") return "6 MM";
  if (compact === "12mm") return "12 MM";
  return sanitize(value);
}

function parseThicknesses(value) {
  return [...new Set(
    String(value || "")
      .split(",")
      .flatMap((chunk) => chunk.split("/"))
      .map((token) => normalizeThicknessToken(token))
      .filter(Boolean)
  )];
}

function parseSizePairs(value) {
  return splitCsv(value)
    .map((chunk) => chunk.split(/x/i).map((part) => part.trim()).filter(Boolean))
    .filter((parts) => parts.length >= 2)
    .map(([width, height]) => ({ width, height }));
}

async function getSupplierByName(name) {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id,name")
    .eq("name", name)
    .single();
  if (error) throw error;
  return data;
}

async function upsertNamedLookup(table, name, extra = {}) {
  const { data, error } = await supabase
    .from(table)
    .upsert({ name, ...extra }, { onConflict: "name" })
    .select("id,name")
    .single();
  if (error) throw error;
  return data;
}

async function getStoneProductsByMaterial(materialId) {
  const { data, error } = await supabase
    .from("stone_products")
    .select("id,stone_name,brand_name,display_name")
    .eq("material_id", materialId)
    .limit(5000);
  if (error) throw error;
  return data || [];
}

async function countStoneProductRefs(stoneProductId) {
  const [{ count: slabCount, error: slabError }, { count: colorCount, error: colorError }] = await Promise.all([
    supabase
      .from("slabs")
      .select("*", { count: "exact", head: true })
      .eq("stone_product_id", stoneProductId),
    supabase
      .from("stone_product_colors")
      .select("*", { count: "exact", head: true })
      .eq("stone_product_id", stoneProductId),
  ]);
  if (slabError) throw slabError;
  if (colorError) throw colorError;
  return Number(slabCount || 0) + Number(colorCount || 0);
}

async function ensureStoneProduct(materialId, brandName, stoneName, cache) {
  const key = `${materialId}::${normalize(brandName)}::${normalize(stoneName)}`;
  if (cache.has(key)) return cache.get(key);

  const products = await getStoneProductsByMaterial(materialId);
  const normalizedStoneName = normalize(stoneName);
  const normalizedBrandName = normalize(brandName);
  const normalizedDisplayName = normalize(brandName ? `${brandName} ${stoneName}` : stoneName);
  const exactBrand = products.find((row) =>
    normalize(row.stone_name) === normalizedStoneName &&
    normalize(row.brand_name) === normalizedBrandName
  );
  const displayMatch = products.find((row) => normalize(row.display_name || "") === normalizedDisplayName);
  const brandlessPrefixed = products.find((row) =>
    !normalize(row.brand_name) &&
    normalize(row.stone_name) === normalizedDisplayName
  );
  const brandlessByStone = products.find((row) =>
    !normalize(row.brand_name) &&
    normalize(row.stone_name) === normalizedStoneName
  );
  const existing = exactBrand || displayMatch || brandlessPrefixed || brandlessByStone || null;
  if (existing) {
    if (displayMatch && displayMatch.id !== existing.id) {
      const displayMatchRefs = await countStoneProductRefs(displayMatch.id);
      if (displayMatchRefs === 0) {
        const { error: deleteError } = await supabase
          .from("stone_products")
          .delete()
          .eq("id", displayMatch.id);
        if (deleteError) throw deleteError;
      }
    }

    const updates = {};
    if (brandName && normalize(existing.brand_name) !== normalizedBrandName) {
      updates.brand_name = brandName;
    }
    if (normalize(existing.stone_name) !== normalizedStoneName) {
      updates.stone_name = stoneName;
    }
    if (normalize(existing.display_name || "") !== normalizedDisplayName) {
      updates.display_name = brandName ? `${brandName} ${stoneName}` : stoneName;
    }
    if (Object.keys(updates).length) {
      const { error: updateError } = await supabase
        .from("stone_products")
        .update(updates)
        .eq("id", existing.id);
      if (updateError) throw updateError;
    }
    cache.set(key, existing.id);
    return existing.id;
  }

  const { data, error } = await supabase
    .from("stone_products")
    .insert({
      material_id: materialId,
      display_name: brandName ? `${brandName} ${stoneName}` : stoneName,
      stone_name: stoneName,
      brand_name: brandName || null,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  cache.set(key, data.id);
  return data.id;
}

async function replaceJoinRows(table, column, slabId, names, lookupTable) {
  const { error: deleteError } = await supabase.from(table).delete().eq("slab_id", slabId);
  if (deleteError) throw deleteError;

  for (const name of names) {
    const lookup = await upsertNamedLookup(lookupTable, name, { active: true });
    const { error: insertError } = await supabase.from(table).insert({
      slab_id: slabId,
      [column]: lookup.id,
    });
    if (insertError) throw insertError;
  }
}

function buildRecords(rows, brandName, materialName) {
  const grouped = new Map();

  for (const row of rows) {
    const key = `${materialName}::${normalize(row.name)}`;
    const existing = grouped.get(key) || {
      name: sanitize(row.name),
      brandName,
      materialName,
      detailUrl: row.detail_url || null,
      imageUrl: row.image_url || null,
      widths: [],
      heights: [],
      finishes: new Set(),
      thicknesses: new Set(),
    };

    for (const pair of parseSizePairs(row.size)) {
      if (pair.width && !existing.widths.includes(pair.width)) existing.widths.push(pair.width);
      if (pair.height && !existing.heights.includes(pair.height)) existing.heights.push(pair.height);
    }

    const finish = normalizeFinish(row.finish);
    if (finish) existing.finishes.add(finish);

    for (const thickness of parseThicknesses(row.thickness)) {
      existing.thicknesses.add(thickness);
    }

    if (!existing.imageUrl && row.image_url) existing.imageUrl = row.image_url;
    if (!existing.detailUrl && row.detail_url) existing.detailUrl = row.detail_url;

    grouped.set(key, existing);
  }

  return [...grouped.values()];
}

async function main() {
  const quartzRows = readJson(latestFile("daltile_quartz_"));
  const porcelainRows = readJson(latestFile("daltile_porcelain_"));

  const supplier = await getSupplierByName("Daltile");
  const quartzMaterial = await upsertNamedLookup("materials", "Quartz", { active: true });
  const porcelainMaterial = await upsertNamedLookup("materials", "Porcelain", { active: true });

  const records = [
    ...buildRecords(quartzRows, "One Quartz", "Quartz"),
    ...buildRecords(porcelainRows, "Panoramic", "Porcelain"),
  ];

  const { data: existingSlabs, error: slabsError } = await supabase
    .from("slabs")
    .select("id,name,supplier_id,material_id")
    .eq("supplier_id", supplier.id)
    .limit(5000);
  if (slabsError) throw slabsError;

  const stoneProductCache = new Map();
  let inserted = 0;
  let updated = 0;
  const seenSlabIds = [];
  const run = await startSlabScrapeRun(supabase, supplier.id, "import_daltile_catalog", OUTPUT_DIR);

  try {
    for (const record of records) {
      const materialId = record.materialName === "Quartz" ? quartzMaterial.id : porcelainMaterial.id;
      const stoneProductId = await ensureStoneProduct(materialId, record.brandName, record.name, stoneProductCache);

      const existing = (existingSlabs || []).find((row) =>
        row.supplier_id === supplier.id &&
        row.material_id === materialId &&
        normalize(row.name) === normalize(record.name)
      );

      const payload = {
        supplier_id: supplier.id,
        material_id: materialId,
        stone_product_id: stoneProductId,
        name: record.name,
        width: record.widths.join(", ") || null,
        height: record.heights.join(", ") || null,
        detail_url: record.detailUrl,
        image_url: record.imageUrl,
        active: true,
      };

      let slabId;
      if (existing) {
        const { data, error } = await supabase
          .from("slabs")
          .update(payload)
          .eq("id", existing.id)
          .select("id")
          .single();
        if (error) throw error;
        slabId = data.id;
        updated += 1;
      } else {
        const { data, error } = await supabase
          .from("slabs")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        slabId = data.id;
        inserted += 1;
      }

      seenSlabIds.push(slabId);
      await replaceJoinRows("slab_finishes", "finish_id", slabId, [...record.finishes], "finishes");
      await replaceJoinRows("slab_thicknesses", "thickness_id", slabId, [...record.thicknesses], "thicknesses");
    }

    const seenCount = await touchSeenSlabs(supabase, seenSlabIds, run.id, run.startedAt);
    const deactivatedCount = await deactivateUnseenSlabs(supabase, supplier.id, seenSlabIds, run.startedAt);

  const { data: brandRows, error: brandError } = await supabase
    .from("supplier_brands")
    .select("id,brand_name")
    .eq("supplier_id", supplier.id);
  if (brandError) throw brandError;

  if (!(brandRows || []).some((row) => normalize(row.brand_name) === "one quartz")) {
    const { error } = await supabase.from("supplier_brands").insert({
      supplier_id: supplier.id,
      brand_name: "One Quartz",
      material_id: quartzMaterial.id,
    });
    if (error) throw error;
  }

  if (!(brandRows || []).some((row) => normalize(row.brand_name) === "panoramic")) {
    const { error } = await supabase.from("supplier_brands").insert({
      supplier_id: supplier.id,
      brand_name: "Panoramic",
      material_id: porcelainMaterial.id,
    });
    if (error) throw error;
  }

  const { count: quartzCount, error: quartzCountError } = await supabase
    .from("slabs")
    .select("*", { count: "exact", head: true })
    .eq("supplier_id", supplier.id)
    .eq("material_id", quartzMaterial.id);
  if (quartzCountError) throw quartzCountError;

  const { count: porcelainCount, error: porcelainCountError } = await supabase
    .from("slabs")
    .select("*", { count: "exact", head: true })
    .eq("supplier_id", supplier.id)
    .eq("material_id", porcelainMaterial.id);
  if (porcelainCountError) throw porcelainCountError;

  await finalizeSlabScrapeRun(supabase, run.id, {
    seenCount,
    insertedCount: inserted,
    updatedCount: updated,
    deactivatedCount,
    notes: { supplier: supplier.name, importer: "import_daltile_catalog" },
  });

  console.log(JSON.stringify({
    supplier: supplier.name,
    inserted,
    updated,
    deactivatedCount,
    quartzCount,
    porcelainCount,
  }, null, 2));
  } catch (error) {
    await finalizeSlabScrapeRun(supabase, run.id, {
      status: "failed",
      seenCount: seenSlabIds.length,
      insertedCount: inserted,
      updatedCount: updated,
      deactivatedCount: 0,
      notes: { error: String(error?.message || error) },
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
