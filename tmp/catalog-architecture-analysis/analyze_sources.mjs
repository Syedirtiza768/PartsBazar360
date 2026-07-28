import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputs = [
  {
    key: "dxb",
    path: "C:\\Users\\Irtaza Hassan\\Downloads\\DXB-EXW (Special_2)-14.07.2026.xlsx",
    sheetName: "DXB-EXW (Special_2)",
    previewRange: "A1:G24",
  },
  {
    key: "febest",
    path: "C:\\Users\\Irtaza Hassan\\Downloads\\FEBEST_Availability_2026-07-14_16_09_36.xlsx",
    sheetName: "Worksheet",
    previewRange: "A1:K24",
  },
];

const outputDir = path.resolve("artifacts");
await fs.mkdir(outputDir, { recursive: true });

const clean = (value) => String(value ?? "").trim();
const numeric = (value) => {
  const parsed = Number(clean(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const normalizeNumber = (value) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};
const stats = (values) => {
  const nums = values.filter((v) => v !== null && Number.isFinite(v));
  return {
    count: nums.length,
    min: nums.length ? Math.min(...nums) : null,
    p25: percentile(nums, 0.25),
    median: percentile(nums, 0.5),
    p75: percentile(nums, 0.75),
    max: nums.length ? Math.max(...nums) : null,
    mean: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
  };
};
const topCounts = (values, limit = 30) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
};

const makeAliases = {
  "ALFA ROMEO": "Alfa Romeo",
  "ASTON MARTIN": "Aston Martin",
  "BAIC MOTOR": "BAIC",
  "BMW": "BMW",
  "BRILLIANCE": "Brilliance",
  "BUICK": "Buick",
  "CADILLAC": "Cadillac",
  "CHANGAN": "Changan",
  "CHERY": "Chery",
  "CHEVROLET": "Chevrolet",
  "CHRYSLER": "Chrysler",
  "CITROEN": "Citroen",
  "DACIA": "Dacia",
  "DAEWOO": "Daewoo",
  "DAIHATSU": "Daihatsu",
  "DODGE": "Dodge",
  "DONGFENG": "Dongfeng",
  "FAW": "FAW",
  "FIAT": "Fiat",
  "FORD": "Ford",
  "GEELY": "Geely",
  "GENERAL MOTORS": "General Motors",
  "GENESIS": "Genesis",
  "GMC": "GMC",
  "GREAT WALL": "Great Wall",
  "HAVAL": "Haval",
  "HINO": "Hino",
  "HONDA": "Honda",
  "HYUNDAI": "Hyundai",
  "INFINITI": "Infiniti",
  "ISUZU": "Isuzu",
  "JAC": "JAC",
  "JAGUAR": "Jaguar",
  "JEEP": "Jeep",
  "KIA": "Kia",
  "LADA": "Lada",
  "LANCIA": "Lancia",
  "LAND ROVER": "Land Rover",
  "LANDROVER": "Land Rover",
  "LEXUS": "Lexus",
  "LINCOLN": "Lincoln",
  "MAHINDRA": "Mahindra",
  "MAN": "MAN",
  "MASERATI": "Maserati",
  "MAZDA": "Mazda",
  "MERCEDES BENZ": "Mercedes-Benz",
  "MERCEDES-BENZ": "Mercedes-Benz",
  "MERCEDES": "Mercedes-Benz",
  "MINI": "MINI",
  "MITSUBISHI": "Mitsubishi",
  "NISSAN": "Nissan",
  "OPEL": "Opel",
  "PEUGEOT": "Peugeot",
  "PORSCHE": "Porsche",
  "RAM": "Ram",
  "RENAULT": "Renault",
  "ROLLS ROYCE": "Rolls-Royce",
  "SAAB": "Saab",
  "SEAT": "SEAT",
  "SKODA": "Skoda",
  "SMART": "Smart",
  "SSANGYONG": "SsangYong",
  "SUBARU": "Subaru",
  "SUZUKI": "Suzuki",
  "TATA": "Tata",
  "TESLA": "Tesla",
  "TOYOTA": "Toyota",
  "VAUXHALL": "Vauxhall",
  "VOLKSWAGEN": "Volkswagen",
  "VOLVO": "Volvo",
  "VW": "Volkswagen",
};
const makeMatchers = Object.entries(makeAliases).sort((a, b) => b[0].length - a[0].length);

function parseOemCell(value) {
  const tokens = clean(value)
    .split(/\s*,\s*/)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.map((token) => {
    const upper = token.toUpperCase();
    const match = makeMatchers.find(([alias]) => upper === alias || upper.startsWith(`${alias} `));
    if (!match) return { raw: token, make: null, number: null };
    const [alias, make] = match;
    const number = token.slice(alias.length).trim();
    return { raw: token, make, number: number || null, normalizedNumber: normalizeNumber(number) };
  });
}

function profileDxb(rows) {
  const headers = rows[0].map(clean);
  const data = rows.slice(1).filter((row) => row.some((cell) => clean(cell) !== ""));
  const brands = data.map((row) => clean(row[1]).toUpperCase());
  const pricesUsd = data.map((row) => numeric(row[5]));
  const pricesAed = data.map((row) => numeric(row[6]));
  const qty = data.map((row) => numeric(row[3]));
  const moq = data.map((row) => numeric(row[4]));

  const composite = new Map();
  const numberBrands = new Map();
  data.forEach((row, index) => {
    const brand = clean(row[1]).toUpperCase();
    const number = normalizeNumber(row[2]);
    if (!number) return;
    const key = `${brand}|${number}`;
    if (!composite.has(key)) composite.set(key, []);
    composite.get(key).push(index + 2);
    if (!numberBrands.has(number)) numberBrands.set(number, new Map());
    const byBrand = numberBrands.get(number);
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand).push(index + 2);
  });

  const duplicateBrandNumber = [...composite.entries()]
    .filter(([, rowNumbers]) => rowNumbers.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 25)
    .map(([key, rowNumbers]) => ({ key, count: rowNumbers.length, rowNumbers }));
  const sameNumberMultipleBrands = [...numberBrands.entries()]
    .filter(([, brandsMap]) => brandsMap.size > 1)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 25)
    .map(([number, brandsMap]) => ({
      normalizedNumber: number,
      brands: [...brandsMap.entries()].map(([brand, rowNumbers]) => ({ brand, rowNumbers })),
    }));

  const ratios = data
    .map((row) => {
      const usd = numeric(row[5]);
      const aed = numeric(row[6]);
      return usd && aed !== null ? aed / usd : null;
    })
    .filter((v) => v !== null);
  const ratioMedian = percentile(ratios, 0.5);
  const ratioOutliers = ratios.filter((ratio) => Math.abs(ratio - ratioMedian) > 0.0001).length;

  const requestedBrands = [
    "BMW", "TOYOTA", "NISSAN", "MITSUBISHI", "HONDA", "SUBARU",
    "VAG", "MOBIS", "GENERAL MOTORS", "GATES", "BOSCH", "DENSO", "SKF", "MEYLE", "ASHIKA",
  ];
  const samplesByBrand = Object.fromEntries(
    requestedBrands.map((brand) => [
      brand,
      data
        .map((row, index) => ({ rowNumber: index + 2, values: row.map((cell) => cell) }))
        .filter((row) => clean(row.values[1]).toUpperCase() === brand)
        .slice(0, 3),
    ]),
  );

  return {
    headers,
    dataRows: data.length,
    blankCounts: headers.map((header, col) => ({
      header,
      blanks: data.filter((row) => clean(row[col]) === "").length,
    })),
    distinctBrands: new Set(brands.filter(Boolean)).size,
    topBrands: topCounts(brands, 40),
    allBrandCounts: topCounts(brands, Number.MAX_SAFE_INTEGER),
    quantity: stats(qty),
    moq: stats(moq),
    priceUsd: stats(pricesUsd),
    priceAed: stats(pricesAed),
    zeroOrNegative: {
      quantity: qty.filter((v) => v !== null && v <= 0).length,
      moq: moq.filter((v) => v !== null && v <= 0).length,
      priceUsd: pricesUsd.filter((v) => v !== null && v <= 0).length,
      priceAed: pricesAed.filter((v) => v !== null && v <= 0).length,
    },
    currencyRatio: { medianAedPerUsd: ratioMedian, outliers: ratioOutliers, count: ratios.length },
    duplicateBrandNumberGroups: [...composite.values()].filter((r) => r.length > 1).length,
    duplicateBrandNumberRows: [...composite.values()].filter((r) => r.length > 1).reduce((sum, r) => sum + r.length, 0),
    duplicateBrandNumberExamples: duplicateBrandNumber,
    normalizedNumberAcrossMultipleBrandsGroups: [...numberBrands.values()].filter((b) => b.size > 1).length,
    normalizedNumberAcrossMultipleBrandsExamples: sameNumberMultipleBrands,
    samplesByBrand,
  };
}

