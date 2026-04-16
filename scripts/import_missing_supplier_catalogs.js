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

const OUTPUT_DIR = path.join(__dirname, "..", "scrapers", "slab_scraper", "output");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TONE_TOKENS = new Set(["warm", "cool", "veined", "vein", "neutral"]);

const SUPPLIERS = [
  {
    key: "bramati",
    supplierName: "Bramati Marble & Granite",
    websiteUrl: "https://bramati.com",
    filePrefixes: [
      "bramati_marble_",
      "bramati_granite_",
      "bramati_quartzite_",
      "bramati_dolomite_",
    ],
    brandName: null,
    rowMapper: mapBramatiRow,
  },
  {
    key: "east_west_marble",
    supplierName: "East West Marble",
    websiteUrl: "https://ewmarble.com/",
    filePrefix: "east_west_marble_vision_quartz_",
    brandName: "Vision Quartz",
    rowMapper: mapEastWestRow,
  },
  {
    key: "gramaco",
    supplierName: "Gramaco Granite & Marble",
    websiteUrl: "https://www.gramaco.com/",
    filePrefixes: [
      "gramaco_quartz_",
      "gramaco_hrp_",
      "gramaco_noble_",
      "gramaco_polarstone_",
      "gramaco_smart_quartz_",
      "gramaco_quartzite_",
      "gramaco_marble_",
      "gramaco_granite_",
      "gramaco_soapstone_",
      "gramaco_porcelain_",
    ],
    brandName: null,
    rowMapper: mapGramacoRow,
  },
  {
    key: "hanstone",
    supplierName: "HanStone",
    websiteUrl: "https://hyundailncusa.com",
    filePrefix: "hanstone_quartz_",
    brandName: "HanStone",
    rowMapper: mapHanstoneRow,
  },
  {
    key: "marble_systems",
    supplierName: "Marble Systems",
    websiteUrl: "https://www.marblesystems.com/by/types/slab/",
    filePrefix: "marble_systems_slabs_",
    brandName: null,
    rowMapper: mapMarbleSystemsRow,
  },
  {
    key: "reliance",
    supplierName: "Reliance Granite & Marble",
    websiteUrl: "https://reliancesurfaces.com/",
    filePrefixes: ["reliance_quartz_", "reliance_printed_quartz_"],
    brandName: "Reliance",
    rowMapper: mapRelianceRow,
  },
  {
    key: "raphael_stones",
    supplierName: "Raphael Stones",
    websiteUrl: "https://www.raphaelstoneusa.com/",
    filePrefixes: ["raphael_stones_quartz_", "raphael_stones_printed_quartz_"],
    brandName: "Raphael",
    rowMapper: mapRaphaelRow,
  },
  {
    key: "vadara",
    supplierName: "MMG Tile + Stone",
    websiteUrl: "https://mmgmarble.com/",
    filePrefix: "vadara_quartz_",
    brandName: "Vadara",
    rowMapper: mapVadaraRow,
  },
  {
    key: "venezia",
    supplierName: "Venezia Stone",
    websiteUrl: "https://www.veneziasurfaces.com/",
    filePrefix: "venezia_quartz_dmv_",
    brandName: "Venezia",
    rowMapper: mapVeneziaRow,
  },
  {
    key: "cosentino",
    supplierName: "Cosentino",
    websiteUrl: "https://e.cosentino.com/",
    filePrefix: "cosentino_silestone_",
    brandName: "Silestone",
    rowMapper: mapCosentinoRow,
  },
  {
    key: "umi_vicostone",
    supplierName: "UMI",
    websiteUrl: "https://umistone.com/live-inventory/beltsville/",
    filePrefix: "umi_vicostone_beltsville_",
    brandName: "Vicostone",
    rowMapper: mapUmiRow,
  },
  {
    key: "granite_central",
    supplierName: "Granite Central",
    websiteUrl: "https://productcatalog.granitecentral.net/",
    filePrefix: "granite_central_inventory_normalized_",
    brandName: null,
    rowMapper: mapGraniteCentralRow,
  },
  {
    key: "stone_action",
    supplierName: "Stone Action",
    websiteUrl: "https://stoneaction.net/",
    filePrefix: "stone_action_inventory_normalized_",
    brandName: null,
    rowMapper: mapStoneActionRow,
  },
  {
    key: "ultra_stone",
    supplierName: "Ultra Stone",
    websiteUrl: "https://ultrastonesweb.stoneprofits.com/",
    filePrefix: "latest_normalized",
    brandName: null,
    rowMapper: mapUltraStoneRow,
  },
];

