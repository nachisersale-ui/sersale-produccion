import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'fs';
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent(fs.readFileSync(process.argv[2],'utf8'), { waitUntil: 'load' });
await p.pdf({ path: process.argv[3], preferCSSPageSize: true, printBackground: true });
await b.close();
