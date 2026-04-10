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

dotenv.config();

const OUTPUT_DIR = path.join(__dirname, "..", "scrapers", "slab_scraper", "output");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is required");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for slab import");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
});

function latestFile(prefix, suffix = ".json", pattern = null) {
    const files = fs
        .readdirSync(OUTPUT_DIR, { withFileTypes: true })
        .flatMap((entry) => {
            if (entry.isDirectory()) {
                return fs
                    .readdirSync(path.join(OUTPUT_DIR, entry.name))
                    .map((name) => path.join(entry.name, name));
            }
            return [entry.name];
        })
        .filter((name) => path.basename(name).startsWith(prefix) && name.endsWith(suffix))
        .filter((name) => (pattern ? pattern.test(path.basename(name)) : true))
        .sort();

    if (files.length === 0) {
        throw new Error(`No files found for prefix ${prefix}`);
    }

    return path.join(OUTPUT_DIR, files[files.length - 1]);
}

function maybeReadLatestJson(prefix, suffix = ".json", pattern = null) {
    try {
        return readJson(latestFile(prefix, suffix, pattern));
    } catch (error) {
        if (String(error?.message || "").includes(`No files found for prefix ${prefix}`)) {
            return [];
        }
        throw error;
    }
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
            .filter((item) => item && item.toLowerCase() !== "none")
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
    if (normalized === "msi") return "Q Quartz";
    if (normalized === "cambria") return "Cambria";
    if (normalized === "caesarstone") return "Caesarstone";
    if (normalized === "laminam") return "Laminam";
    if (normalized === "x-tone" || normalized === "xtone") return "X-Tone";
    if (normalized === "cosmos") return "Cosmos";
    return null;
}