function latestFileByPrefix(prefix) {
  const folder = inferFolderForPrefix(prefix);
  const dir = path.join(OUTPUT_DIR, folder);
  const files = fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort();
  if (!files.length) throw new Error(`No files found for prefix ${prefix}`);
  return path.join(dir, files[files.length - 1]);
}

function inferFolderForPrefix(prefix) {
  if (prefix.startsWith("east_west_marble_")) return "east_west_marble";
  if (prefix.startsWith("marble_systems_")) return "marble_systems";
  if (prefix.startsWith("raphael_stones_")) return "raphael_stones";
  if (prefix.startsWith("umi_vicostone_")) return "umi_vicostone";
  if (prefix.startsWith("granite_central_")) return "granite_central";
  if (prefix.startsWith("stone_action_")) return "stone_action";
  if (prefix === "latest_normalized") return "ultra_stone";
  if (prefix.startsWith("gramaco_")) return "gramaco";
  if (prefix.startsWith("bramati_")) return "bramati";
  const match = prefix.match(/^([a-z_]+?)(?:_(?:quartz|silestone|slabs|printed_quartz|vision_quartz|beltsville))/);
  return match ? match[1] : prefix;
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

function titleCaseWords(value) {
  return sanitize(value)
    .split(" ")
    .map((part) => part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}` : part)
    .join(" ");
}

function smartTitleToken(token) {
  const raw = sanitize(token);
  if (!raw) return "";
  const letters = raw.replace(/[^A-Za-z]/g, "");
  if (letters && letters === letters.toUpperCase() && letters.length <= 3) {
    return raw.toUpperCase();
  }

  let lowered = raw.toLowerCase();
  lowered = lowered.replace(/(^|[\(\[\/\-–—])([a-z])/g, (_, prefix, char) => `${prefix}${char.toUpperCase()}`);
  lowered = lowered.replace(/(^|['’])([a-z])/g, (_, prefix, char) => `${prefix}${char.toUpperCase()}`);
  lowered = lowered.replace(/\(([a-z]{1,3})\)/g, (_, shortCode) => `(${shortCode.toUpperCase()})`);
  return lowered;
}

function normalizeCatalogNameCase(value) {
  return sanitize(value)
    .split(/\s+/)
    .map((token) => smartTitleToken(token))
    .join(" ")
    .trim();
}

function splitCsv(value) {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((item) => sanitize(item))
      .filter(Boolean)
  )];
}

function splitMixedList(value) {
  return [...new Set(
    String(value || "")
      .split(/[;,/]/)
      .map((item) => sanitize(item))
      .filter(Boolean)
  )];
}

function normalizeMaterial(value) {
  const cleaned = sanitize(value);
  if (!cleaned) return "Quartz";
  return titleCaseWords(cleaned);
}

function normalizeThicknessToken(value) {
  const raw = sanitize(value);
  const compact = raw
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
  if (compact === "12mm") return "12 MM";
  return raw;
}

function parseThicknesses(value) {
  return [...new Set(
    String(value || "")
      .split(/[;,|]/)
      .map((token) => normalizeThicknessToken(token))
      .filter(Boolean)
  )];
}

function normalizeFinish(value) {
  const lowered = normalize(value);
  if (!lowered) return null;
  if (lowered === "polish" || lowered === "polished") return "Polished";
  if (lowered === "matte") return "Matte";
  if (lowered === "honed") return "Honed";
  if (lowered === "glossy") return "Glossy";
  if (lowered === "leather" || lowered === "leathered") return "Leathered";
  if (lowered === "brushed") return "Brushed";
  if (lowered === "rough") return "Rough";
  if (lowered === "natural") return "Natural";
  if (lowered === "satin") return "Satin";
  if (lowered === "concrete") return "Concrete";
  return sanitize(value);
}

function normalizeColor(value) {
  const cleaned = titleCaseWords(value);
  if (!cleaned) return null;
  if (TONE_TOKENS.has(normalize(cleaned))) return null;
  if (normalize(cleaned) === "grey") return "Gray";
  return cleaned;
}

function parseColorList(...values) {
  const colors = [];
  const seen = new Set();
  for (const value of values) {
    for (const token of splitMixedList(value)) {
      const color = normalizeColor(token);
      if (!color) continue;
      const key = normalize(color);
      if (seen.has(key)) continue;
      seen.add(key);
      colors.push(color);
    }
  }
  return colors;
}

function parseDimensions(rawValue) {
  const source = sanitize(rawValue);
  if (!source) return { width: null, height: null };
  const firstSegment = source.split("/")[0];
  const match = firstSegment.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
  if (!match) return { width: null, height: null };
  return {
    width: `${match[1]}″`,
    height: `${match[2]}″`,
  };
}

function floorDimensionValue(value) {
  const source = sanitize(value).replace(/″/g, "");
  if (!source) return null;
  const numeric = Number.parseFloat(source);
  if (!Number.isFinite(numeric)) return value;
  return `${Math.floor(numeric)}″`;
}

function extractStoneNameFromProductTitle(title, finishValue, materialValue) {
  let base = sanitize(title);
  const finish = sanitize(finishValue);
  const material = sanitize(materialValue);

  // Marble Systems sometimes embeds inch thickness in the title, e.g.
  // `Allure Light Polished Marble Slab 3/4 " thick`.
  base = base
    .replace(/\s+\d+(?:\s+\d+\/\d+|\/\d+)?\s*"*\s*thick$/i, "")
    .replace(/\s+slab$/i, "");

  if (material) {
    const materialPattern = material.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    base = base.replace(new RegExp(`\\s+${materialPattern}$`, "i"), "");
  }

  if (finish) {
    const finishPattern = finish.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    base = base.replace(new RegExp(`\\s+${finishPattern}$`, "i"), "");
  }

  base = base
    .replace(/\s+slab$/i, "")
    .replace(/\s+\d+(?:\s+\d+\/\d+|\/\d+)?\s*"*\s*thick$/i, "");

  return sanitize(base);
}

function gramacoFinishNameVariants(value) {
  const source = sanitize(value);
  if (!source) return [];

  const variants = new Set([source]);
  variants.add(source.replace(/\bLeathered\b/gi, "Leather"));
  variants.add(source.replace(/\bPolished\/Leathered\b/gi, "Polished/Leather"));
  variants.add(source.replace(/\bLeathered\b/gi, "Soft Leather"));

  return [...variants].map(sanitize).filter(Boolean);
}

function normalizeGramacoNaturalStoneName(name, finishValue, materialValue) {
  let base = sanitize(name);
  if (!base) return "";

  const finishTokens = [
    ...splitCsv(finishValue),
    ...splitCsv(finishValue).map(normalizeFinish).filter(Boolean),
  ];

  for (const finishToken of [...new Set(finishTokens.flatMap(gramacoFinishNameVariants))].sort((left, right) => right.length - left.length)) {
    const escaped = finishToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    base = base.replace(new RegExp(`\\b${escaped}\\b`, "ig"), " ");
  }

  const material = sanitize(materialValue);
  if (material) {
    const materialPattern = material.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    base = base.replace(new RegExp(`\\b${materialPattern}\\b\\s+${materialPattern}\\b`, "ig"), material);
  }

  base = base
    .replace(/\s*\/\s*/g, " ")
    .replace(/\s+[–-]\s*[A-Za-z0-9]+$/i, "")
    .replace(/\s+[A-Za-z]*\d[A-Za-z0-9]*$/i, "")
    .replace(/\s+[–-]\s*$/i, "")
    .replace(/\s+[A-Za-z]*\d[A-Za-z0-9]*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return sanitize(base);
}

function normalizeGramacoPorcelainBrand(value, name = "") {
  const brand = normalize(value);
  const normalizedName = normalize(name);

  if (brand === "atlasplan" || /\bap$/.test(normalizedName)) return "Atlas Plan";
  if (brand === "xtonebyporcelanosa" || brand === "xtone" || /\bxt$/.test(normalizedName)) return "X-Tone";
  if (brand === "evoca" || /\bev$/.test(normalizedName)) return "Evoca";
  if (brand === "sapienstone" || /\b[34]d$/.test(normalizedName)) return "SapienStone";
  if (brand === "mediterraneo" || brand === "mediterraneosurface" || /\bmd$/.test(normalizedName)) {
    return "Mediterraneo Surface";
  }

  return sanitize(value) || null;
}

function normalizeGramacoPorcelainName(name, brandValue = "") {
  let base = sanitize(name);
  if (!base) return "";

  const brandName = normalizeGramacoPorcelainBrand(brandValue, name);
  const suffixTokens = ["Ap", "Xt", "Ev", "Md", "3D", "4D"];

  for (const token of suffixTokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    base = base.replace(new RegExp(`\\s+${escaped}$`, "i"), "");
  }

  if (brandName === "Atlas Plan") {
    base = base.replace(/\s+Ap$/i, "");
  } else if (brandName === "X-Tone") {
    base = base.replace(/\s+Xt$/i, "");
  } else if (brandName === "Evoca") {
    base = base.replace(/\s+Ev$/i, "");
  } else if (brandName === "SapienStone") {
    base = base.replace(/\s+[34]D$/i, "");
  } else if (brandName === "Mediterraneo Surface") {
    base = base.replace(/\s+Md$/i, "");
  }

  return sanitize(base);
}

function firstBrandToken(value, fallback = null) {
  const tokens = splitCsv(value);
  return tokens[0] || fallback;
}

function buildRecord(base) {
  return {
    supplierName: base.supplierName,
    websiteUrl: base.websiteUrl,
    brandName: base.brandName || null,
    stoneName: normalizeCatalogNameCase(base.stoneName || base.name),
    name: normalizeCatalogNameCase(base.name),
    materialName: normalizeMaterial(base.materialName),
    detailUrl: base.detailUrl || null,
    imageUrl: base.imageUrl || null,
    width: base.width || null,
    height: base.height || null,
    thicknesses: base.thicknesses || [],
    finishes: base.finishes || [],
    primaryColors: base.primaryColors || [],
    accentColors: base.accentColors || [],
    uniqueKey: base.uniqueKey || null,
    sourceCollection: base.sourceCollection || null,
    matchStrategy: base.matchStrategy || null,
  };
}

function normalizeBramatiStoneName(name) {
  let normalized = normalizeCatalogNameCase(name);
  if (!normalized) return "";

  if (normalize(normalized) === "mundiolito") {
    normalized = "Mundialito";
  }
  if (normalize(normalized) === "via lectea") {
    normalized = "Via Lactea";
  }
  if (normalize(normalized) === "absolute black premium") {
    normalized = "Absolute Black";
  }
  if (normalize(normalized) === "brown fantasy") {
    normalized = "Fantasy Brown";
  }

  normalized = normalized.replace(/\s+\d+\s*Cm$/i, "");
  normalized = normalized.replace(/\bVenatto\b/gi, "Venatino");

  return sanitize(normalized);
}

function mapBramatiRow(row, config) {
  const dims = parseDimensions(row.dimensions);
  const normalizedName = normalizeBramatiStoneName(row.name);
  const normalizedMaterial = normalize(normalizeMaterial(row.material));
  const isBramatiDolomite = normalizedMaterial === "dolomite";
  const normalizedNameKey = normalize(normalizedName).replace(/\s+/g, "");
  const materialName = normalizedNameKey === "fantasymacaubus"
    ? "Quartzite"
    : isBramatiDolomite
    ? "Dolomitic Marble"
    : row.material;
  const uniqueKey = sanitize(row.detail_url) || sanitize(row.block_number) || sanitize(row.image_url);

  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: config.brandName,
    stoneName: normalizedName,
    name: normalizedName,
    materialName,
    detailUrl: sanitize(row.detail_url) || sanitize(row.image_url) || null,
    imageUrl: row.image_url,
    width: dims.width,
    height: dims.height,
    thicknesses: parseThicknesses(row.thickness),
    finishes: splitCsv(row.finishes).map(normalizeFinish).filter(Boolean),
    uniqueKey,
  });
}

function mapEastWestRow(row, config) {
  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: row.brand || config.brandName,
    name: row.name,
    materialName: row.material,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
  });
}

