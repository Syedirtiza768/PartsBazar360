const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://partsbazar_user:partsbazar_password@postgres:5432/partsbazar_db',
    },
  },
});

const REALTRACK_STORES = [
  { storeId: '79f249a5-31e0-42a8-978c-a99b0665c61b', name: 'All About Mercedes' },
  { storeId: 'fa528c8a-f249-4816-94f6-f2ce8b932449', name: 'B.JLRWORLD' },
  { storeId: 'd16199c4-55b5-429e-ad27-892bed94e00d', name: 'BLACKLINEAUTOPARTS' },
  { storeId: '5fc75f19-31f3-44e4-b1ae-6545055f7945', name: 'K. Brit Auto Depot - UK' },
  { storeId: '65aff8ec-21ee-460f-af17-20daa0b843c1', name: 'K. Euro Japan Auto Parts' },
  { storeId: 'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0', name: 'K. Salvage Auto Parts' },
  { storeId: 'cc658cc0-ab21-4519-9f06-4aea8ff6a809', name: 'K. Salvage Dismantlers - DE' },
  { storeId: '7658e52e-4dd6-48a7-ad78-6933630bdac7', name: 'K. Southern Cross Auto Parts - AU' },
  { storeId: 'cfcc4a9c-c41b-4166-ab41-989c00a6fad1', name: 'Primemotive' },
  { storeId: '8d7d8b23-d769-4ed5-91e2-e26d14a45215', name: 'VW & RR' },
  { storeId: '70ad5c44-6424-4998-815c-99adf28c2487', name: 'eBay store' },
];

async function main() {
  console.log('Seeding sellers for all RealTrack-connected stores...');

  let org = await prisma.organization.findFirst({
    where: { name: 'RealTrack Connected Merchants' },
  });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'RealTrack Connected Merchants' },
    });
  }

  for (const store of REALTRACK_STORES) {
    const existing = await prisma.seller.findFirst({ where: { storeId: store.storeId } });
    if (existing) {
      console.log(`Seller already exists for ${store.name}, skipping.`);
      continue;
    }

    const seller = await prisma.seller.create({
      data: {
        organizationId: org.id,
        name: store.name,
        storeId: store.storeId,
      },
    });

    await prisma.warehouse.create({
      data: {
        sellerId: seller.id,
        name: `${store.name} Main Warehouse`,
      },
    });

    console.log(`Created Seller "${store.name}" (${store.storeId})`);
  }

  console.log('Done seeding RealTrack stores.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
