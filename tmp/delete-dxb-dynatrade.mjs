/**
 * Delete Dynatrade + DXB spreadsheet parts/offers from DB (keeps FEBEST + RealTrack).
 * Run inside API container:
 *   node /tmp/delete-dxb-dynatrade.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function isTargetFileName(name) {
  const n = String(name || '');
  return /dxb/i.test(n) || /dynatrade/i.test(n);
}

function isTargetTemplate(value) {
  const t = String(value || '');
  return t === 'DXB_EXW' || t === 'DYNATRADE_STOCK';
}

async function main() {
  const jobs = await prisma.sellerUploadJob.findMany({
    select: { id: true, fileName: true, sellerId: true, detection: true, report: true },
  });
  const targetJobs = jobs.filter((j) => {
    if (isTargetFileName(j.fileName)) return true;
    const blob = JSON.stringify({ detection: j.detection, report: j.report });
    return /DXB_EXW|DYNATRADE_STOCK|DXB|Dynatrade/i.test(blob);
  });
  const jobIds = targetJobs.map((j) => j.id);
  console.log(JSON.stringify({ targetJobs: targetJobs.map((j) => ({ id: j.id, fileName: j.fileName })) }, null, 2));

  const rows = jobIds.length
    ? await prisma.sellerUploadRow.findMany({
        where: { uploadJobId: { in: jobIds } },
        select: { sellerOfferId: true, canonicalPartId: true },
      })
    : [];

  const sourceRecords = await prisma.sourceRecord.findMany({
    where: {
      OR: [
        { sourceFileName: { contains: 'DXB', mode: 'insensitive' } },
        { sourceFileName: { contains: 'Dynatrade', mode: 'insensitive' } },
        { sourceFileName: { contains: 'DYNATRADE', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      sellerOfferId: true,
      canonicalPartId: true,
      sourceFileName: true,
      transformations: true,
      rawPayload: true,
    },
  });

  const moreSources = await prisma.sourceRecord.findMany({
    where: {
      OR: [
        { transformations: { path: ['template'], equals: 'DXB_EXW' } },
        { transformations: { path: ['template'], equals: 'DYNATRADE_STOCK' } },
      ],
    },
    select: {
      id: true,
      sellerOfferId: true,
      canonicalPartId: true,
      sourceFileName: true,
    },
  });

  const allSources = [...sourceRecords, ...moreSources];
  const offerIds = [
    ...new Set(
      [...rows.map((r) => r.sellerOfferId), ...allSources.map((s) => s.sellerOfferId)].filter(Boolean),
    ),
  ];
  const partIds = [
    ...new Set(
      [...rows.map((r) => r.canonicalPartId), ...allSources.map((s) => s.canonicalPartId)].filter(Boolean),
    ),
  ];

  console.log(JSON.stringify({ offerCount: offerIds.length, partCandidates: partIds.length, sourceCount: allSources.length }, null, 2));

  if (offerIds.length) {
    await prisma.cartItem.deleteMany({ where: { sellerOfferId: { in: offerIds } } });
    await prisma.orderItem.deleteMany({ where: { sellerOfferId: { in: offerIds } } });
    await prisma.salvageUnit.deleteMany({ where: { sellerOfferId: { in: offerIds } } });
    await prisma.inventory.deleteMany({ where: { offerId: { in: offerIds } } });
    await prisma.offerPrice.deleteMany({ where: { offerId: { in: offerIds } } });
    await prisma.sellerUploadRow.updateMany({
      where: { sellerOfferId: { in: offerIds } },
      data: { sellerOfferId: null },
    });
    await prisma.sourceRecord.updateMany({
      where: { sellerOfferId: { in: offerIds } },
      data: { sellerOfferId: null },
    });
    await prisma.supportTicket.updateMany({
      where: { sellerOfferId: { in: offerIds } },
      data: { sellerOfferId: null },
    });
    const deletedOffers = await prisma.sellerOffer.deleteMany({ where: { id: { in: offerIds } } });
    console.log('deletedOffers', deletedOffers.count);
  }

  if (allSources.length) {
    const deletedSources = await prisma.sourceRecord.deleteMany({
      where: { id: { in: [...new Set(allSources.map((s) => s.id))] } },
    });
    console.log('deletedSourceRecords', deletedSources.count);
  }

  if (jobIds.length) {
    const deletedJobs = await prisma.sellerUploadJob.deleteMany({ where: { id: { in: jobIds } } });
    console.log('deletedUploadJobs', deletedJobs.count);
  }

  // Orphan parts: only those from target set with no remaining offers/upload rows
  let deletedParts = 0;
  for (const partId of partIds) {
    const [offersLeft, rowsLeft] = await Promise.all([
      prisma.sellerOffer.count({ where: { canonicalPartId: partId } }),
      prisma.sellerUploadRow.count({ where: { canonicalPartId: partId } }),
    ]);
    if (offersLeft > 0 || rowsLeft > 0) continue;

    await prisma.sourceRecord.updateMany({ where: { canonicalPartId: partId }, data: { canonicalPartId: null } });
    await prisma.supportTicket.updateMany({ where: { canonicalPartId: partId }, data: { canonicalPartId: null } });
    await prisma.reviewTask.updateMany({ where: { canonicalPartId: partId }, data: { canonicalPartId: null } });

    const fitments = await prisma.fitment.findMany({ where: { canonicalPartId: partId }, select: { id: true } });
    const fitmentIds = fitments.map((f) => f.id);
    if (fitmentIds.length) {
      await prisma.fitmentEvidence.deleteMany({ where: { fitmentId: { in: fitmentIds } } });
      await prisma.fitment.deleteMany({ where: { id: { in: fitmentIds } } });
    }
    await prisma.catalogPartNumber.deleteMany({ where: { canonicalPartId: partId } });
    await prisma.productMedia.deleteMany({ where: { canonicalPartId: partId } });
    await prisma.salvageUnit.deleteMany({ where: { canonicalPartId: partId } });
    await prisma.canonicalPartRedirect.deleteMany({
      where: { OR: [{ fromPartId: partId }, { toPartId: partId }] },
    });
    await prisma.auditEvent.deleteMany({ where: { canonicalPartId: partId } });
    await prisma.canonicalPart.delete({ where: { id: partId } });
    deletedParts++;
  }

  console.log(JSON.stringify({ ok: true, deletedParts }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