function mapGramacoRow(row, config) {
  const dims = parseDimensions(row.dimensions);
  const sourceCollection = normalize(row.source_collection);
  const collectionTokens = splitCsv(row.brand).map(normalize);
  const isPrintedQuartz = sourceCollection === "hrp" || collectionTokens.includes("hrp");
  const materialName = normalizeMaterial(row.material);
  const isNoble = sourceCollection === "noble" || collectionTokens.includes("noble");
  const isPolarstone = sourceCollection === "polarstone" || collectionTokens.includes("polarstone");
  const isQuartz = normalize(materialName) === "quartz";
  const isPorcelain = normalize(materialName) === "porcelain";
  const normalizedNaturalStoneName = isQuartz
    ? null
    : normalizeGramacoNaturalStoneName(row.name, row.finishes, materialName);
  const normalizedPorcelainBrand = isPorcelain
    ? normalizeGramacoPorcelainBrand(row.brand, row.name)
    : null;
  const normalizedPorcelainName = isPorcelain
    ? normalizeGramacoPorcelainName(row.name, row.brand)
    : null;
  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: isQuartz
      ? (isPrintedQuartz ? "HRP" : isPolarstone ? "Polarstone" : isNoble ? "Noble" : "Gramaco Quartz")
      : isPorcelain
        ? normalizedPorcelainBrand
        : null,
    stoneName: normalizedPorcelainName || normalizedNaturalStoneName || row.name,
    name: normalizedPorcelainName || normalizedNaturalStoneName || row.name,
    materialName,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    width: dims.width,
    height: dims.height,
    thicknesses: parseThicknesses(row.thickness),
    finishes: splitCsv(row.finishes).map(normalizeFinish).filter(Boolean),
    primaryColors: parseColorList(row.primary_colors),
    accentColors: parseColorList(row.accent_colors),
    uniqueKey: row.detail_url,
    sourceCollection,
  });
}

