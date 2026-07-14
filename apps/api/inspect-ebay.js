async function main() {
  const url = 'https://www.ebay.co.uk/itm/2016-2024-Mini-Cooper-Top-Hifi-System-Amplifier-65125A41CD8-/306888777114';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const html = await res.text();
  console.log('status', res.status, 'length', html.length);

  // image urls
  const imgMatches = [...html.matchAll(/https:\/\/i\.ebayimg\.com\/images\/g\/[^"'\\\s]+/g)].map(m => m[0]);
  const uniqueImgs = [...new Set(imgMatches.map(u => u.replace(/\\u002F/g, '/').split('?')[0]))];
  console.log('unique ebay images:', uniqueImgs.length);
  console.log(uniqueImgs.slice(0, 20));

  // compatibility table markers
  for (const needle of ['compatibility', 'Fits', 'Year', 'itemCompatibilityList', 'compatibleWith', 'FITMENT']) {
    const idx = html.toLowerCase().indexOf(needle.toLowerCase());
    if (idx >= 0) console.log('found', needle, 'at', idx);
  }

  // look for JSON blobs
  const jsonBlobs = [...html.matchAll(/application\/json[^>]*>(\{[\s\S]*?\})<\/script>/g)];
  console.log('json script tags', jsonBlobs.length);

  // try __NEXT_DATA__ or similar
  const next = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (next) console.log('NEXT_DATA length', next[1].length);

  // extract any vehicle compatibility strings
  const yearMake = [...html.matchAll(/(20\d{2})\s*[–-]\s*(20\d{2})\s+([A-Za-z][A-Za-z0-9 &\-]+)\s+([A-Za-z0-9 &\-]+)/g)].slice(0, 10);
  console.log('year-make samples', yearMake.map(m => m[0]));

  // save snippet around image gallery
  const gIdx = html.indexOf('i.ebayimg.com');
  if (gIdx >= 0) console.log('snippet', html.slice(Math.max(0, gIdx - 100), gIdx + 400).replace(/\s+/g, ' '));
}

main().catch(console.error);
