const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.canonicalPart.findUnique({
  where: { id: '0a4583af-44cd-44bc-a459-4cd17f2df80d' },
  select: { imageUrls: true }
}).then(r => {
  console.log(JSON.stringify(r?.imageUrls, null, 2));
  p.$disconnect();
}).catch(e => {
  console.error(e);
  p.$disconnect();
});