function mapHanstoneRow(row, config) {
  const dims = parseDimensions(row.dimensions);
  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: config.brandName,
    name: row.name,
    materialName: row.material,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    width: dims.width,
    height: dims.height,
    finishes: splitCsv(row.finishes).map(normalizeFinish).filter(Boolean),
    primaryColors: parseColorList(row.primary_colors),
    accentColors: parseColorList(row.accent_colors),
  });
}

function mapMarbleSystemsRow(row, config) {
  const dims = parseDimensions(row.batch_dimensions);
  const baseName = extractStoneNameFromProductTitle(row.name, row.finishes, row.material);
  const name = row.batch_number ? `${baseName} · Batch ${sanitize(row.batch_number)}` : baseName;
  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: config.brandName,
    stoneName: baseName,
    name,
    materialName: row.material,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    width: dims.width,
    height: dims.height,
    thicknesses: parseThicknesses(row.thickness),
    finishes: splitCsv(row.finishes).map(normalizeFinish).filter(Boolean),
    primaryColors: parseColorList(row.primary_colors),
    uniqueKey: row.batch_number || row.detail_url,
  });
}

function mapRelianceRow(row, config) {
  const dims = parseDimensions(row.size);
  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: config.brandName,
    name: row.name.replace(/\s+\((RQ|RPQ)\)$/i, ""),
    materialName: row.material,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    width: dims.width,
    height: dims.height,
    thicknesses: parseThicknesses(row.thickness),
    finishes: splitCsv(row.finish).map(normalizeFinish).filter(Boolean),
  });
}

