const path = require("path");
const dotenv = require("dotenv");
const { execFileSync } = require("child_process");
const { Client } = require("pg");

dotenv.config();

const PDF_PATH = process.argv[2] || path.join(process.env.HOME || "", "Downloads", "Alan Emerstone April 26 Price List.pdf");
const PRICE_SOURCE = "emerstone_price_list_apr_2026";
const EFFECTIVE_ON = "2026-04-01";
const SUPPLIER_NAME = "Emerstone";
const MATERIAL_NAME = "Quartz";
const PRICE_BAND_START = 10;
const PRICE_BAND_SIZE = 5;

const SLAB_NAME_ALIASES = new Map([
  ["blancopurejumbo", "Blanco Pure"],
  ["blancopure2cm", "Blanco Pure"],
  ["blancopureextra2cm", "Blanco Pure Extra"],
  ["emerstoneborghinigold", "Emerstone’s Borghini Gold"],
  ["emerstoneborghinisilver", "Emerstone’s Borghini Silver"],
  ["perlataj", "Perla Taj Quartz"],
  ["phantommistsuperjumbo", "Phantom Mist Quartz Super Jumbo"],
  ["tajsuperjumbo", "Taj"],
  ["mistywaves", "Misty Wave"],
  ["doro", "D’Oro"],
  ["calacatajade", null],
  ["calacatasereno", null],
  ["arcticblue", null],
  ["argentum", null],
  ["celestia", null],
  ["ellusion", null],
]);

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