function profileFebest(rows) {
  const headers = rows[0].map(clean);
  const data = rows.slice(1).filter((row) => row.some((cell) => clean(cell) !== ""));
  const referenceGroups = new Map();
  const parsedRows = [];
  data.forEach((row, index) => {
    const normalizedReference = normalizeNumber(row[1]);
    if (normalizedReference) {
      if (!referenceGroups.has(normalizedReference)) referenceGroups.set(normalizedReference, []);
      referenceGroups.get(normalizedReference).push(index + 2);
    }
    const parsed = parseOemCell(row[5]);
    parsedRows.push({ rowNumber: index + 2, row, parsed });
  });

  const allRefs = parsedRows.flatMap((row) => row.parsed);
  const makeCounts = topCounts(allRefs.filter((ref) => ref.make).map((ref) => ref.make), 60);
  const unparsed = allRefs.filter((ref) => !ref.make);
  const rowRefCounts = parsedRows.map((row) => row.parsed.length);
  const rowMakeCounts = parsedRows.map((row) => new Set(row.parsed.map((ref) => ref.make).filter(Boolean)).size);
  const stockSharjah = data.map((row) => numeric(row[3]));
  const stockJebelAli = data.map((row) => numeric(row[4]));
  const prices = data.map((row) => numeric(row[6]));
  const netWeights = data.map((row) => numeric(row[7]));
  const grossWeights = data.map((row) => numeric(row[8]));
  const dimensions = {
    height: data.map((row) => numeric(row[0])),
    length: data.map((row) => numeric(row[9])),
    width: data.map((row) => numeric(row[10])),
  };

  const requestedRefs = ["MZAB-124", "0282-F15R", "2101-CA2R", "KSB-PICF", "FDAB-035", "MM-N43ARR"];
  const examplesByReference = Object.fromEntries(
    requestedRefs.map((reference) => [
      reference,
      parsedRows
        .filter((entry) => clean(entry.row[1]).toUpperCase() === reference)
        .map((entry) => ({
          rowNumber: entry.rowNumber,
          values: entry.row,
          parsedOem: entry.parsed,
        })),
    ]),
  );

  return {
    headers,
    dataRows: data.length,
    blankCounts: headers.map((header, col) => ({
      header,
      blanks: data.filter((row) => clean(row[col]) === "").length,
    })),
    distinctNormalizedReferences: referenceGroups.size,
    duplicateReferenceGroups: [...referenceGroups.values()].filter((r) => r.length > 1).length,
    duplicateReferenceRows: [...referenceGroups.values()].filter((r) => r.length > 1).reduce((sum, r) => sum + r.length, 0),
    duplicateReferenceExamples: [...referenceGroups.entries()]
      .filter(([, rowNumbers]) => rowNumbers.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 30)
      .map(([reference, rowNumbers]) => ({ reference, count: rowNumbers.length, rowNumbers })),
    stockSharjah: stats(stockSharjah),
    stockJebelAli: stats(stockJebelAli),
    price: stats(prices),
    netWeight: stats(netWeights),
    grossWeight: stats(grossWeights),
    height: stats(dimensions.height),
    length: stats(dimensions.length),
    width: stats(dimensions.width),
    zeroStock: {
      sharjah: stockSharjah.filter((v) => v === 0).length,
      jebelAli: stockJebelAli.filter((v) => v === 0).length,
      bothWarehouses: data.filter((row) => numeric(row[3]) === 0 && numeric(row[4]) === 0).length,
      positiveAnyWarehouse: data.filter((row) => (numeric(row[3]) ?? 0) > 0 || (numeric(row[4]) ?? 0) > 0).length,
    },
    invalidOrNonPositive: {
      price: prices.filter((v) => v === null || v <= 0).length,
      netWeight: netWeights.filter((v) => v === null || v <= 0).length,
      grossWeight: grossWeights.filter((v) => v === null || v <= 0).length,
      height: dimensions.height.filter((v) => v === null || v <= 0).length,
      length: dimensions.length.filter((v) => v === null || v <= 0).length,
      width: dimensions.width.filter((v) => v === null || v <= 0).length,
    },
    oemReferences: {
      tokenCount: allRefs.length,
      parsedCount: allRefs.length - unparsed.length,
      unparsedCount: unparsed.length,
      distinctCanonicalMakes: new Set(allRefs.map((ref) => ref.make).filter(Boolean)).size,
      makeCounts,
      referencesPerRow: stats(rowRefCounts),
      makesPerRow: stats(rowMakeCounts),
      rowsWithMultipleReferences: rowRefCounts.filter((count) => count > 1).length,
      rowsWithMultipleMakes: rowMakeCounts.filter((count) => count > 1).length,
      rowsWithNoOemText: data.filter((row) => clean(row[5]) === "").length,
      unparsedExamples: unparsed.slice(0, 100),
    },
    grossLessThanNetRows: data
      .map((row, index) => ({ rowNumber: index + 2, net: numeric(row[7]), gross: numeric(row[8]), reference: clean(row[1]) }))
      .filter((row) => row.net !== null && row.gross !== null && row.gross < row.net)
      .slice(0, 100),
    examplesByReference,
  };
}

for (const input of inputs) {
  console.log(`Importing ${input.key}...`);
  const blob = await FileBlob.load(input.path);
  const workbook = await SpreadsheetFile.importXlsx(blob);
  const sheet = workbook.worksheets.getItem(input.sheetName);
  const used = sheet.getUsedRange(true);
  const rows = used.values;
  const profile = input.key === "dxb" ? profileDxb(rows) : profileFebest(rows);
  await fs.writeFile(
    path.join(outputDir, `${input.key}-profile.json`),
    JSON.stringify(profile, null, 2),
    "utf8",
  );
  const preview = await workbook.render({
    sheetName: input.sheetName,
    range: input.previewRange,
    scale: 1.25,
    format: "png",
  });
  await fs.writeFile(
    path.join(outputDir, `${input.key}-preview.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
  console.log(`${input.key}: ${profile.dataRows} rows profiled`);
}
