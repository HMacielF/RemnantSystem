const path = require("path");
const dotenv = require("dotenv");
const { execFileSync } = require("child_process");
const { Client } = require("pg");

dotenv.config();

const CAMBRIA_PDF = path.join(process.env.HOME || "", "Downloads", "1.1.26 pricing 2.pdf");
const CAESARSTONE_PDF = path.join(process.env.HOME || "", "Downloads", "March 2026 CS Price List.pdf");
const CAMBRIA_SOURCE = "cambria_price_list_jan_2026";
const CAESARSTONE_SOURCE = "caesarstone_price_list_mar_2026";
const QUARTZ = "Quartz";
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

function parseJsonFromPython(scriptPath, pdfPath) {
  return JSON.parse(execFileSync("python3", [scriptPath, pdfPath], { encoding: "utf8" }));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[®™*]/g, "")
    .replace(/\(discontinued\)/gi, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function parsePrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Number(numeric.toFixed(4));
}

function bandSortOrderFromPrice(price) {
  const normalizedPrice = parsePrice(price);
  if (normalizedPrice === null) return null;
  if (normalizedPrice <= PRICE_BAND_START) return 0;
  return Math.floor((normalizedPrice - PRICE_BAND_START) / PRICE_BAND_SIZE);
}

function codeFromSortOrder(index) {
  let value = Number(index);
  if (!Number.isInteger(value) || value < 0) return null;
  let code = "";
  do {
    code = String.fromCharCode(65 + (value % 26)) + code;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return code;
}

function describeBand(price) {
  const normalizedPrice = parsePrice(price);
  const sortOrder = bandSortOrderFromPrice(normalizedPrice);
  if (normalizedPrice === null || sortOrder === null) return null;
  const minPrice = Number((PRICE_BAND_START + sortOrder * PRICE_BAND_SIZE).toFixed(4));
  const maxPrice = Number((minPrice + PRICE_BAND_SIZE - 0.0001).toFixed(4));
  return { code: codeFromSortOrder(sortOrder), sortOrder, minPrice, maxPrice };
}

function canonicalDimensions(width, height) {
  if (!width || !height) return "";
  return `${String(width).replace(/[″"]/g, "").trim()} x ${String(height).replace(/[″"]/g, "").trim()}`;
}

async function loadLookups(client) {
  const suppliers = await client.query("select id, name from public.suppliers where lower(name) in ('cambria','caesarstone')");
  const materials = await client.query("select id, name from public.materials where name = $1", [QUARTZ]);
  const thicknesses = await client.query("select id, name from public.thicknesses where name in ('1 CM','2 CM','3 CM')");
  const finishes = await client.query("select id, name from public.finishes");
  const slabs = await client.query(`
    select
      s.id,
      s.name,
      s.width,
      s.height,
      s.supplier_id,
      p.name as supplier_name
    from public.slabs s
    join public.suppliers p on p.id = s.supplier_id
    where lower(p.name) in ('cambria','caesarstone')
  `);

  return {
    supplierByName: new Map(suppliers.rows.map((row) => [row.name, row.id])),
    materialByName: new Map(materials.rows.map((row) => [row.name, row.id])),
    thicknessByName: new Map(thicknesses.rows.map((row) => [row.name, row.id])),
    finishByName: new Map(finishes.rows.map((row) => [row.name, row.id])),
    slabsBySupplierName: new Map(
      slabs.rows.reduce((acc, row) => {
        const supplier = row.supplier_name;
        const bucket = acc.get(supplier) || new Map();
        bucket.set(normalize(row.name), row);
        acc.set(supplier, bucket);
        return acc;
      }, new Map())
    ),
  };
}

async function ensureTier(client, { supplierId, materialId, rawPrice, fixedFeePerSqft, feePercent1, feePercent2, notes }) {
  const band = describeBand(rawPrice);
  if (!band?.code) return null;

  const existing = await client.query(
    `
      select id
      from public.supplier_price_tiers
      where supplier_id = $1
        and material_id = $2
        and code = $3
        and fixed_fee_per_sqft = $4
        and fee_percent_1 = $5
        and fee_percent_2 = $6
      limit 1
    `,
    [supplierId, materialId, band.code, fixedFeePerSqft, feePercent1, feePercent2],
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
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
      fixedFeePerSqft,
      feePercent1,
      feePercent2,
      notes,
    ],
  );
  return inserted.rows[0].id;
}

