import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const svg = await fs.readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const sizes = [16, 32, 48, 64, 128, 256], images = [];
  for (const size of [...sizes, 180]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await page.screenshot({ omitBackground: true });
    await page.close();
    if (size === 180) await fs.writeFile(new URL('../public/apple-touch-icon.png', import.meta.url), image);
    else images.push(image);
  }
  // ICO directory with PNG-encoded images (16–256 px), supported by modern browsers/OSes.
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  sizes.forEach((size, index) => {
    const start = 6 + index * 16;
    directory[start] = size % 256; directory[start + 1] = size % 256;
    directory.writeUInt16LE(1, start + 4); directory.writeUInt16LE(32, start + 6);
    directory.writeUInt32LE(images[index].length, start + 8); directory.writeUInt32LE(offset, start + 12);
    offset += images[index].length;
  });
  await fs.writeFile(new URL('../public/favicon.ico', import.meta.url), Buffer.concat([directory, ...images]));
  console.log('Generated favicon.ico (16, 32, 48, 64, 128, 256 px) and apple-touch-icon.png.');
} finally { await browser.close(); }