function normalizeFinish(value) {
    if (!value || typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const lowered = trimmed.toLowerCase();
    if (lowered === "polish") return "Polished";
    if (lowered === "polished") return "Polished";
    if (lowered === "honed") return "Honed";
    if (lowered === "leather") return "Leathered";
    if (lowered === "leathered") return "Leathered";
    if (lowered === "brushed") return "Brushed";
    if (lowered === "matte") return "Matte";
    if (lowered === "concrete") return "Concrete";

    return sanitizeProductName(trimmed);
}

function normalizedFinishList(value) {
    return [...new Set(splitList(value).map(normalizeFinish).filter(Boolean))];
}

function normalizeThickness(value) {
    if (!value || typeof value !== "string") return null;
    const compact = value
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
    return value.trim();
}

function normalizeMaterial(value) {
    return (value || "").trim() || "Quartz";
}

function parseDimensions(value) {
    const raw = String(value || "").trim();
    if (!raw) return { width: null, height: null };

    const parts = raw.split(/\s*[xX]\s*/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return {
            width: parts[0] || null,
            height: parts[1] || null,
        };
    }

    return { width: null, height: null };
}

function canonicalMsiMergeName(value) {
    return sanitizeProductName(value)
        .replace(/\s*-\s*Concrete Finish$/i, "")
        .replace(/\s*-\s*Matte Finish$/i, "")
        .replace(/\s+Brushed\s*$/i, "")
        .replace(/\s+Honed\s*$/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function buildMergeKey(row) {
    const supplier = row.supplierName || "";
    const material = row.materialName || "";
    const nameKey = supplier === "MSI"
        ? canonicalMsiMergeName(row.name)
        : String(row.name || "").trim().toLowerCase();

    return [supplier, material, nameKey].join("::");
}

function urlVariantScore(detailUrl) {
    const value = String(detailUrl || "").toLowerCase();
    let score = 0;
    if (value.includes("-honed-")) score += 5;
    if (value.includes("-brushed-")) score += 5;
    if (value.includes("-leather-")) score += 5;
    if (value.includes("-matte-")) score += 5;
    if (value.includes("-concrete-")) score += 5;
    return score;
}

function preferCatalogSource(currentRow, candidateRow) {
    if (!currentRow) return candidateRow;
    if (!candidateRow) return currentRow;

    const currentScore = urlVariantScore(currentRow.detailUrl);
    const candidateScore = urlVariantScore(candidateRow.detailUrl);
    if (candidateScore < currentScore) return candidateRow;
    if (candidateScore > currentScore) return currentRow;

    return currentRow;
}

function mergeCatalogRows(rows) {
    const grouped = new Map();

    for (const row of rows) {
        const key = buildMergeKey(row);
        const existing = grouped.get(key);
        if (!existing) {
            grouped.set(key, {
                ...row,
                thicknesses: [...row.thicknesses],
                finishes: [...row.finishes],
                primaryColors: [...row.primaryColors],
                accentColors: [...row.accentColors],
            });
            continue;
        }

        const preferred = preferCatalogSource(existing, row);
        existing.name = preferred.name || existing.name;
        existing.detailUrl = preferred.detailUrl;
        existing.imageUrl = preferred.imageUrl || existing.imageUrl || row.imageUrl || null;
        existing.width = existing.width || row.width || null;
        existing.height = existing.height || row.height || null;
        existing.colorTone = existing.colorTone || row.colorTone || null;
        existing.thicknesses = [...new Set([...existing.thicknesses, ...row.thicknesses])];
        existing.finishes = [...new Set([...existing.finishes, ...row.finishes])];
        existing.primaryColors = [...new Set([...existing.primaryColors, ...row.primaryColors])];
        existing.accentColors = [...new Set([...existing.accentColors, ...row.accentColors])];
    }

    return [...grouped.values()];
}

function buildSupplierRecords() {
    const timestampedJson = /_\d{8}T\d{6}Z\.json$/;
    const veneziaQuartz = maybeReadLatestJson("venezia_quartz_dmv_", ".json", timestampedJson);
    const veneziaPrintedQuartz = maybeReadLatestJson("venezia_printed_quartz_dmv_", ".json", timestampedJson);
    const emerstoneQuartz = maybeReadLatestJson("emerstone_quartz_", ".json", timestampedJson);
    const msiQuartz = maybeReadLatestJson("msi_quartz_", ".json", timestampedJson);
    const msiRetryPath = path.join(OUTPUT_DIR, "msi_quartz_retry_results.json");
    const msiRetries = fs.existsSync(msiRetryPath) ? readJson(msiRetryPath) : [];

    const combinedMsi = [...msiQuartz, ...msiRetries].reduce((map, row) => {
        if (row?.detail_url) map.set(row.detail_url, row);
        return map;
    }, new Map());

    const rows = [
        ...veneziaQuartz.map((row) => ({
            supplierName: "Venezia Surfaces",
            websiteUrl: "https://www.veneziasurfaces.com",
            name: sanitizeProductName(row.name),
            materialName: normalizeMaterial(row.material),
            detailUrl: row.detail_url,
            imageUrl: row.image_url || null,
            width: null,
            height: null,
            colorTone: null,
            thicknesses: [normalizeThickness(row.thickness)].filter(Boolean),
            finishes: [],
            primaryColors: splitList(row.color),
            accentColors: [],
        })),
        ...veneziaPrintedQuartz.map((row) => ({
            supplierName: "Venezia Surfaces",
            websiteUrl: "https://www.veneziasurfaces.com",
            name: sanitizeProductName(row.name),
            materialName: normalizeMaterial(row.material),
            detailUrl: row.detail_url,
            imageUrl: row.image_url || null,
            width: null,
            height: null,
            colorTone: null,
            thicknesses: [normalizeThickness(row.thickness)].filter(Boolean),
            finishes: [],
            primaryColors: splitList(row.color),
            accentColors: [],
        })),
        ...emerstoneQuartz.map((row) => ({
            ...parseDimensions(row.dimensions),
            supplierName: "Emerstone",
            websiteUrl: "https://emerstone.com",
            name: sanitizeProductName(row.name),
            materialName: "Quartz",
            detailUrl: row.detail_url,
            imageUrl: row.image_url || null,
            colorTone: row.color_tone || null,
            thicknesses: [normalizeThickness(row.thickness)].filter(Boolean),
            finishes: normalizedFinishList(row.finishes || "Polished"),
            primaryColors: [],
            accentColors: [],
        })),
        ...[...combinedMsi.values()].map((row) => ({
            supplierName: "MSI",
            websiteUrl: "https://www.msisurfaces.com",
            name: sanitizeProductName(row.name),
            materialName: "Quartz",
            detailUrl: row.detail_url,
            imageUrl: row.image_url || null,
            width: null,
            height: null,
            colorTone: null,
            thicknesses: [],
            finishes: normalizedFinishList(row.finishes),
            primaryColors: splitList(row.primary_colors),
            accentColors: splitList(row.accent_colors),
        })),
    ].filter((row) => row.name && row.detailUrl);

    return mergeCatalogRows(rows);
}

async function upsertLookup(table, name, extra = {}) {
    const payload = { name, ...extra };
    const { data, error } = await supabase
        .from(table)
        .upsert(payload, { onConflict: "name" })
        .select("id,name")
        .single();

    if (error) throw error;
    return data;
}

async function getMaterialId(name) {
    const { data, error } = await supabase
        .from("materials")
        .upsert({ name, active: true }, { onConflict: "name" })
        .select("id,name")
        .single();

    if (error) throw error;
    return data.id;
}

async function getThicknessId(name) {
    const { data, error } = await supabase
        .from("thicknesses")
        .upsert({ name, active: true }, { onConflict: "name" })
        .select("id,name")
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
        .limit(500);

    if (existingError) throw existingError;

    const candidates = (existingRows || []).filter((row) => normalizeCatalogName(row.stone_name) === normalizedStoneName);
    const exactBrand = candidates.find((row) => normalizeCatalogName(row.brand_name) === normalizeCatalogName(brandName));
    const brandless = candidates.find((row) => !normalizeCatalogName(row.brand_name));
    const existing = exactBrand || brandless || candidates[0] || null;

    if (existing?.id) {
        const updatePayload = {};
        if (brandName && !existing.brand_name) updatePayload.brand_name = brandName;
        if (stoneName && existing.stone_name !== stoneName) updatePayload.stone_name = stoneName;
        if (displayName && existing.display_name !== displayName) updatePayload.display_name = displayName;
        if (Object.keys(updatePayload).length > 0) {
            const { error: updateError } = await supabase
                .from("stone_products")
                .update(updatePayload)
                .eq("id", existing.id);
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

async function upsertSlab(row, supplierId, materialId) {
    const stoneProductId = await getOrCreateStoneProductId(materialId, row.supplierName, row.name);
    const existingQuery = await supabase
        .from("slabs")
        .select("id")
        .eq("supplier_id", supplierId)
        .eq("material_id", materialId)
        .eq("name", row.name)
        .limit(1);

    if (existingQuery.error) throw existingQuery.error;

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

    const existing = Array.isArray(existingQuery.data) ? existingQuery.data[0] : null;
    if (existing?.id) {
        const { data, error } = await supabase
            .from("slabs")
            .update(payload)
            .eq("id", existing.id)
            .select("id,detail_url")
            .single();

        if (error) throw error;
        return { ...data, stone_product_id: stoneProductId };
    }

    const { data, error } = await supabase
        .from("slabs")
        .insert(payload)
        .select("id,detail_url")
        .single();

    if (error) throw error;
    return { ...data, stone_product_id: stoneProductId };
}

async function importCatalog() {
    const sourceRows = buildSupplierRecords();
    const supplierCache = new Map();
    const colorCache = new Map();
    const finishCache = new Map();
    const materialCache = new Map();
    const thicknessCache = new Map();

    const supplierRuns = new Map();
    const seenBySupplierId = new Map();
    let importedCount = 0;

    try {
    for (const row of sourceRows) {
        if (!supplierCache.has(row.supplierName)) {
            const supplier = await upsertLookup("suppliers", row.supplierName, {
                website_url: row.websiteUrl,
                active: true,
            });
            supplierCache.set(row.supplierName, supplier.id);
            const run = await startSlabScrapeRun(
                supabase,
                supplier.id,
                "import_slab_catalog",
                row.websiteUrl || null,
            );
            supplierRuns.set(supplier.id, run);
            seenBySupplierId.set(supplier.id, []);
        }

        if (!materialCache.has(row.materialName)) {
            materialCache.set(row.materialName, await getMaterialId(row.materialName));
        }

        const slab = await upsertSlab(
            row,
            supplierCache.get(row.supplierName),
            materialCache.get(row.materialName),
        );
        seenBySupplierId.get(supplierCache.get(row.supplierName)).push(slab.id);
        importedCount += 1;

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

    for (const [supplierId, run] of supplierRuns.entries()) {
        const seenIds = seenBySupplierId.get(supplierId) || [];
        const seenCount = await touchSeenSlabs(supabase, seenIds, run.id, run.startedAt);
        const deactivatedCount = await deactivateUnseenSlabs(supabase, supplierId, seenIds, run.startedAt);
        await finalizeSlabScrapeRun(supabase, run.id, {
            seenCount,
            insertedCount: 0,
            updatedCount: seenCount,
            deactivatedCount,
            notes: { importer: "import_slab_catalog" },
        });
    }

    console.log(`Imported ${importedCount} slab records into Supabase.`);
  } catch (error) {
    for (const [supplierId, run] of supplierRuns.entries()) {
        const seenIds = seenBySupplierId.get(supplierId) || [];
        await finalizeSlabScrapeRun(supabase, run.id, {
            status: "failed",
            seenCount: seenIds.length,
            insertedCount: 0,
            updatedCount: seenIds.length,
            deactivatedCount: 0,
            notes: { importer: "import_slab_catalog", error: String(error?.message || error) },
        });
    }
    throw error;
  }
}

importCatalog().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
