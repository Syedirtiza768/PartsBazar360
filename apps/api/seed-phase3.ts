import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { OpenSearchService } from './src/modules/search/opensearch.service';

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log('Starting Phase 3 seed: Vehicle Hierarchy & Fitment...');

  // 1. Create Vehicle Hierarchy
  const make = await prisma.vehicleMake.create({
    data: { name: 'Mercedes-Benz' }
  });

  const model = await prisma.vehicleModel.create({
    data: { name: 'C-Class', makeId: make.id }
  });

  const generation = await prisma.vehicleGeneration.create({
    data: { name: 'W205', modelId: model.id, startYear: 2014, endYear: 2021 }
  });

  const config = await prisma.vehicleConfiguration.create({
    data: {
      generationId: generation.id,
      engine: '2.0L I4 Turbo',
      transmission: '9G-TRONIC',
      market: 'GCC',
    }
  });

  console.log('Created Vehicle Configuration:', config.id);

  // 2. Fetch an existing part from Phase 2
  const part = await prisma.canonicalPart.findFirst({
    include: { offers: true }
  });

  if (!part) {
    console.warn('No Canonical Parts found. Please run Phase 2 seed first.');
    return;
  }

  // 3. Create Fitment linking the Part to the Vehicle Configuration
  const fitment = await prisma.fitment.create({
    data: {
      canonicalPartId: part.id,
      vehicleConfigId: config.id,
      evidenceLevel: 'B', // OE Verified
      confidence: 1.0,
      reviewer: 'System Seed'
    }
  });

  console.log(`Created Fitment: Part ${part.id} fits Vehicle ${config.id}`);

  // 4. Index the Canonical Part into OpenSearch
  console.log('Indexing part into OpenSearch...');
  const searchService = new OpenSearchService();
  // Simulating the OnModuleInit
  searchService.onModuleInit();
  
  await searchService.indexPart({
    id: part.id,
    title: part.title,
    brand: part.brand,
    category: part.category,
    fitments: [{ vehicleConfigId: fitment.vehicleConfigId }],
    offers: part.offers
  });

  // 5. Create a Mock User and My Garage Vehicle
  const user = await prisma.user.create({
    data: {
      email: 'test@garage.local',
      name: 'Test Workshop User',
      role: 'WORKSHOP'
    }
  });

  await prisma.userVehicle.create({
    data: {
      userId: user.id,
      vehicleConfigId: config.id,
      nickname: 'Daily Driver C300',
      vin: 'WDD2050401AXXXXXX'
    }
  });

  console.log('Created Test User and added vehicle to My Garage');
  console.log('Phase 3 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