function mapRaphaelRow(row, config) {
  const dims = parseDimensions(row.size);
  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: config.brandName,
    name: row.name,
    materialName: row.material,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    width: dims.width,
    height: dims.height,
    thicknesses: parseThicknesses(row.thickness),
    finishes: splitCsv(row.finish).map(normalizeFinish).filter(Boolean),
  });
}

function mapVadaraRow(row, config) {
  const dims = parseDimensions(row.slab_size);
  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: config.brandName,
    name: row.name,
    materialName: row.material,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    width: dims.width,
    height: dims.height,
    thicknesses: parseThicknesses(row.thickness),
    finishes: splitCsv(row.finish).map(normalizeFinish).filter(Boolean),
    primaryColors: parseColorList(row.background_color),
    accentColors: parseColorList(row.vein_color),
  });
}

function mapVeneziaRow(row, config) {
  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: config.brandName,
    name: row.name.replace(/\s+Quartz$/i, ""),
    materialName: row.material,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    thicknesses: parseThicknesses(row.thickness),
    primaryColors: parseColorList(row.color),
  });
}

function mapCosentinoRow(row, config) {
  const dims = parseDimensions(row.dimensions);
  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: config.brandName,
    name: row.name,
    materialName: row.material,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    width: floorDimensionValue(dims.width),
    height: floorDimensionValue(dims.height),
    thicknesses: parseThicknesses(row.thickness),
    finishes: splitCsv(row.finishes).map(normalizeFinish).filter(Boolean),
  });
}

function mapUmiRow(row, config) {
  const dims = parseDimensions(row.size);
  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: config.brandName,
    name: row.name.replace(/^Vicostone\s*-\s*/i, ""),
    materialName: row.material,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    width: dims.width,
    height: dims.height,
    thicknesses: parseThicknesses(row.thickness),
    finishes: splitCsv(row.finish).map(normalizeFinish).filter(Boolean),
  });
}

