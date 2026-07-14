import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { OpenSearchService } from './src/modules/search/opensearch.service';
import { parseVehicleFromTitle, extractOeNumbers, extractCategory, ParsedVehicle } from './src/modules/ingestion/listing-parser.util';

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter } as any);

async function findOrCreateVehicleConfig(vehicle: ParsedVehicle) {
  const make = await prisma.vehicleMake.upsert({
    where: { name: vehicle.make },
    update: {},
    create: { name: vehicle.make },
  });

  let model = await prisma.vehicleModel.findFirst({
    where: { makeId: make.id, name: vehicle.model },
  });
  if (!model) {
    model = await prisma.vehicleModel.create({
      data: { makeId: make.id, name: vehicle.model },
    });
  }

  let generation = await prisma.vehicleGeneration.findFirst({
    where: {
      modelId: model.id,
      startYear: { lte: vehicle.endYear },
      endYear: { gte: vehicle.startYear },
    },
  });
  if (!generation) {
    generation = await prisma.vehicleGeneration.create({
      data: {
        modelId: model.id,
        name: vehicle.startYear === vehicle.endYear ? `${vehicle.startYear}` : `${vehicle.startYear}-${vehicle.endYear}`,
        startYear: vehicle.startYear,
        endYear: vehicle.endYear,
      },
    });
  }

  let config = await prisma.vehicleConfiguration.findFirst({
    where: { generationId: generation.id },
  });
  if (!config) {
    config = await prisma.vehicleConfiguration.create({
      data: { generationId: generation.id, market: 'GLOBAL' },
    });
  }

  return config;
}

async function main() {
  console.log('Re-parsing all CanonicalPart titles with the improved fitment/OE-number parser...');

  const searchService = new OpenSearchService();
  searchService.onModuleInit();

  const parts = await prisma.canonicalPart.findMany({
    include: { fitments: true, offers: true },
  });

  console.log(`Found ${parts.length} parts to process.`);

  let fitmentsCreated = 0;
  let brandsFilled = 0;
  let oeFilled = 0;
  let reindexed = 0;

  for (const part of parts) {
    const parsedVehicle = parseVehicleFromTitle(part.title);
    const oeNumbers = extractOeNumbers(part.title);
    const category = part.category === 'General' ? extractCategory(part.title) : part.category;

    const updateData: any = {};

    if (!part.brand && parsedVehicle?.make) {
      updateData.brand = parsedVehicle.make;
    }
    if ((!part.oeNumbers || part.oeNumbers.length === 0) && oeNumbers.length > 0) {
      updateData.oeNumbers = oeNumbers;
    }
    if (category !== part.category) {
      updateData.category = category;
    }

    let fitmentVehicleConfigId: string | null = null;
    if (parsedVehicle && part.fitments.length === 0) {
      const vehicleConfig = await findOrCreateVehicleConfig(parsedVehicle);
      await prisma.fitment.upsert({
        where: {
          canonicalPartId_vehicleConfigId: {
            canonicalPartId: part.id,
            vehicleConfigId: vehicleConfig.id,
          },
        },
        update: {},
        create: {
          canonicalPartId: part.id,
          vehicleConfigId: vehicleConfig.id,
          evidenceLevel: 'D',
          confidence: 0.4,
          reviewer: 'Auto (title-inferred)',
        },
      });
      fitmentVehicleConfigId = vehicleConfig.id;
      fitmentsCreated++;
    }

    const hasChanges = Object.keys(updateData).length > 0 || fitmentVehicleConfigId;
    if (!hasChanges) continue;

    if (updateData.brand) brandsFilled++;
    if (updateData.oeNumbers) oeFilled++;

    const updatedPart = Object.keys(updateData).length > 0
      ? await prisma.canonicalPart.update({ where: { id: part.id }, data: updateData })
      : part;

    const allFitments = fitmentVehicleConfigId
      ? [...part.fitments, { vehicleConfigId: fitmentVehicleConfigId }]
      : part.fitments;

    await searchService.indexPart({
      id: updatedPart.id,
      title: updatedPart.title,
      brand: updatedPart.brand,
      category: updatedPart.category,
      oeNumbers: updatedPart.oeNumbers,
      imageUrls: updatedPart.imageUrls,
      createdAt: updatedPart.createdAt,
      fitments: allFitments,
      offers: part.offers,
    });
    reindexed++;

    if (reindexed % 100 === 0) {
      console.log(`...${reindexed} parts updated so far`);
    }
  }

  console.log(`Done. Fitments created: ${fitmentsCreated}, brands filled: ${brandsFilled}, OE numbers filled: ${oeFilled}, reindexed: ${reindexed}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
