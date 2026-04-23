#!/usr/bin/env node
// Generate PWA icons from an SVG source. Run once:
//   node scripts/generate-icons.js
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

// Simple boutique monogram: lowercase "w" in Fraunces-style serif on cream.
const svg = (size, maskable) => {
  const inset = maskable ? Math.round(size * 0.15) : 0;
  const inner = size - inset * 2;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#1a1712"/>
  <g transform="translate(${inset}, ${inset})">
    <rect x="0" y="0" width="${inner}" height="${inner}" fill="#fdfbf7"/>
    <text
      x="${inner / 2}"
      y="${inner / 2 + inner * 0.18}"
      font-family="Georgia, 'Times New Roman', serif"
      font-size="${inner * 0.68}"
      font-style="italic"
      font-weight="400"
      text-anchor="middle"
      fill="#1a1712"
      letter-spacing="-0.04em"
    >w</text>
    <rect x="${inner * 0.1}" y="${inner * 0.82}" width="${inner * 0.8}" height="${Math.max(1, inner * 0.008)}" fill="#7a4f3a"/>
  </g>
</svg>`.trim();
};

async function make(size, file, maskable = false) {
  const buffer = Buffer.from(svg(size, maskable));
  const out = path.join(iconsDir, file);
  await sharp(buffer).png().toFile(out);
  console.log('wrote', out);
}

(async () => {
  await make(192, 'icon-192.png');
  await make(512, 'icon-512.png');
  await make(512, 'icon-maskable-512.png', true);
  // Apple touch icon (180x180 is conventional)
  await make(180, 'apple-touch-icon.png');
  console.log('done');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
