/**
 * Export Salvage Auto Parts catalog to CSV.
 *
 *   node dist/src/export-salvage.cli.js
 *   EXPORT_PATH=./my-parts.csv node dist/src/export-salvage.cli.js
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { MARKETPLACE_SELLERS } from './modules/seed/marketplace-sellers.config';

function csvEscape(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function arrayToCell(arr: unknown[] | null | undefined): string {
  if (!arr || arr.length === 0) return '';
  return arr.join('; ');
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const prisma = app.get(PrismaService);
  const sellerId = MARKETPLACE_SELLERS.salvage.id;

  console.log(`Exporting parts for seller: ${MARKETPLACE_SELLERS.salvage.name} (${sellerId})`);

  const offers = await prisma.sellerOffer.findMany({
    where: { sellerId },
    include: {
      canonicalPart: {
        include: {
          salvageUnits: true,
          partNumbers: true,
          media: { where: { isPrimary: true }, take: 1 },
        },
      },
      inventory: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (offers.length === 0) {
    console.log('No offers found for Salvage Auto Parts.');
    await app.close();
    return;
  }

  console.log(`Found ${offers.length} offers. Fetching donor vehicles...`);

  // Fetch donor vehicles for salvage units
  const salvageUnitIds = offers
    .flatMap((o) => o.canonicalPart.salvageUnits)
    .map((su) => su.donorVehicleId)
    .filter(Boolean) as string[];

  const donorVehicles = salvageUnitIds.length
    ? await prisma.donorVehicle.findMany({
        where: { id: { in: salvageUnitIds } },
        include: { make: true },
      })
    : [];

  const donorMap = new Map(donorVehicles.map((dv) => [dv.id, dv]));

  const headers = [
    'Part Title',
    'Brand',
    'Manufacturer',
    'Category',
    'Part Type',
    'Condition',
    'Quality Tier',
    'Part Source',
    'Price',
    'Currency',
    'Seller SKU',
    'eBay Item ID',
    'OEM Part Numbers',
    'MPN',
    'Position',
    'Vehicle System',
    'Image URL',
    'Listing URL',
    'Quantity',
    'Fitment Status',
    'Donor Vehicle Year',
    'Donor Vehicle Make',
    'Donor Vehicle Model',
    'Donor Vehicle Trim',
    'Donor Vehicle Engine',
    'Donor Vehicle Transmission',
    'Condition Grade',
    'Tested Status',
    'Damage Notes',
    'Seller Notes',
  ];

  const rows: string[][] = offers.map((offer) => {
    const part = offer.canonicalPart;
    const salvageUnit = part.salvageUnits[0] ?? null;
    const donor = salvageUnit?.donorVehicleId
      ? donorMap.get(salvageUnit.donorVehicleId)
      : null;
    const primaryImage = part.media[0]?.url ?? '';
    const totalQty = offer.inventory.reduce((sum, inv) => sum + inv.quantity, 0);

    return [
      part.title,
      part.brand ?? '',
      part.manufacturer ?? '',
      part.category ?? '',
      part.partType,
      offer.condition,
      offer.qualityTier,
      part.partSource,
      String(offer.price),
      offer.currency,
      offer.sellerSku ?? '',
      part.ebayItemId ?? '',
      arrayToCell(part.oeNumbers),
      part.manufacturerPartNumber ?? '',
      part.position ?? '',
      part.vehicleSystem ?? '',
      primaryImage,
      part.listingUrl ?? '',
      String(totalQty),
      part.fitmentStatus,
      String(donor?.modelYear ?? ''),
      donor?.make?.displayName ?? '',
      donor?.model ?? '',
      donor?.trim ?? '',
      donor?.engine ?? '',
      donor?.transmission ?? '',
      salvageUnit?.conditionGrade ?? '',
      salvageUnit?.testedStatus ?? '',
      salvageUnit?.damageNotes ?? '',
      offer.sellerNotes ?? '',
    ];
  });

  const csvLines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => row.map(csvEscape).join(',')),
  ];

  const csvContent = csvLines.join('\n');
  const outputPath = path.resolve(
    process.env.EXPORT_PATH || 'tmp/salvage-auto-parts-export.csv',
  );

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, csvContent, 'utf-8');

  console.log(`Exported ${offers.length} parts to ${outputPath}`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
