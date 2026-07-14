import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { OpenSearchService } from './src/modules/search/opensearch.service';

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter } as any);

// Old, un-normalized make names captured by the original naive title parser
// (before make aliasing was added), mapped to their canonical form.
const MAKE_MERGES: Array<[string, string]> = [
  ['VW', 'Volkswagen'],
  ['VolksWagen', 'Volkswagen'],
  ['Mercedes', 'Mercedes-Benz'],
  ['Land', 'Land Rover'],
];

async function mergeMake(oldName: string, canonicalName: string, searchService: OpenSearchService) {
  const oldMake = await prisma.vehicleMake.findUnique({ where: { name: oldName } });
  if (!oldMake) {
    console.log(`No make found for "${oldName}", skipping.`);
    return;
  }

  const canonicalMake = await prisma.vehicleMake.upsert({
    where: { name: canonicalName },
    update: {},
    create: { name: canonicalName },
  });
  if (oldMake.id === canonicalMake.id) return;

  const affectedParts = await prisma.canonicalPart.findMany({ where: { brand: oldName } });
  await prisma.canonicalPart.updateMany({ where: { brand: oldName }, data: { brand: canonicalName } });
  console.log(`Renamed brand on ${affectedParts.length} parts: "${oldName}" -> "${canonicalName}"`);

  const oldModels = await prisma.vehicleModel.findMany({
    where: { makeId: oldMake.id },
    include: { generations: { include: { configurations: { include: { fitments: true } } } } },
  });

  for (const oldModel of oldModels) {
    const canonicalModel =
      (await prisma.vehicleModel.findFirst({ where: { makeId: canonicalMake.id, name: oldModel.name } })) ??
      (await prisma.vehicleModel.update({ where: { id: oldModel.id }, data: { makeId: canonicalMake.id } }));

    if (canonicalModel.id === oldModel.id) continue; // simple repoint case, nothing else to merge

    for (const oldGen of oldModel.generations) {
      const canonicalGen =
        (await prisma.vehicleGeneration.findFirst({
          where: { modelId: canonicalModel.id, startYear: oldGen.startYear, endYear: oldGen.endYear },
        })) ?? (await prisma.vehicleGeneration.update({ where: { id: oldGen.id }, data: { modelId: canonicalModel.id } }));

      if (canonicalGen.id === oldGen.id) continue;

      for (const oldConfig of oldGen.configurations) {
        const canonicalConfig =
          (await prisma.vehicleConfiguration.findFirst({ where: { generationId: canonicalGen.id } })) ??
          (await prisma.vehicleConfiguration.update({ where: { id: oldConfig.id }, data: { generationId: canonicalGen.id } }));

        if (canonicalConfig.id === oldConfig.id) continue;

        for (const fitment of oldConfig.fitments) {
          const exists = await prisma.fitment.findUnique({
            where: { canonicalPartId_vehicleConfigId: { canonicalPartId: fitment.canonicalPartId, vehicleConfigId: canonicalConfig.id } },
          });
          if (exists) {
            await prisma.fitment.delete({ where: { id: fitment.id } });
          } else {
            await prisma.fitment.update({ where: { id: fitment.id }, data: { vehicleConfigId: canonicalConfig.id } });
          }
        }
        await prisma.vehicleConfiguration.delete({ where: { id: oldConfig.id } });
      }
      await prisma.vehicleGeneration.delete({ where: { id: oldGen.id } });
    }
    await prisma.vehicleModel.delete({ where: { id: oldModel.id } });
  }

  await prisma.vehicleMake.delete({ where: { id: oldMake.id } });

  // Reindex affected parts with their (possibly repointed) fitments/offers
  for (const part of affectedParts) {
    const full = await prisma.canonicalPart.findUnique({
      where: { id: part.id },
      include: { fitments: true, offers: true },
    });
    if (!full) continue;
    await searchService.indexPart({
      id: full.id,
      title: full.title,
      brand: full.brand,
      category: full.category,
      oeNumbers: full.oeNumbers,
      imageUrls: full.imageUrls,
      createdAt: full.createdAt,
      fitments: full.fitments,
      offers: full.offers,
    });
  }
}

async function main() {
  const searchService = new OpenSearchService();
  searchService.onModuleInit();

  for (const [oldName, canonicalName] of MAKE_MERGES) {
    await mergeMake(oldName, canonicalName, searchService);
  }

  console.log('Done merging duplicate makes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