function mapGraniteCentralRow(row, config) {
  const materialName = normalizeMaterial(row.material);
  const isQuartz = normalize(materialName) === "quartz";
  const imageKey = sanitize(row.image_url);

  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: row.brand || null,
    name: row.name,
    materialName,
    detailUrl: row.detail_url,
    imageUrl: row.image_url,
    width: row.width_in ? `${row.width_in}"` : null,
    height: row.height_in ? `${row.height_in}"` : null,
    thicknesses: parseThicknesses(row.thickness),
    finishes: splitCsv(row.finish).map(normalizeFinish).filter(Boolean),
    uniqueKey: isQuartz
      ? (row.item_id ? `item:${row.item_id}` : null)
      : (imageKey ? `image:${imageKey}` : null),
    matchStrategy: isQuartz ? "detail_then_image_then_name" : "image_only",
  });
}

function mapStoneActionRow(row, config) {
  const isSoapstone = normalize(row.material) === "soapstone";
  const stoneName = isSoapstone ? "Soapstone" : sanitize(row.name);
  const name = isSoapstone ? stoneName : row.block_number ? `${stoneName} · Block ${sanitize(row.block_number)}` : stoneName;
  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: row.brand || null,
    stoneName,
    name,
    materialName: row.material,
    detailUrl: row.detail_url,
    imageUrl: row.image_url || row.archive_thumbnail_url || null,
    width: row.width_in ? `${row.width_in}"` : null,
    height: row.height_in ? `${row.height_in}"` : null,
    thicknesses: parseThicknesses(row.thickness),
    primaryColors: parseColorList(row.base_color),
    uniqueKey: row.detail_url || row.block_number || row.image_url || null,
    matchStrategy: "detail_then_image_then_name",
  });
}

function mapUltraStoneRow(row, config) {
  const materialName = normalizeMaterial(row.material);
  const isQuartz = normalize(materialName) === "quartz";
  const stoneName = sanitize(row.name);
  const blockNumber = sanitize(row.block_number);
  const imageKey = sanitize(row.image_url || row.inventory_filename);
  const name = !isQuartz && blockNumber ? `${stoneName} · Block ${blockNumber}` : stoneName;

  return buildRecord({
    supplierName: config.supplierName,
    websiteUrl: config.websiteUrl,
    brandName: row.brand || null,
    stoneName,
    name,
    materialName,
    detailUrl: row.detail_url,
    imageUrl: row.image_url || null,
    width: row.width_in ? `${row.width_in}"` : null,
    height: row.height_in ? `${row.height_in}"` : null,
    thicknesses: parseThicknesses(row.thickness),
    finishes: splitCsv(row.finish).map(normalizeFinish).filter(Boolean),
    uniqueKey: isQuartz
      ? (row.item_id ? `item:${row.item_id}` : row.detail_url || imageKey || null)
      : (imageKey ? `image:${imageKey}` : blockNumber || row.detail_url || null),
    matchStrategy: isQuartz ? "detail_then_image_then_name" : "image_only",
  });
}

function loadConfigRows(config) {
  const prefixes = config.filePrefixes || [config.filePrefix];
  return prefixes.flatMap((prefix) => {
    const rows = readJson(latestFileByPrefix(prefix));
    return rows.map((row) => config.rowMapper(row, config));
  }).filter((row) => row.name && (row.detailUrl || row.uniqueKey || row.imageUrl));
}

function sourceCollectionPriority(value) {
  const normalized = normalize(value);
  if (normalized === "hrp") return 3;
  if (normalized === "polarstone") return 2;
  if (normalized === "smartquartz") return 1;
  return 0;
}

function buildMergeKey(row) {
  if (row.uniqueKey) {
    return [
      row.supplierName,
      row.materialName,
      row.uniqueKey,
    ].join("::").toLowerCase();
  }
  return [
    row.supplierName,
    row.materialName,
    row.brandName || "",
    row.name,
    row.uniqueKey || "",
  ].join("::").toLowerCase();
}

function mergeRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = buildMergeKey(row);
    const existing = grouped.get(key) || {
      ...row,
      thicknesses: [...row.thicknesses],
      finishes: [...row.finishes],
      primaryColors: [...row.primaryColors],
      accentColors: [...row.accentColors],
    };

    if (!grouped.has(key)) {
      grouped.set(key, existing);
      continue;
    }

    if (sourceCollectionPriority(row.sourceCollection) > sourceCollectionPriority(existing.sourceCollection)) {
      existing.brandName = row.brandName || existing.brandName;
      existing.sourceCollection = row.sourceCollection || existing.sourceCollection;
    }
    if (!existing.imageUrl && row.imageUrl) existing.imageUrl = row.imageUrl;
    if (!existing.detailUrl && row.detailUrl) existing.detailUrl = row.detailUrl;
    if (!existing.width && row.width) existing.width = row.width;
    if (!existing.height && row.height) existing.height = row.height;
    if (!existing.brandName && row.brandName) existing.brandName = row.brandName;
    existing.thicknesses = [...new Set([...existing.thicknesses, ...row.thicknesses])];
    existing.finishes = [...new Set([...existing.finishes, ...row.finishes])];
    existing.primaryColors = [...new Set([...existing.primaryColors, ...row.primaryColors])];
    existing.accentColors = [...new Set([...existing.accentColors, ...row.accentColors])];
  }
  return [...grouped.values()];
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

