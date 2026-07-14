const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

function expandYearRange(startYear, endYear, make, model) {
  if (!startYear || !endYear || !make || !model) return [];
  const from = Math.min(startYear, endYear);
  const to = Math.max(startYear, endYear);
  const rows = [];
  for (let year = from; year <= Math.min(to, from + 40); year++) {
    rows.push({ year, make, model, trim: '-', engine: '-', source: 'title' });
  }
  return rows;
}

function upgradeImages(urls = []) {
  return [...new Set(urls.map((u) => String(u).replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, '/s-l1600.$1')))];
}

async function main() {
  const parts = await prisma.canonicalPart.findMany({
    include: {
      fitments: {
        include: {
          vehicleConfig: {
            include: {
              generation: {
                include: { model: { include: { make: true } } },
              },
            },
          },
        },
      },
    },
  });

  console.log('Backfilling', parts.length, 'parts...');
  let updated = 0;

  for (const part of parts) {
    const imageUrls = upgradeImages(part.imageUrls || []);

    let compatibility = Array.isArray(part.compatibility) ? part.compatibility : [];
    if (compatibility.length === 0) {
      for (const f of part.fitments) {
        const gen = f.vehicleConfig?.generation;
        const model = gen?.model;
        const make = model?.make;
        if (!gen || !model || !make) continue;
        compatibility = compatibility.concat(
          expandYearRange(gen.startYear, gen.endYear, make.name, model.name),
        );
      }
    }

    // de-dupe
    const seen = new Set();
    compatibility = compatibility.filter((r) => {
      const key = `${r.year}|${r.make}|${r.model}|${r.trim}|${r.engine}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const imagesChanged = JSON.stringify(imageUrls) !== JSON.stringify(part.imageUrls || []);
    const compatChanged = compatibility.length > 0 && JSON.stringify(compatibility) !== JSON.stringify(part.compatibility || []);

    if (imagesChanged || compatChanged) {
      await prisma.canonicalPart.update({
        where: { id: part.id },
        data: {
          imageUrls,
          compatibility: compatibility.length > 0 ? compatibility : part.compatibility,
        },
      });
      updated++;
      if (updated % 100 === 0) console.log('updated', updated);
    }
  }

  console.log('Done. Updated', updated, 'parts.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