async function importCaesarstonePricing(client, lookups) {
  const parser = path.join(__dirname, "parse_caesarstone_pricing_pdf.py");
  const parsedRows = parseJsonFromPython(parser, CAESARSTONE_PDF);
  const supplierId = lookups.supplierByName.get("Caesarstone");
  const materialId = lookups.materialByName.get(QUARTZ);
  const slabMap = lookups.slabsBySupplierName.get("Caesarstone") || new Map();
  const thickness2 = lookups.thicknessByName.get("2 CM");
  const thickness3 = lookups.thicknessByName.get("3 CM");

  await client.query(`delete from public.slab_supplier_prices where supplier_id = $1 and price_source = $2`, [
    supplierId,
    CAESARSTONE_SOURCE,
  ]);

  let matched = 0;
  const unmatched = [];

  for (const row of parsedRows) {
    const slab = slabMap.get(normalize(row.name));
    if (!slab) {
      unmatched.push(row.name);
      continue;
    }

    const sizeLabel = canonicalDimensions(slab.width, slab.height) || "128 x 64.5";
    const notes = "Caesarstone raw list price. Adjusted price reflects -20% and +6%.";

    for (const [thicknessId, rawPrice, skuSuffix] of [
      [thickness2, row.jumbo_2cm_price, "2CM"],
      [thickness3, row.jumbo_3cm_price, "3CM"],
    ]) {
      const normalizedPrice = parsePrice(rawPrice);
      if (!thicknessId || normalizedPrice === null) continue;

      const tierId = await ensureTier(client, {
        supplierId,
        materialId,
        rawPrice: normalizedPrice,
        fixedFeePerSqft: 0,
        feePercent1: -0.20,
        feePercent2: 0.06,
        notes,
      });

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
          values ($1,$2,$3,null,$4,$5,$6,$7,$8,$9,$10,$11,true)
        `,
        [
          supplierId,
          slab.id,
          materialId,
          thicknessId,
          tierId,
          `${row.product_code}-${skuSuffix}`,
          row.name,
          sizeLabel,
          normalizedPrice,
          CAESARSTONE_SOURCE,
          "2026-03-01",
        ],
      );
      matched += 1;
    }
  }

  return { parsed: parsedRows.length, matched, unmatched: [...new Set(unmatched)].sort() };
}

async function importCambriaPricing(client, lookups) {
  const parser = path.join(__dirname, "parse_cambria_pricing_pdf.py");
  const parsedRows = parseJsonFromPython(parser, CAMBRIA_PDF);
  const supplierId = lookups.supplierByName.get("Cambria");
  const materialId = lookups.materialByName.get(QUARTZ);
  const slabMap = lookups.slabsBySupplierName.get("Cambria") || new Map();
  const thickness1 = lookups.thicknessByName.get("1 CM");
  const thickness2 = lookups.thicknessByName.get("2 CM");
  const thickness3 = lookups.thicknessByName.get("3 CM");

  await client.query(`delete from public.slab_supplier_prices where supplier_id = $1 and price_source = $2`, [
    supplierId,
    CAMBRIA_SOURCE,
  ]);

  let matched = 0;
  const unmatched = [];

  for (const row of parsedRows) {
    const slab = slabMap.get(normalize(row.name));
    if (!slab) {
      unmatched.push(row.name);
      continue;
    }

    const sizeLabel = canonicalDimensions(slab.width, slab.height);
    if (sizeLabel && sizeLabel !== row.size_label) {
      continue;
    }

    const notes = "Cambria raw list price. Adjusted price reflects +$0.85 delivery and +6%.";

    for (const [thicknessId, rawPrice, skuSuffix] of [
      [thickness3, row.price_3cm, "3CM"],
      [thickness2, row.price_2cm, "2CM"],
      [thickness1, row.price_1cm, "1CM"],
    ]) {
      const normalizedPrice = parsePrice(rawPrice);
      if (!thicknessId || normalizedPrice === null) continue;

      const tierId = await ensureTier(client, {
        supplierId,
        materialId,
        rawPrice: normalizedPrice,
        fixedFeePerSqft: 0.85,
        feePercent1: 0.06,
        feePercent2: 0,
        notes,
      });

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
          values ($1,$2,$3,null,$4,$5,$6,$7,$8,$9,$10,$11,true)
        `,
        [
          supplierId,
          slab.id,
          materialId,
          thicknessId,
          tierId,
          `${normalize(row.name)}-${skuSuffix}`,
          row.name,
          row.size_label,
          normalizedPrice,
          CAMBRIA_SOURCE,
          "2026-01-01",
        ],
      );
      matched += 1;
    }
  }

  return { parsed: parsedRows.length, matched, unmatched: [...new Set(unmatched)].sort() };
}

async function main() {
  const client = new Client(dbConfig());
  await client.connect();
  try {
    const lookups = await loadLookups(client);
    const caesarstone = await importCaesarstonePricing(client, lookups);
    const cambria = await importCambriaPricing(client, lookups);
    console.log(JSON.stringify({ caesarstone, cambria }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
