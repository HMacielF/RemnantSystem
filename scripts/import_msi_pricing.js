const path = require("path");
const dotenv = require("dotenv");
const xlsx = require("xlsx");
const { Client } = require("pg");

dotenv.config();

const WORKBOOK_PATH = process.argv[2] || path.join(process.env.HOME || "", "Downloads", "MSI Price List -Jan 2026.xlsx");
const PRICE_SOURCE = "msi_price_list_jan_2026";
const FEE_PERCENT_1 = 0.06;
const FEE_PERCENT_2 = 0.03;

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

function normalizeSlabLookup(value) {
  return normalizeWhitespace(value)
    .replace(/[®™*]/g, "")
    .replace(/\(discontinued\)/gi, "")
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
    values ('2cm', true), ('3cm', true)
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
    where p.name = 'MSI Surfaces'
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
  const supplierId = lookups.supplierByName.get("MSI Surfaces");
  const materialId = lookups.materialByName.get("Quartz");
  const polishedFinishId = lookups.finishByName.get("Polished") || null;
  const thickness2cmId = lookups.thicknessByName.get("2cm") || null;
  const thickness3cmId = lookups.thicknessByName.get("3cm") || null;

  if (!supplierId) throw new Error("Supplier MSI Surfaces not found");
  if (!materialId) throw new Error("Material Quartz not found");

  const entries = [];
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

    if (row.price_2cm !== null || row.item_2cm) {
      if (row.price_2cm !== null) {
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
  }

  return { entries, unmatched, supplierId, materialId };
}

async function replacePricing(client, payload) {
  const uniquePrices = [...new Set(payload.entries.map((entry) => Number(entry.list_price_per_sqft.toFixed(4))))].sort((a, b) => a - b);

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
    for (const [index, price] of uniquePrices.entries()) {
      const code = codeFromIndex(index);
      const result = await client.query(
        `
          insert into public.supplier_price_tiers (
            supplier_id,
            material_id,
            code,
            sort_order,
            base_price_per_sqft,
            fee_percent_1,
            fee_percent_2,
            notes
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          returning id
        `,
        [
          payload.supplierId,
          payload.materialId,
          code,
          index,
          price,
          FEE_PERCENT_1,
          FEE_PERCENT_2,
          "MSI vendor cost. Effective price includes 6% and 3% fees.",
        ],
      );
      tierIdByPrice.set(price, result.rows[0].id);
    }

    for (const entry of payload.entries) {
      const rawPrice = Number(entry.list_price_per_sqft.toFixed(4));
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
          tierIdByPrice.get(rawPrice),
          entry.supplier_sku,
          entry.supplier_product_name,
          entry.source_group_number,
          entry.source_group_label,
          entry.source_status,
          entry.size_label,
          rawPrice,
          PRICE_SOURCE,
          "2026-01-01",
        ],
      );
    }

    await client.query("commit");
    return { uniquePrices };
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