async function getOrCreateStoneProductId(materialId, brandName, slabName) {
  const stoneName = sanitize(slabName);
  const displayName = brandName ? `${brandName} ${stoneName}` : stoneName;
  const normalizedStoneName = normalize(stoneName);
  const normalizedBrandName = normalize(brandName);
  const normalizedDisplayName = normalize(displayName);

  const candidateQueries = await Promise.all([
    supabase
      .from("stone_products")
      .select("id,brand_name,stone_name,display_name,normalized_name")
      .eq("material_id", materialId)
      .eq("stone_name", stoneName)
      .limit(20),
    supabase
      .from("stone_products")
      .select("id,brand_name,stone_name,display_name,normalized_name")
      .eq("material_id", materialId)
      .eq("display_name", displayName)
      .limit(20),
    supabase
      .from("stone_products")
      .select("id,brand_name,stone_name,display_name,normalized_name")
      .eq("material_id", materialId)
      .eq("normalized_name", normalizedStoneName)
      .limit(20),
    supabase
      .from("stone_products")
      .select("id,brand_name,stone_name,display_name,normalized_name")
      .eq("material_id", materialId)
      .eq("normalized_name", normalizedDisplayName)
      .limit(20),
  ]);
  for (const result of candidateQueries) {
    if (result.error) throw result.error;
  }

  const rows = [...new Map(
    candidateQueries
      .flatMap((result) => result.data || [])
      .map((row) => [row.id, row])
  ).values()];
  const candidates = rows.filter((row) => normalize(row.stone_name) === normalizedStoneName);
  const brandless = candidates.find((row) => !normalize(row.brand_name));
  let existing = null;

  if (!normalizedBrandName) {
    existing = brandless || null;
  } else {
    const exactBrand = candidates.find((row) => normalize(row.brand_name) === normalizedBrandName);
    const displayMatch = rows.find((row) => normalize(row.display_name || "") === normalizedDisplayName);
    const prefixedStoneName = rows.find((row) => normalize(row.stone_name) === normalizedDisplayName);
    const normalizedMatch = rows.find((row) => {
      const key = normalize(row.normalized_name || "");
      return key === normalizedStoneName || key === normalizedDisplayName;
    });
    existing = exactBrand || displayMatch || prefixedStoneName || normalizedMatch || brandless || candidates[0] || null;
  }

  if (existing?.id) {
    const updatePayload = {};
    if (brandName && normalize(existing.brand_name) !== normalize(brandName)) updatePayload.brand_name = brandName;
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
      brand_name: brandName || null,
      active: true,
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const normalizedNameMatch = String(error.details || "").match(/\(material_id, normalized_name\)=\(\d+, ([^)]+)\)/);
    const conflictNormalizedName = normalize(normalizedNameMatch?.[1] || "");
    const { data: retryRows, error: retryError } = await supabase
      .from("stone_products")
      .select("id,normalized_name,stone_name,display_name")
      .eq("material_id", materialId)
      .limit(5000);
    if (retryError) throw retryError;
    const retryMatch = (retryRows || []).find((row) => {
      const key = normalize(row.normalized_name || "");
      return key === normalizedStoneName || key === normalizedDisplayName || (conflictNormalizedName && key === conflictNormalizedName);
    });
    if (retryMatch?.id) return retryMatch.id;
  }
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
  const { error: deleteError } = await supabase
    .from("stone_product_colors")
    .delete()
    .eq("stone_product_id", stoneProductId);
  if (deleteError) throw deleteError;

  const { error: insertError } = await supabase
    .from("stone_product_colors")
    .insert(deduped);
  if (insertError) throw insertError;
}

