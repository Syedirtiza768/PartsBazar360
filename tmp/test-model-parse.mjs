const samples = [
  'TOYOTA RAV4 ACA2# 2000.08-2005.11 [EU]',
  'FORD RANGER ES 2009-2012 [EU]',
  'FORD EVEREST EP 2009- [EU]',
  'MAZDA BT-50 UN 2006-2011 [GEN]',
];
const re =
  /^(\S+)\s+(.+?)\s+(\d{4})(?:\.(\d{2}))?\s*-\s*(?:(\d{4})(?:\.(\d{2}))?)?\s*\[([^\]]+)\]\s*$/;
for (const raw of samples) {
  const m = raw.match(re);
  console.log(raw, '=>', m && m.slice(1));
}
