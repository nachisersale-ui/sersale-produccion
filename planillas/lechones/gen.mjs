import fs from 'fs';
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const f = process.argv[2], out = process.argv[3];
let h = fs.readFileSync(f, 'utf8');
const fila = (n) => `<tr><td class="n">${n}</td><td></td><td></td><td></td></tr>`;
const r = (a,b) => Array.from({length:b-a+1},(_,i)=>fila(a+i)).join('');
h = h.replace('<!--FILAS1-->', r(1,30)).replace('<!--FILAS2-->', r(31,60));
const letras = ['A','B','C','D'];
h = h.replace('<!--RANGOS-->', letras.map(L => `
  <div class="rango">
    <div class="tit">${L} · de ______ a ______ kg</div>
    <div class="cuenta"><div>Entraron</div><div>Salieron</div><div>Quedan</div></div>
    <table><tr><th style="width:9mm">N°</th><th style="width:11mm">Kg</th><th style="width:9mm">Res.</th><th>Para</th><th style="width:12mm">Salió</th></tr>
    ${Array.from({length:20},()=>`<tr><td></td><td></td><td style="text-align:center"><span class="chk"></span></td><td></td><td></td></tr>`).join('')}
    </table></div>`).join(''));
h = h.replace('<!--SALIDAS-->', Array.from({length:28},()=>'<tr>'+'<td></td>'.repeat(7)+'</tr>').join(''));
h = h.replace('<!--CONTROL-->', Array.from({length:22},()=>'<tr><td style="height:10.5mm"></td>'+'<td></td>'.repeat(6)+'</tr>').join(''));
fs.writeFileSync(f.replace('.html','.final.html'), h);
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent(h, { waitUntil: 'load' });
await p.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
await b.close();
