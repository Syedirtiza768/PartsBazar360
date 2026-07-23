/**
 * Import US eBay Motors Vehicle List (MVL) from US_MVL_2026_05.xlsx into MvlVehicle.
 *
 * Usage (API container or host with DATABASE_URL):
 *   MVL_XLSX_PATH=/data/US_MVL_2026_05.xlsx node scripts/import-us-mvl.mjs
 *   MVL_LIMIT=1000 node scripts/import-us-mvl.mjs   # smoke test
 *
 * Idempotent on ePID (upsert).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const XLSX_PATH =
  process.env.MVL_XLSX_PATH ||
  path.resolve(process.cwd(), 'US_MVL_2026_05.xlsx');
const LIMIT = process.env.MVL_LIMIT ? Number(process.env.MVL_LIMIT) : null;
const BATCH = Math.max(100, Number(process.env.MVL_BATCH || 500));
const SHEET = process.env.MVL_SHEET || 'US_MVL_2026_05';

function normalizeToken(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .trim();
}

function cellStr(v) {
  if (v == null) return null;
  if (typeof v === 'object' && v.text) return String(v.text).trim() || null;
  const s = String(v).trim();
  return s && s !== 'N/A' && s !== 'None' ? s : null;
}

function cellInt(v) {
  const s = cellStr(v);
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  console.log(JSON.stringify({ event: 'mvl_import_start', path: XLSX_PATH, sheet: SHEET, limit: LIMIT }));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(XLSX_PATH);
  const ws = workbook.getWorksheet(SHEET);
  if (!ws) throw new Error(`Sheet ${SHEET} not found`);

  const headerRow = ws.getRow(1).values || [];
  const col = {};
  for (let i = 1; i < headerRow.length; i++) {
    const name = String(headerRow[i] || '').trim();
    if (name) col[name] = i;
  }
  const required = ['ePID', 'Make', 'Model', 'Year'];
  for (const r of required) {
    if (!col[r]) throw new Error(`Missing column ${r}`);
  }

  let read = 0;
  let upserted = 0;
  let skipped = 0;
  let batch = [];

  async function flush() {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    // Prisma createMany + skipDuplicates requires unique epid; then update missing fields via raw upserts.
    // Use individual upserts in parallel chunks for correctness.
    const chunk = 50;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      await Promise.all(
        slice.map((row) =>
          prisma.mvlVehicle.upsert({
            where: { epid: row.epid },
            create: row,
            update: {
              year: row.year,
              make: row.make,
              model: row.model,
              trim: row.trim,
              submodel: row.submodel,
              engine: row.engine,
              driveType: row.driveType,
              fuelType: row.fuelType,
              body: row.body,
              aspiration: row.aspiration,
              displayName: row.displayName,
              region: row.region,
              partsModel: row.partsModel,
              numDoors: row.numDoors,
              normalizedMake: row.normalizedMake,
              normalizedModel: row.normalizedModel,
              updatedAt: new Date(),
            },
          }),
        ),
      );
      upserted += slice.length;
    }
    if (upserted % 5000 < BATCH) {
      console.log(JSON.stringify({ event: 'mvl_import_progress', read, upserted, skipped }));
    }
  }

  const totalRows = ws.rowCount;
  for (let r = 2; r <= totalRows; r++) {
    if (LIMIT && read >= LIMIT) break;
    const row = ws.getRow(r);
    const epid = cellStr(row.getCell(col.ePID).value);
    const make = cellStr(row.getCell(col.Make).value);
    const model = cellStr(row.getCell(col.Model).value);
    const year = cellInt(row.getCell(col.Year).value);
    read++;
    if (!epid || !make || !model || !year) {
      skipped++;
      continue;
    }
    const nMake = normalizeToken(make);
    const nModel = normalizeToken(model);
    if (!nMake || !nModel) {
      skipped++;
      continue;
    }
    batch.push({
      id: randomUUID(),
      epid,
      year,
      make,
      model,
      trim: cellStr(row.getCell(col.Trim)?.value),
      submodel: cellStr(row.getCell(col.Submodel)?.value),
      engine: cellStr(row.getCell(col.Engine)?.value),
      driveType: cellStr(row.getCell(col['Drive Type'])?.value),
      fuelType: cellStr(row.getCell(col['Fuel Type Name'])?.value),
      body: cellStr(row.getCell(col.Body)?.value),
      aspiration: cellStr(row.getCell(col.Aspiration)?.value),
      displayName: cellStr(row.getCell(col.DisplayName)?.value),
      region: cellStr(row.getCell(col.Region)?.value),
      partsModel: cellStr(row.getCell(col['Parts Model'])?.value),
      numDoors: cellInt(row.getCell(col.NumDoors)?.value),
      normalizedMake: nMake,
      normalizedModel: nModel,
      updatedAt: new Date(),
    });
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  const count = await prisma.mvlVehicle.count();
  console.log(JSON.stringify({ event: 'mvl_import_done', read, upserted, skipped, tableCount: count }));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