async function upsertSupplierBrand(supplierId, brandName, materialId) {
  if (!brandName) return;
  const { data: existing, error: existingError } = await supabase
    .from("supplier_brands")
    .select("id")
    .eq("supplier_id", supplierId)
    .eq("brand_name", brandName)
    .eq("material_id", materialId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return;

  const { error } = await supabase
    .from("supplier_brands")
    .insert({
      supplier_id: supplierId,
      brand_name: brandName,
      material_id: materialId,
    });
  if (error && error.code !== "23505") throw error;
}

async function upsertSlab(row, supplierId, materialId) {
  const stoneProductId = await getOrCreateStoneProductId(materialId, row.brandName, row.stoneName || row.name);
  let existing = null;
  const matchStrategy = row.matchStrategy || "detail_then_image_then_name";

  if (matchStrategy === "detail_then_image_then_name" && row.detailUrl) {
    const { data: detailMatch, error: detailError } = await supabase
      .from("slabs")
      .select("id")
      .eq("supplier_id", supplierId)
      .eq("material_id", materialId)
      .eq("detail_url", row.detailUrl)
      .maybeSingle();
    if (detailError) throw detailError;
    existing = detailMatch || null;
  }

  if (!existing?.id && row.imageUrl) {
    const { data: imageMatch, error: imageError } = await supabase
      .from("slabs")
      .select("id")
      .eq("supplier_id", supplierId)
      .eq("material_id", materialId)
      .eq("image_url", row.imageUrl)
      .maybeSingle();
    if (imageError) throw imageError;
    existing = imageMatch || null;
  }

  if (!existing?.id && matchStrategy !== "image_only") {
    const { data: existingRows, error: existingError } = await supabase
      .from("slabs")
      .select("id")
      .eq("supplier_id", supplierId)
      .eq("material_id", materialId)
      .eq("name", row.name)
      .limit(1);
    if (existingError) throw existingError;
    existing = Array.isArray(existingRows) ? existingRows[0] : null;
  }

  const payload = {
    supplier_id: supplierId,
    material_id: materialId,
    name: row.name,
    width: row.width,
    height: row.height,
    detail_url: row.detailUrl,
    image_url: row.imageUrl,
    stone_product_id: stoneProductId,
    active: true,
  };

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
  const requestedKeys = new Set(process.argv.slice(2).map((value) => normalize(value)).filter(Boolean));
  const configsToRun = requestedKeys.size
    ? SUPPLIERS.filter((config) => requestedKeys.has(normalize(config.key)))
    : SUPPLIERS;
  const supplierCache = new Map();
  const colorCache = new Map();
  const finishCache = new Map();
  const materialCache = new Map();
  const thicknessCache = new Map();

  for (const config of configsToRun) {
    const rows = mergeRows(loadConfigRows(config));
    const supplier = await upsertLookup("suppliers", config.supplierName, {
      website_url: config.websiteUrl,
      active: true,
    });
    supplierCache.set(config.supplierName, supplier.id);

    const run = await startSlabScrapeRun(supabase, supplier.id, "import_missing_supplier_catalogs", config.key);
    const seenSlabIds = [];
    let importedCount = 0;

    try {
      for (const row of rows) {
        if (!materialCache.has(row.materialName)) {
          materialCache.set(row.materialName, await getMaterialId(row.materialName));
        }
        const materialId = materialCache.get(row.materialName);

        if (row.brandName) {
          await upsertSupplierBrand(supplier.id, row.brandName, materialId);
        }

        const slab = await upsertSlab(row, supplier.id, materialId);
        seenSlabIds.push(slab.id);
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

      const seenCount = await touchSeenSlabs(supabase, seenSlabIds, run.id, run.startedAt);
      const deactivatedCount = await deactivateUnseenSlabs(supabase, supplier.id, seenSlabIds, run.startedAt);
      await finalizeSlabScrapeRun(supabase, run.id, {
        seenCount,
        insertedCount: 0,
        updatedCount: seenCount,
        deactivatedCount,
        notes: { importer: "import_missing_supplier_catalogs", sourceKey: config.key },
      });

      console.log(JSON.stringify({
        supplier: config.supplierName,
        sourceKey: config.key,
        importedRows: importedCount,
        seenCount,
        deactivatedCount,
      }));
    } catch (error) {
      await finalizeSlabScrapeRun(supabase, run.id, {
        status: "failed",
        seenCount: seenSlabIds.length,
        insertedCount: 0,
        updatedCount: seenSlabIds.length,
        deactivatedCount: 0,
        notes: {
          importer: "import_missing_supplier_catalogs",
          sourceKey: config.key,
          error: String(error?.message || error),
        },
      });
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
