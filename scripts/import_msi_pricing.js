const path = require("path");
const dotenv = require("dotenv");
const xlsx = require("xlsx");
const { Client } = require("pg");

dotenv.config();

const WORKBOOK_PATH = process.argv[2] || path.join(process.env.HOME || "", "Downloads", "Final Q Pricelist March 2026.xlsx");
const PRICE_SOURCE = "msi_price_list_mar_2026";
const EFFECTIVE_ON = "2026-03-01";
const FEE_PERCENT_1 = 0.06;
const FEE_PERCENT_2 = 0.03;
const PRICE_BAND_START = 10;
const PRICE_BAND_SIZE = 5;

function requireEnv(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function dbConfig() {
  const supabaseUrl = requireEnv(process.env.SUPABASE_URL, "SUPABASE_URL is required");
  const password = requireEnv(process.env.POSTGRES_PASSWORD, "POSTGRES_PASSWORD is required");
  const projectRef = new URL(supabaseUrl).host.split(".")[0];
  return {
    host: `db.${projectRef}.supabase.co`,
    user: "postgres",
    database: "postgres",
    password,
    port: 5432,
    ssl: { rejectUnauthorized: false },
  };
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDimensionToken(value) {
  return normalizeWhitespace(value)
    .replace(/["”“]/g, "")
    .replace(/′/g, "")
    .trim();
}

function formatDimensionValue(value) {
  const cleaned = normalizeDimensionToken(value);
  return cleaned ? `${cleaned}″` : "";
}

function parseSizeLabel(sizeLabel) {
  const pairs = [];
  for (const segment of String(sizeLabel || "").split(",")) {
    const cleaned = normalizeWhitespace(segment).replace(/\s+/g, "");
    if (!cleaned) continue;
    const match = /^([0-9.]+)x([0-9.]+)$/i.exec(cleaned);
    if (!match) continue;
    const width = formatDimensionValue(match[1]);
    const height = formatDimensionValue(match[2]);
    if (width && height) {
      pairs.push({ width, height });
    }
  }
  return pairs;
}

function normalizeSlabLookup(value) {
  return normalizeWhitespace(value)
    .replace(/[®™*]/g, "")
    .replace(/\(discontinued\)/gi, "")
    .replace(/\bbook-?match\b/gi, "")
    .replace(/\bunbook-?match\b/gi, "")
    .replace(/\bnew\b/gi, "")
    .replace(/\b(2cm|3cm|1\.5cm|1\.6cm)\b/gi, "")
    .replace(/\s*-\s*(concrete|matte|honed|brushed)\b/gi, "")
    .replace(/\b(concrete|matte|honed|brushed)\b/gi, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

const SLAB_NAME_ALIASES = new Map([
  ["ivoritaj", "IvoriTaj"],
  ["solitaj", "SoliTaj"],
  ["marfitaj", "MarfiTaj"],
  ["cashmeretaj", "Cashmere Taj"],
]);

function inferFinish(name) {
  const normalized = normalizeWhitespace(name).toLowerCase();
  if (/\bbrushed\b/.test(normalized)) return "Brushed";
  if (/\bhoned\b/.test(normalized)) return "Honed";
  if (/\bmatte\b/.test(normalized)) return "Matte";
  if (/\bconcrete\b/.test(normalized)) return "Concrete";
  return "Polished";
}

function stripVariantSuffixes(name) {
  return normalizeWhitespace(name)
    .replace(/[®™*]/g, "")
    .replace(/\(discontinued\)/gi, "")
    .replace(/\bbook-?match\b/gi, "")
    .replace(/\bunbook-?match\b/gi, "")
    .replace(/\bnew\b/gi, "")
    .replace(/\b(2cm|3cm|1\.5cm|1\.6cm)\b/gi, "")
    .replace(/\s*-\s*(concrete|matte|honed|brushed)\b/gi, "")
    .replace(/\b(concrete|matte|honed|brushed)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveBaseSlabName(name) {
  const stripped = stripVariantSuffixes(name);
  const alias = SLAB_NAME_ALIASES.get(normalizeSlabLookup(stripped));
  return alias || stripped;
}

function codeFromIndex(index) {
  let value = index;
  let code = "";
  do {
    code = String.fromCharCode(65 + (value % 26)) + code;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return code;
}

function bandSortOrderFromPrice(price) {
  const normalized = Number(Number(price).toFixed(4));
  if (!Number.isFinite(normalized)) return null;
  if (normalized <= PRICE_BAND_START) return 0;
  return Math.floor((normalized - PRICE_BAND_START) / PRICE_BAND_SIZE);
}

function formatBandUpperBound(value) {
  const rounded = Math.floor(Number(value) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function getPriceBand(price) {
  const normalized = Number(Number(price).toFixed(4));
  const sortOrder = bandSortOrderFromPrice(normalized);
  if (!Number.isFinite(normalized) || sortOrder === null) return null;

  const minPrice = Number((PRICE_BAND_START + sortOrder * PRICE_BAND_SIZE).toFixed(4));
  const maxPrice = Number((minPrice + PRICE_BAND_SIZE - 0.0001).toFixed(4));

  return {
    code: codeFromIndex(sortOrder),
    sortOrder,
    minPrice,
    maxPrice,
    notes: `MSI quartz price band $${minPrice}-${formatBandUpperBound(maxPrice)} before fees.`,
  };
}

function loadWorkbookRows(filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

  const parsed = [];
  let currentGroup = null;
  let currentGroupLabel = null;

  for (const row of rows) {
    const status = normalizeWhitespace(row[0]);
    const name = normalizeWhitespace(row[1]);
    const sizeLabel = normalizeWhitespace(row[2]);
    const item2cm = normalizeWhitespace(row[3]);
    const item3cm = normalizeWhitespace(row[4]);
    const price2cm = parseNumber(row[5]);
    const price3cm = parseNumber(row[6]);

    const groupMatch = /^Group\s+(\d+)\s+\((\d+)\s+Colors\)$/i.exec(name);
    if (groupMatch) {
      currentGroup = Number(groupMatch[1]);
      currentGroupLabel = name;
      continue;
    }

    const hasSku = item2cm.startsWith("QSL-") || item3cm.startsWith("QSL-");
    const hasPrice = price2cm !== null || price3cm !== null;
    if (!currentGroupLabel || !name || !sizeLabel || !hasSku || !hasPrice) continue;

    parsed.push({
      source_status: status || null,
      supplier_product_name: name,
      source_group_number: currentGroup,
      source_group_label: currentGroupLabel,
      size_label: sizeLabel,
      finish_name: inferFinish(name),
      base_slab_name: resolveBaseSlabName(name),
      item_2cm: item2cm || null,
      item_3cm: item3cm || null,
      price_2cm: price2cm,
      price_3cm: price3cm,
    });
  }

  return parsed;
}

async function loadLookupMaps(client) {
  await client.query(`
    insert into public.thicknesses (name, active)
    values ('2 CM', true), ('3 CM', true)
    on conflict (name) do update
    set active = true
  `);

  const suppliers = await client.query("select id, name from public.suppliers");
  const materials = await client.query("select id, name from public.materials");
  const finishes = await client.query("select id, name from public.finishes");
  const thicknesses = await client.query("select id, name from public.thicknesses");
  const slabs = await client.query(`
    select
      s.id,
      s.name,
      p.name as supplier_name
    from public.slabs s
    join public.suppliers p on p.id = s.supplier_id
    where p.name = 'MSI'
  `);

  return {
    supplierByName: new Map(suppliers.rows.map((row) => [row.name, row.id])),
    materialByName: new Map(materials.rows.map((row) => [row.name, row.id])),
    finishByName: new Map(finishes.rows.map((row) => [row.name, row.id])),
    thicknessByName: new Map(thicknesses.rows.map((row) => [row.name, row.id])),
    slabsByKey: new Map(
      slabs.rows.map((row) => [normalizeSlabLookup(row.name), { id: row.id, name: row.name }]),
    ),
  };
}

function buildEntries(rows, lookups) {
  const supplierId = lookups.supplierByName.get("MSI");
  const materialId = lookups.materialByName.get("Quartz");
  const polishedFinishId = lookups.finishByName.get("Polished") || null;
  const thickness2cmId = lookups.thicknessByName.get("2 CM") || null;
  const thickness3cmId = lookups.thicknessByName.get("3 CM") || null;

  if (!supplierId) throw new Error("Supplier MSI not found");
  if (!materialId) throw new Error("Material Quartz not found");

  const entries = [];
  const catalogBySlabId = new Map();
  const unmatched = [];

  for (const row of rows) {
    const slabMatch =
      lookups.slabsByKey.get(normalizeSlabLookup(row.base_slab_name))
      || lookups.slabsByKey.get(normalizeSlabLookup(SLAB_NAME_ALIASES.get(normalizeSlabLookup(row.base_slab_name)) || ""));

    if (!slabMatch) {
      unmatched.push(row);
      continue;
    }

    const finishId = lookups.finishByName.get(row.finish_name) || polishedFinishId;
    const existingCatalogEntry = catalogBySlabId.get(slabMatch.id) || {
      slab_id: slabMatch.id,
      sizes: [],
      thicknessIds: new Set(),
      finishIds: new Set(),
    };
    for (const pair of parseSizeLabel(row.size_label)) {
      existingCatalogEntry.sizes.push(pair);
    }
    if (finishId) {
      existingCatalogEntry.finishIds.add(finishId);
    }

    if (row.price_2cm !== null || row.item_2cm) {
      if (row.price_2cm !== null) {
        if (thickness2cmId) {
          existingCatalogEntry.thicknessIds.add(thickness2cmId);
        }
        entries.push({
          supplier_id: supplierId,
          slab_id: slabMatch.id,
          material_id: materialId,
          finish_id: finishId,
          thickness_id: thickness2cmId,
          supplier_sku: row.item_2cm,
          supplier_product_name: row.supplier_product_name,
          source_group_number: row.source_group_number,
          source_group_label: row.source_group_label,
          source_status: row.source_status,
          size_label: row.size_label,
          list_price_per_sqft: row.price_2cm,
        });
      }
    }

    if (row.price_3cm !== null || row.item_3cm) {
      if (row.price_3cm !== null) {
        if (thickness3cmId) {
          existingCatalogEntry.thicknessIds.add(thickness3cmId);
        }
        entries.push({
          supplier_id: supplierId,
          slab_id: slabMatch.id,
          material_id: materialId,
          finish_id: finishId,
          thickness_id: thickness3cmId,
          supplier_sku: row.item_3cm,
          supplier_product_name: row.supplier_product_name,
          source_group_number: row.source_group_number,
          source_group_label: row.source_group_label,
          source_status: row.source_status,
          size_label: row.size_label,
          list_price_per_sqft: row.price_3cm,
        });
      }
    }

    catalogBySlabId.set(slabMatch.id, existingCatalogEntry);
  }

  const catalogUpdates = [...catalogBySlabId.values()].map((entry) => {
    const uniquePairs = [];
    const seenPairs = new Set();
    for (const pair of entry.sizes) {
      const key = `${pair.width}|${pair.height}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      uniquePairs.push(pair);
    }
    return {
      slab_id: entry.slab_id,
      widths: uniquePairs.map((pair) => pair.width),
      heights: uniquePairs.map((pair) => pair.height),
      thickness_ids: [...entry.thicknessIds],
      finish_ids: [...entry.finishIds],
    };
  });

  return { entries, unmatched, supplierId, materialId, catalogUpdates };
}

async function replacePricing(client, payload) {
  const uniqueBands = [...new Map(
    payload.entries
      .map((entry) => getPriceBand(entry.list_price_per_sqft))
      .filter(Boolean)
      .map((band) => [band.code, band]),
  ).values()].sort((a, b) => a.sortOrder - b.sortOrder);

  await client.query("begin");
  try {
    await client.query(
      `delete from public.slab_supplier_prices where supplier_id = $1 and price_source = $2`,
      [payload.supplierId, PRICE_SOURCE],
    );
    await client.query(
      `delete from public.supplier_price_tiers where supplier_id = $1 and material_id = $2`,
      [payload.supplierId, payload.materialId],
    );

    const tierIdByPrice = new Map();
    for (const band of uniqueBands) {
      const result = await client.query(
        `
          insert into public.supplier_price_tiers (
            supplier_id,
            material_id,
            code,
            sort_order,
            base_price_per_sqft,
            min_price_per_sqft,
            max_price_per_sqft,
            fixed_fee_per_sqft,
            fee_percent_1,
            fee_percent_2,
            notes
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          returning id
        `,
        [
          payload.supplierId,
          payload.materialId,
          band.code,
          band.sortOrder,
          band.minPrice,
          band.minPrice,
          band.maxPrice,
          0,
          FEE_PERCENT_1,
          FEE_PERCENT_2,
          band.notes,
        ],
      );
      tierIdByPrice.set(band.code, result.rows[0].id);
    }

    for (const entry of payload.entries) {
      const rawPrice = Number(entry.list_price_per_sqft.toFixed(4));
      const band = getPriceBand(rawPrice);
      await client.query(
        `
          insert into public.slab_supplier_prices (
            supplier_id,
            slab_id,
            material_id,
            finish_id,
            thickness_id,
            tier_id,
            supplier_sku,
            supplier_product_name,
            source_group_number,
            source_group_label,
            source_status,
            size_label,
            list_price_per_sqft,
            price_source,
            effective_on,
            active
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true
          )
        `,
        [
          entry.supplier_id,
          entry.slab_id,
          entry.material_id,
          entry.finish_id,
          entry.thickness_id,
          tierIdByPrice.get(band?.code),
          entry.supplier_sku,
          entry.supplier_product_name,
          entry.source_group_number,
          entry.source_group_label,
          entry.source_status,
          entry.size_label,
          rawPrice,
          PRICE_SOURCE,
          EFFECTIVE_ON,
        ],
      );
    }

    for (const update of payload.catalogUpdates || []) {
      const widthValue = update.widths.length ? update.widths.join(", ") : null;
      const heightValue = update.heights.length ? update.heights.join(", ") : null;

      await client.query(
        `
          update public.slabs
          set width = $2,
              height = $3,
              updated_at = now()
          where id = $1
        `,
        [update.slab_id, widthValue, heightValue],
      );

      await client.query(`delete from public.slab_thicknesses where slab_id = $1`, [update.slab_id]);
      for (const thicknessId of update.thickness_ids) {
        await client.query(
          `
            insert into public.slab_thicknesses (slab_id, thickness_id)
            values ($1, $2)
            on conflict do nothing
          `,
          [update.slab_id, thicknessId],
        );
      }

      if (update.finish_ids.length) {
        await client.query(`delete from public.slab_finishes where slab_id = $1`, [update.slab_id]);
        for (const finishId of update.finish_ids) {
          await client.query(
            `
              insert into public.slab_finishes (slab_id, finish_id)
              values ($1, $2)
              on conflict do nothing
            `,
            [update.slab_id, finishId],
          );
        }
      }
    }

    await client.query("commit");
    return { uniquePrices: uniqueBands };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  const workbookRows = loadWorkbookRows(WORKBOOK_PATH);
  const client = new Client(dbConfig());
  await client.connect();

  try {
    const lookups = await loadLookupMaps(client);
    const payload = buildEntries(workbookRows, lookups);
    const result = await replacePricing(client, payload);

    console.log(JSON.stringify({
      workbook: WORKBOOK_PATH,
      parsedRows: workbookRows.length,
      importedEntries: payload.entries.length,
      uniquePriceTiers: result.uniquePrices.length,
      unmatchedCount: payload.unmatched.length,
      unmatchedNames: [...new Set(payload.unmatched.map((row) => row.supplier_product_name))].sort(),
      feeMultiplier: Number(((1 + FEE_PERCENT_1) * (1 + FEE_PERCENT_2)).toFixed(4)),
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
