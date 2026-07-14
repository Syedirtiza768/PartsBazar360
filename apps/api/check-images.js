const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

async function main() {
  const count = await prisma.canonicalPart.count();
  console.log('Total parts:', count);

  const parts = await prisma.canonicalPart.findMany({
    take: 3,
    select: { id: true, title: true, imageUrls: true },
  });

  for (const part of parts) {
    console.log('\nID:', part.id);
    console.log('Title:', part.title);
    console.log('Image URLs:', JSON.stringify(part.imageUrls));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
