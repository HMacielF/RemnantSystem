const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const OUTPUT_DIR = path.join(__dirname, "..", "scrapers", "slab_scraper", "output");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SUPPLIERS = [
  {
    key: "cambria",
    supplierName: "Cambria",
    websiteUrl: "https://www.cambriausa.com",
    filePrefix: "cambria_quartz_",
  },
  {
    key: "caesarstone",
    supplierName: "Caesarstone",
    websiteUrl: "https://www.caesarstoneus.com",
    filePrefix: "caesarstone_quartz_",
  },
];

function latestFile(prefix, suffix = ".json") {
  const dir = path.join(OUTPUT_DIR, prefix.replace(/_quartz_$/, ""));
  const files = fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .sort();
  if (!files.length) throw new Error(`No files found for prefix ${prefix}`);
  return path.join(dir, files[files.length - 1]);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function splitList(value) {
  if (!value || typeof value !== "string") return [];
  return [...new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function sanitizeProductName(value) {
  return String(value || "")
    .replace(/[®™]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCatalogName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[®™*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferBrandNameFromSupplier(supplierName) {
  const normalized = normalizeCatalogName(supplierName);
  if (normalized === "cambria") return "Cambria";
  if (normalized === "caesarstone") return "Caesarstone";
  return null;
}

function normalizeMaterial(value) {
  return (value || "").trim() || "Quartz";
}

function parseDimensions(value) {
  const raw = String(value || "").trim();
  if (!raw) return { width: null, height: null };
  const parts = raw.split(/\s*[xX]\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { width: null, height: null };
  return { width: `${parts[0]}″`, height: `${parts[1]}″` };
}

function normalizeFinish(value) {
  if (!value) return null;
  const lowered = String(value).trim().toLowerCase();
  if (!lowered) return null;
  if (lowered === "polish" || lowered === "polished") return "Polished";
  if (lowered === "satin") return "Satin";
  if (lowered === "matte") return "Matte";
  if (lowered === "honed") return "Honed";
  if (lowered === "concrete") return "Concrete";
  if (lowered === "natural") return "Natural";
  if (lowered === "rough") return "Rough";
  return sanitizeProductName(value);
}

function normalizeThicknessToken(value) {
  const compact = String(value || "")
    .toLowerCase()
    .replace(/\\/g, "")
    .replace(/"/g, "")
    .replace(/\s+/g, "");
  if (!compact) return null;
  if (compact === "11/4" || compact === "1-1/4") return "3 CM";
  if (compact === "3/4") return "2 CM";
  if (compact === "1cm") return "1 CM";
  if (compact === "1.2cm" || compact === "12mm") return "12 MM";
  if (compact === "1.5cm" || compact === "15mm") return "15 MM";
  if (compact === "2cm" || compact === "2.0cm" || compact === "20mm") return "2 CM";
  if (compact === "3cm" || compact === "3.0cm" || compact === "30mm") return "3 CM";
  if (compact === "6mm") return "6 MM";
  return null;
}

function parseThicknesses(value) {
  return [...new Set(
    String(value || "")
      .split(/[;,|]/)
      .map((token) => normalizeThicknessToken(token))
      .filter(Boolean)
  )];
}

function buildRows() {
  const rows = [];

  for (const supplier of SUPPLIERS) {
    const sourceRows = readJson(latestFile(supplier.filePrefix));
    for (const row of sourceRows) {
      const dimensions = parseDimensions(row.dimensions);
      rows.push({
        supplierName: supplier.supplierName,
        websiteUrl: supplier.websiteUrl,
        name: sanitizeProductName(row.name),
        materialName: normalizeMaterial(row.material),
        detailUrl: row.detail_url,
        imageUrl: row.image_url || null,
        width: dimensions.width,
        height: dimensions.height,
        colorTone: null,
        thicknesses: parseThicknesses(row.thickness),
        finishes: splitList(row.finishes).map(normalizeFinish).filter(Boolean),
        primaryColors: splitList(row.primary_colors),
        accentColors: splitList(row.accent_colors),
      });
    }
  }

  return rows.filter((row) => row.name && row.detailUrl);
}

async function upsertLookup(table, name, extra = {}) {
  const { data, error } = await supabase
    .from(table)
    .upsert({ name, ...extra }, { onConflict: "name" })
    .select("id,name")
    .single();
  if (error) throw error;
  return data;
}

async function getMaterialId(name) {
  const { data, error } = await supabase
    .from("materials")
    .upsert({ name, active: true }, { onConflict: "name" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function getThicknessId(name) {
  const { data, error } = await supabase
    .from("thicknesses")
    .upsert({ name, active: true }, { onConflict: "name" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function getOrCreateStoneProductId(materialId, supplierName, slabName) {
  const stoneName = sanitizeProductName(slabName);
  const brandName = inferBrandNameFromSupplier(supplierName);
  const displayName = brandName ? `${brandName} ${stoneName}` : stoneName;
  const normalizedStoneName = normalizeCatalogName(stoneName);

  const { data: existingRows, error: existingError } = await supabase
    .from("stone_products")
    .select("id,brand_name,stone_name,display_name")
    .eq("material_id", materialId)
    .limit(1000);
  if (existingError) throw existingError;

  const candidates = (existingRows || []).filter((row) => normalizeCatalogName(row.stone_name) === normalizedStoneName);
  const exactBrand = candidates.find((row) => normalizeCatalogName(row.brand_name) === normalizeCatalogName(brandName));
  const brandless = candidates.find((row) => !normalizeCatalogName(row.brand_name));
  const existing = exactBrand || brandless || candidates[0] || null;

  if (existing?.id) {
    const updatePayload = {};
    if (brandName && !existing.brand_name) updatePayload.brand_name = brandName;
    if (existing.stone_name !== stoneName) updatePayload.stone_name = stoneName;
    if (existing.display_name !== displayName) updatePayload.display_name = displayName;
    if (Object.keys(updatePayload).length > 0) {
      const { error: updateError } = await supabase.from("stone_products").update(updatePayload).eq("id", existing.id);
      if (updateError) throw updateError;
    }
    return existing.id;
  }

  const { data, error } = await supabase
    .from("stone_products")
    .insert({
      material_id: materialId,
      display_name: displayName,
      stone_name: stoneName,
      brand_name: brandName,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function replaceJoinRows(table, column, slabId, rows) {
  const { error: deleteError } = await supabase.from(table).delete().eq("slab_id", slabId);
  if (deleteError) throw deleteError;
  if (!rows.length) return;
  const { error: insertError } = await supabase.from(table).insert(rows.map((value) => ({
    slab_id: slabId,
    [column]: value.id,
    ...(value.role ? { role: value.role } : {}),
  })));
  if (insertError) throw insertError;
}

async function upsertStoneProductColors(stoneProductId, rows) {
  if (!stoneProductId || !rows.length) return;
  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${stoneProductId}:${row.id}:${row.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      stone_product_id: stoneProductId,
      color_id: row.id,
      role: row.role || "primary",
    });
  }
  const { error } = await supabase
    .from("stone_product_colors")
    .upsert(deduped, { onConflict: "stone_product_id,color_id,role" });
  if (error) throw error;
}

async function upsertSlab(row, supplierId, materialId) {
  const stoneProductId = await getOrCreateStoneProductId(materialId, row.supplierName, row.name);
  const { data: existingRows, error: existingError } = await supabase
    .from("slabs")
    .select("id")
    .eq("supplier_id", supplierId)
    .eq("material_id", materialId)
    .eq("name", row.name)
    .limit(1);
  if (existingError) throw existingError;

  const payload = {
    supplier_id: supplierId,
    material_id: materialId,
    name: row.name,
    width: row.width,
    height: row.height,
    color_tone: row.colorTone,
    detail_url: row.detailUrl,
    image_url: row.imageUrl,
    stone_product_id: stoneProductId,
    active: true,
  };

  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (existing?.id) {
    const { data, error } = await supabase
      .from("slabs")
      .update(payload)
      .eq("id", existing.id)
      .select("id,stone_product_id")
      .single();
    if (error) throw error;
    return { ...data, stone_product_id: stoneProductId };
  }

  const { data, error } = await supabase
    .from("slabs")
    .insert(payload)
    .select("id,stone_product_id")
    .single();
  if (error) throw error;
  return { ...data, stone_product_id: stoneProductId };
}

async function main() {
  const sourceRows = buildRows();
  const supplierCache = new Map();
  const colorCache = new Map();
  const finishCache = new Map();
  const materialCache = new Map();
  const thicknessCache = new Map();

  for (const row of sourceRows) {
    if (!supplierCache.has(row.supplierName)) {
      const supplier = await upsertLookup("suppliers", row.supplierName, {
        website_url: row.websiteUrl,
        active: true,
      });
      supplierCache.set(row.supplierName, supplier.id);
    }

    if (!materialCache.has(row.materialName)) {
      materialCache.set(row.materialName, await getMaterialId(row.materialName));
    }

    const slab = await upsertSlab(row, supplierCache.get(row.supplierName), materialCache.get(row.materialName));

    const thicknessRows = [];
    for (const thicknessName of row.thicknesses) {
      if (!thicknessCache.has(thicknessName)) {
        thicknessCache.set(thicknessName, await getThicknessId(thicknessName));
      }
      thicknessRows.push({ id: thicknessCache.get(thicknessName) });
    }

    const finishRows = [];
    for (const finishName of row.finishes) {
      if (!finishCache.has(finishName)) {
        const finish = await upsertLookup("finishes", finishName, { active: true });
        finishCache.set(finishName, finish.id);
      }
      finishRows.push({ id: finishCache.get(finishName) });
    }

    const colorRows = [];
    for (const colorName of row.primaryColors) {
      if (!colorCache.has(colorName)) {
        const color = await upsertLookup("colors", colorName, { active: true });
        colorCache.set(colorName, color.id);
      }
      colorRows.push({ id: colorCache.get(colorName), role: "primary" });
    }
    for (const colorName of row.accentColors) {
      if (!colorCache.has(colorName)) {
        const color = await upsertLookup("colors", colorName, { active: true });
        colorCache.set(colorName, color.id);
      }
      colorRows.push({ id: colorCache.get(colorName), role: "accent" });
    }

    await replaceJoinRows("slab_thicknesses", "thickness_id", slab.id, thicknessRows);
    await replaceJoinRows("slab_finishes", "finish_id", slab.id, finishRows);
    await replaceJoinRows("slab_colors", "color_id", slab.id, colorRows);
    await upsertStoneProductColors(slab.stone_product_id, colorRows);
  }

  console.log(`Safely imported ${sourceRows.length} Cambria/Caesarstone slab records.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