function parseJsonFromPython(scriptPath, pdfPath) {
  return JSON.parse(execFileSync("python3", [scriptPath, pdfPath], { encoding: "utf8" }));
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[®™*]/g, "")
    .replace(/['’]/g, "")
    .replace(/\bquartz\b/g, "")
    .replace(/\bsuper\s*jumbo\b/g, "superjumbo")
    .replace(/\bjumbo\b/g, "jumbo")
    .replace(/\b2\s*cm\b/g, "2cm")
    .replace(/\b3\s*cm\b/g, "3cm")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function parsePrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Number(numeric.toFixed(4));
}

function codeFromIndex(index) {
  let value = Number(index);
  let code = "";
  do {
    code = String.fromCharCode(65 + (value % 26)) + code;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return code;
}

function bandSortOrderFromPrice(price) {
  const normalized = parsePrice(price);
  if (normalized === null) return null;
  if (normalized <= PRICE_BAND_START) return 0;
  return Math.floor((normalized - PRICE_BAND_START) / PRICE_BAND_SIZE);
}

function formatBandUpperBound(value) {
  const rounded = Math.floor(Number(value) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function getPriceBand(price) {
  const normalized = parsePrice(price);
  const sortOrder = bandSortOrderFromPrice(normalized);
  if (normalized === null || sortOrder === null) return null;

  const minPrice = Number((PRICE_BAND_START + sortOrder * PRICE_BAND_SIZE).toFixed(4));
  const maxPrice = Number((minPrice + PRICE_BAND_SIZE - 0.0001).toFixed(4));

  return {
    code: codeFromIndex(sortOrder),
    sortOrder,
    minPrice,
    maxPrice,
    notes: `Emerstone raw list price band $${minPrice}-${formatBandUpperBound(maxPrice)}. $25 per slab delivery fee is not modeled here.`,
  };
}

function normalizeSizeLabel(value) {
  return String(value || "")
    .replace(/[xX]/g, " x ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferThicknessName(name) {
  const normalized = normalize(name);
  if (normalized.includes("2cm")) return "2 CM";
  return "3 CM";
}

function resolveBaseSlabName(name) {
  const key = normalize(name);
  if (SLAB_NAME_ALIASES.has(key)) {
    return SLAB_NAME_ALIASES.get(key);
  }
  return name;
}

async function loadLookups(client) {
  const suppliers = await client.query("select id, name from public.suppliers where name = $1", [SUPPLIER_NAME]);
  const materials = await client.query("select id, name from public.materials where name = $1", [MATERIAL_NAME]);
  const finishes = await client.query("select id, name from public.finishes where name = 'Polished'");
  const thicknesses = await client.query("select id, name from public.thicknesses where name in ('2 CM','3 CM')");
  const slabs = await client.query(`
    select
      s.id,
      s.name
    from public.slabs s
    join public.suppliers p on p.id = s.supplier_id
    where p.name = $1
  `, [SUPPLIER_NAME]);

  return {
    supplierId: suppliers.rows[0]?.id || null,
    materialId: materials.rows[0]?.id || null,
    polishedFinishId: finishes.rows[0]?.id || null,
    thicknessByName: new Map(thicknesses.rows.map((row) => [row.name, row.id])),
    slabsByKey: new Map(slabs.rows.map((row) => [normalize(row.name), row])),
  };
}

async function ensureTier(client, supplierId, materialId, rawPrice) {
  const band = getPriceBand(rawPrice);
  if (!band?.code) return null;

  const existing = await client.query(
    `
      select id
      from public.supplier_price_tiers
      where supplier_id = $1
        and material_id = $2
        and code = $3
        and fixed_fee_per_sqft = 0
        and fee_percent_1 = 0
        and fee_percent_2 = 0
      limit 1
    `,
    [supplierId, materialId, band.code],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const inserted = await client.query(
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
      values ($1,$2,$3,$4,$5,$6,$7,0,0,0,$8)
      returning id
    `,
    [
      supplierId,
      materialId,
      band.code,
      band.sortOrder,
      band.minPrice,
      band.minPrice,
      band.maxPrice,
      band.notes,
    ],
  );
  return inserted.rows[0].id;
}

async function main() {
  const parserPath = path.join(__dirname, "parse_emerstone_pricing_pdf.py");
  const parsedRows = parseJsonFromPython(parserPath, PDF_PATH);
  const client = new Client(dbConfig());

  try {
    await client.connect();
    const lookups = await loadLookups(client);
    if (!lookups.supplierId) throw new Error("Supplier Emerstone not found");
    if (!lookups.materialId) throw new Error("Material Quartz not found");
    if (!lookups.polishedFinishId) throw new Error("Finish Polished not found");

    await client.query("begin");

    await client.query(
      `delete from public.slab_supplier_prices where supplier_id = $1 and price_source = $2`,
      [lookups.supplierId, PRICE_SOURCE],
    );

    const matched = [];
    const unmatched = [];
    const seenInsertKey = new Set();

    for (const row of parsedRows) {
      const baseName = resolveBaseSlabName(row.supplier_product_name);
      if (!baseName) {
        unmatched.push(row.supplier_product_name);
        continue;
      }

      const slab = lookups.slabsByKey.get(normalize(baseName));
      if (!slab) {
        unmatched.push(row.supplier_product_name);
        continue;
      }

      const rawPrice = parsePrice(row.list_price_per_sqft);
      if (rawPrice === null) continue;

      const thicknessName = inferThicknessName(row.supplier_product_name);
      const thicknessId = lookups.thicknessByName.get(thicknessName) || null;
      const tierId = await ensureTier(client, lookups.supplierId, lookups.materialId, rawPrice);
      const sizeLabel = normalizeSizeLabel(row.size_label);
      const dedupeKey = [slab.id, thicknessId || "", rawPrice, sizeLabel].join(":");
      if (seenInsertKey.has(dedupeKey)) continue;
      seenInsertKey.add(dedupeKey);

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
            size_label,
            list_price_per_sqft,
            price_source,
            effective_on,
            active
          )
          values ($1,$2,$3,$4,$5,$6,null,$7,$8,$9,$10,$11,true)
        `,
        [
          lookups.supplierId,
          slab.id,
          lookups.materialId,
          lookups.polishedFinishId,
          thicknessId,
          tierId,
          row.supplier_product_name,
          sizeLabel || null,
          rawPrice,
          PRICE_SOURCE,
          EFFECTIVE_ON,
        ],
      );

      if (thicknessId) {
        await client.query(
          `
            insert into public.slab_thicknesses (slab_id, thickness_id)
            values ($1, $2)
            on conflict (slab_id, thickness_id) do nothing
          `,
          [slab.id, thicknessId],
        );
      }

      await client.query(
        `
          insert into public.slab_finishes (slab_id, finish_id)
          values ($1, $2)
          on conflict (slab_id, finish_id) do nothing
        `,
        [slab.id, lookups.polishedFinishId],
      );

      matched.push({
        slab_id: slab.id,
        slab_name: slab.name,
        supplier_product_name: row.supplier_product_name,
        thickness: thicknessName,
        list_price_per_sqft: rawPrice,
      });
    }

    await client.query("commit");
    console.log(JSON.stringify({
      price_source: PRICE_SOURCE,
      effective_on: EFFECTIVE_ON,
      parsed_rows: parsedRows.length,
      matched_rows: matched.length,
      distinct_matched_slabs: [...new Set(matched.map((row) => row.slab_id))].length,
      unmatched_names: [...new Set(unmatched)].sort(),
      matched_preview: matched.slice(0, 20),
    }, null, 2));
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (_rollbackError) {
      // ignore rollback failure
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
