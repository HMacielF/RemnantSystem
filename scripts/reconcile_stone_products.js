const fs = require("fs");
const { Client } = require("pg");

function loadEnv() {
  return Object.fromEntries(
    fs.readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx), line.slice(idx + 1)];
      }),
  );
}

function dbConfig(env) {
  const projectRef = new URL(env.SUPABASE_URL).host.split(".")[0];
  return {
    host: `db.${projectRef}.supabase.co`,
    user: "postgres",
    database: "postgres",
    password: env.POSTGRES_PASSWORD,
    port: 5432,
    ssl: { rejectUnauthorized: false },
  };
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[®™*]/g, "")
    .replace(/\(discontinued\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function supplierBrand(supplierName) {
  const value = normalize(supplierName);
  if (value === "msi surfaces" || value === "msi") return "MSI";
  if (value === "cambria") return "Cambria";
  if (value === "caesarstone") return "Caesarstone";
  if (value === "laminam") return "Laminam";
  if (value === "x-tone" || value === "xtone") return "X-Tone";
  if (value === "cosmos") return "Cosmos";
  return null;
}

async function main() {
  const env = loadEnv();
  const client = new Client(dbConfig(env));
  await client.connect();

  try {
    await client.query("begin");

    const slabs = await client.query(`
      select s.id, s.material_id, s.name, s.supplier_id, s.stone_product_id, p.name as supplier_name
      from public.slabs s
      join public.suppliers p on p.id = s.supplier_id
    `);

    const stoneProducts = await client.query(`
      select id, material_id, display_name, stone_name, brand_name
      from public.stone_products
    `);

    const index = new Map();
    for (const row of stoneProducts.rows) {
      const key = `${row.material_id}::${normalize(row.stone_name)}::${normalize(row.brand_name)}`;
      if (!index.has(key)) index.set(key, row);
    }

    let createdCount = 0;
    let slabRelinkCount = 0;

    for (const slab of slabs.rows) {
      const brandName = supplierBrand(slab.supplier_name);
      const stoneName = slab.name;
      const key = `${slab.material_id}::${normalize(stoneName)}::${normalize(brandName)}`;
      let target = index.get(key);

      if (!target) {
        const inserted = await client.query(`
          insert into public.stone_products (material_id, display_name, stone_name, brand_name, active)
          values ($1, $2, $3, $4, true)
          returning id, material_id, display_name, stone_name, brand_name
        `, [
          slab.material_id,
          brandName ? `${brandName} ${stoneName}` : stoneName,
          stoneName,
          brandName,
        ]);
        target = inserted.rows[0];
        index.set(key, target);
        createdCount += 1;
      }

      if (Number(slab.stone_product_id) !== Number(target.id)) {
        await client.query(`update public.slabs set stone_product_id = $1 where id = $2`, [target.id, slab.id]);
        slabRelinkCount += 1;
      }
    }

    await client.query(`
      insert into public.stone_product_colors (stone_product_id, color_id, role)
      select distinct s.stone_product_id, sc.color_id, sc.role
      from public.slabs s
      join public.slab_colors sc on sc.slab_id = s.id
      where s.stone_product_id is not null
      on conflict do nothing
    `);

    const remnantRelink = await client.query(`
      with candidate_matches as (
        select
          r.id as remnant_id,
          sp.id as stone_product_id,
          row_number() over (
            partition by r.id
            order by
              case when coalesce(sp.brand_name, '') <> '' then 0 else 1 end,
              sp.id
          ) as rn,
          count(*) over (partition by r.id) as candidate_count
        from public.remnants r
        join public.stone_products sp
          on sp.material_id = r.material_id
         and public.normalize_catalog_name(sp.stone_name) = public.normalize_catalog_name(r.name)
      )
      update public.remnants r
      set stone_product_id = cm.stone_product_id
      from candidate_matches cm
      where r.id = cm.remnant_id
        and cm.rn = 1
        and cm.candidate_count = 1
        and r.stone_product_id is distinct from cm.stone_product_id
      returning r.id
    `);

    const parentRelink = await client.query(`
      with slab_candidates as (
        select
          r.id as remnant_id,
          s.id as slab_id,
          row_number() over (
            partition by r.id
            order by
              case when public.normalize_catalog_name(s.name) = public.normalize_catalog_name(r.name) then 0 else 1 end,
              s.id
          ) as rn,
          count(*) over (partition by r.id) as candidate_count
        from public.remnants r
        join public.slabs s
          on s.stone_product_id = r.stone_product_id
      )
      update public.remnants r
      set parent_slab_id = sc.slab_id
      from slab_candidates sc
      where r.id = sc.remnant_id
        and sc.rn = 1
        and sc.candidate_count = 1
        and r.parent_slab_id is distinct from sc.slab_id
      returning r.id
    `);

    await client.query("commit");

    console.log(JSON.stringify({
      createdStoneProducts: createdCount,
      relinkedSlabs: slabRelinkCount,
      relinkedRemnants: remnantRelink.rowCount,
      relinkedParentSlabs: parentRelink.rowCount,
    }, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
