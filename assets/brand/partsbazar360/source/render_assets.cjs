/**
 * Raster exports for the PartsBazar360 identity. Run after build_identity.py:
 *
 *   node assets/brand/partsbazar360/source/render_assets.cjs
 *
 * Reads svg/ and writes png/, webp/, favicon/, app-icons/, social/ and qa/.
 * Uses the repo's own `sharp` (librsvg), so every raster comes from the same
 * vector masters.
 */
const fs = require("fs");
const path = require("path");

const PKG = path.resolve(__dirname, "..");
const REPO = path.resolve(PKG, "../../..");
const sharp = require(path.join(REPO, "node_modules", "sharp"));

const SVG = path.join(PKG, "svg");
const dir = (name) => {
  const d = path.join(PKG, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const PNG = dir("png");
const WEBP = dir("webp");
const FAV = dir("favicon");
const APP = dir("app-icons");
const SOCIAL = dir("social");
const QA = dir("qa");

const PETROL = "#116b6b";
const CANVAS = "#f4f2ed";
const GRAPHITE = "#0d1519";

const svgFile = (stem) => path.join(SVG, `${stem}.svg`);
// librsvg rasterises at `density` DPI before resizing; 1200 keeps tiny exports sharp.
const raster = (input, opts) => sharp(input, { density: 1200 }).resize(opts);

async function pngAndWebp(stem, opts, suffix) {
  const name = `${stem}_${suffix}`;
  const buf = await raster(svgFile(stem), opts).png().toBuffer();
  fs.writeFileSync(path.join(PNG, `${name}.png`), buf);
  await sharp(buf).webp({ lossless: true }).toFile(path.join(WEBP, `${name}.webp`));
  return name;
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  images.forEach(({ size, buf }, i) => {
    const o = i * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, o);
    entries.writeUInt8(size >= 256 ? 0 : size, o + 1);
    entries.writeUInt16LE(1, o + 4); // colour planes
    entries.writeUInt16LE(32, o + 6); // bits per pixel
    entries.writeUInt32LE(buf.length, o + 8);
    entries.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, entries, ...images.map((im) => im.buf)]);
}

// A symbol filled with an arbitrary colour, centred on a square canvas.
function symbolOnSquare(size, symbolHeightFrac, fill, background) {
  const sym = fs.readFileSync(svgFile("partsbazar360_symbol_mono-white"), "utf8");
  const vb = sym.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
  const d = sym.match(/ d="([^"]+)"/)[1];
  const h = size * symbolHeightFrac;
  const s = h / vb[3];
  const w = vb[2] * s;
  const tx = (size - w) / 2 - vb[0] * s + size * 0.008; // P's mass sits left; nudge right
  const ty = (size - h) / 2 - vb[1] * s;
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}` +
      `<path fill="${fill}" fill-rule="evenodd" transform="translate(${tx} ${ty}) scale(${s})" d="${d}"/></svg>`
  );
}

async function main() {
  const made = [];

  // ---- Logo exports -------------------------------------------------------
  const colorways = ["fullcolor", "reversed", "mono-black", "mono-white"];
  for (const cw of colorways) {
    for (const w of [600, 1200, 2400]) {
      made.push(await pngAndWebp(`partsbazar360_horizontal_${cw}`, { width: w }, `${w}w`));
      made.push(await pngAndWebp(`partsbazar360_wordmark_${cw}`, { width: w }, `${w}w`));
    }
    for (const w of [600, 1200]) made.push(await pngAndWebp(`partsbazar360_stacked_${cw}`, { width: w }, `${w}w`));
    for (const h of [256, 512, 1024]) made.push(await pngAndWebp(`partsbazar360_symbol_${cw}`, { height: h }, `${h}h`));
  }
  for (const cw of ["mono-black", "mono-white"]) {
    made.push(await pngAndWebp(`partsbazar360_production-horizontal_${cw}`, { width: 2400 }, "2400w"));
  }
  made.push(await pngAndWebp("partsbazar360_horizontal_plate", { width: 1200 }, "1200w"));

  // ---- Favicons -----------------------------------------------------------
  const f16 = await raster(svgFile("partsbazar360_symbol_micro16"), { width: 16, height: 16 }).png().toBuffer();
  const tile = (n) => raster(svgFile("partsbazar360_appicon_rounded"), { width: n, height: n }).png().toBuffer();
  const f24 = await tile(24);
  const f32 = await tile(32);
  const f48 = await tile(48);
  fs.writeFileSync(path.join(FAV, "favicon-16x16.png"), f16);
  fs.writeFileSync(path.join(FAV, "favicon-24x24.png"), f24);
  fs.writeFileSync(path.join(FAV, "favicon-32x32.png"), f32);
  fs.writeFileSync(path.join(FAV, "favicon-48x48.png"), f48);
  fs.writeFileSync(path.join(FAV, "favicon.ico"), ico([{ size: 16, buf: f16 }, { size: 32, buf: f32 }, { size: 48, buf: f48 }]));
  fs.copyFileSync(svgFile("partsbazar360_appicon_rounded"), path.join(FAV, "favicon.svg"));
  // Apple applies its own mask and rejects transparency: full-bleed square, flattened.
  await raster(svgFile("partsbazar360_appicon_square"), { width: 180, height: 180 })
    .flatten({ background: PETROL })
    .png()
    .toFile(path.join(FAV, "apple-touch-icon.png"));
  for (const n of [192, 512]) {
    fs.writeFileSync(path.join(FAV, `icon-${n}x${n}.png`), await tile(n));
    await raster(svgFile("partsbazar360_appicon_maskable"), { width: n, height: n })
      .png()
      .toFile(path.join(FAV, `icon-maskable-${n}x${n}.png`));
  }
  fs.writeFileSync(
    path.join(FAV, "site.webmanifest"),
    JSON.stringify(
      {
        name: "PartsBazar360",
        short_name: "PartsBazar360",
        theme_color: PETROL,
        background_color: CANVAS,
        display: "standalone",
        icons: [
          { src: "icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-192x192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icon-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      null,
      2
    ) + "\n"
  );

  // ---- App store icons ----------------------------------------------------
  await raster(svgFile("partsbazar360_appicon_square"), { width: 1024, height: 1024 })
    .flatten({ background: PETROL })
    .removeAlpha()
    .png()
    .toFile(path.join(APP, "ios-appstore-1024.png"));
  await raster(svgFile("partsbazar360_appicon_square"), { width: 512, height: 512 })
    .flatten({ background: PETROL })
    .png()
    .toFile(path.join(APP, "android-playstore-512.png"));
  // Adaptive icon: 108dp canvas, the P inside the 66dp safe circle.
  await sharp(symbolOnSquare(432, 0.46, CANVAS, null)).png().toFile(path.join(APP, "android-adaptive-foreground-432.png"));
  await sharp(symbolOnSquare(432, 0.46, CANVAS, PETROL)).png().toFile(path.join(APP, "android-adaptive-preview-432.png"));
  await sharp(symbolOnSquare(432, 0.3, "#ffffff", null)).png().toFile(path.join(APP, "android-notification-monochrome-432.png"));

  // ---- Social -------------------------------------------------------------
  await raster(svgFile("partsbazar360_avatar"), { width: 1080, height: 1080 }).png().toFile(path.join(SOCIAL, "profile-1080.png"));
  await raster(svgFile("partsbazar360_avatar"), { width: 640, height: 640 }).png().toFile(path.join(SOCIAL, "whatsapp-business-640.png"));
  const ogLogo = await raster(svgFile("partsbazar360_horizontal_fullcolor"), { width: 760 }).png().toBuffer();
  const ogMeta = await sharp(ogLogo).metadata();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: CANVAS } })
    .composite([{ input: ogLogo, left: Math.round((1200 - ogMeta.width) / 2), top: Math.round((630 - ogMeta.height) / 2) }])
    .png()
    .toFile(path.join(SOCIAL, "og-image-1200x630.png"));

  // ---- QA proofs ----------------------------------------------------------
  // Grayscale, photocopy (hard threshold) and thermal (203 dpi, 1-bit) from the
  // full-colour and mono masters. Thermal: 40 mm wide lockup = 320 px at 203 dpi.
  const full = await raster(svgFile("partsbazar360_horizontal_fullcolor"), { width: 1200 })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  await sharp(full).grayscale().png().toFile(path.join(QA, "qa-grayscale.png"));
  await sharp(full).grayscale().threshold(150).png().toFile(path.join(QA, "qa-photocopy-threshold.png"));
  for (const mm of [40, 25]) {
    const px = Math.round((mm / 25.4) * 203);
    const thermal = await raster(svgFile("partsbazar360_horizontal_mono-black"), { width: px })
      .flatten({ background: "#ffffff" })
      .grayscale()
      .threshold(128)
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(QA, `qa-thermal-203dpi-${mm}mm.png`), thermal);
  }
  // Actual-size strips: the exact favicon bitmaps on light and dark browser chrome.
  const strip = async (bg) => {
    const comps = [];
    let x = 12;
    for (const [buf, n] of [[f16, 16], [f24, 24], [f32, 32], [f48, 48]]) {
      comps.push({ input: buf, left: x, top: Math.round((64 - n) / 2) });
      x += n + 20;
    }
    return sharp({ create: { width: x, height: 64, channels: 4, background: bg } }).composite(comps).png().toBuffer();
  };
  fs.writeFileSync(path.join(QA, "qa-favicons-light-1x.png"), await strip("#ffffff"));
  fs.writeFileSync(path.join(QA, "qa-favicons-dark-1x.png"), await strip("#202124"));

  console.log(`exported ${made.length} logo rasters (png + webp each), favicons, app icons, social, qa`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
