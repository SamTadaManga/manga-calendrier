// Visuels pour les réseaux, dans la direction artistique du site : jaune d'imprimerie, trame de points, titres Dela Gothic One,
// cartes à ombre dure, autocollant, bandeau d'adresse. Dessinés en HTML puis photographiés avec Chrome (Playwright).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { ROOT, esc } from './lib.mjs';
import { label } from './social-contenu.mjs';

const FONTS = pathToFileURL(path.join(ROOT, 'scripts/assets/fonts')).href;
const THEMES = {
  jaune: { bg: '#ffd21f', ink: '#111', card: '#fff', edge: '#111', shadow: '#111', title: '#111', tshadow: '#fff', sticker: '#111', stickerInk: '#ffd21f', ray: 'rgba(255,255,255,.38)', dot: 'rgba(17,17,17,.16)', sub: '#3a3300' },
  sombre: { bg: '#121214', ink: '#f6f4ee', card: '#1f1f23', edge: '#ffd21f', shadow: '#ffd21f', title: '#ffd21f', tshadow: '#e4361b', sticker: '#e4361b', stickerInk: '#fff', ray: 'rgba(255,210,31,.09)', dot: 'rgba(255,255,255,.07)', sub: '#b9b6ab' },
};
const themeOf = (data) => THEMES[data.mode === 'semaine' ? 'sombre' : 'jaune'];

function css(W, H, T) {
  const u = W / 1080, p = (n) => `${(n * u).toFixed(1)}px`;
  return `
@font-face{font-family:Dela;src:url(${FONTS}/dela-400.woff) format("woff")}
@font-face{font-family:Zen;font-weight:400;src:url(${FONTS}/zen-400.woff) format("woff")}
@font-face{font-family:Zen;font-weight:700;src:url(${FONTS}/zen-700.woff) format("woff")}
@font-face{font-family:Zen;font-weight:900;src:url(${FONTS}/zen-900.woff) format("woff")}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{position:relative;background:${T.bg};color:${T.ink};font-family:Zen,system-ui,sans-serif;font-weight:700}
.rays{position:absolute;inset:-20%;background:repeating-conic-gradient(from 0deg at 50% 38%,${T.ray} 0 4deg,transparent 4deg 12deg)}
.dots{position:absolute;inset:0;background:radial-gradient(${T.dot} ${p(2.2)},transparent ${p(3)}) 0 0/${p(14)} ${p(14)};-webkit-mask-image:linear-gradient(170deg,transparent 40%,#000);mask-image:linear-gradient(170deg,transparent 40%,#000)}
.brand{display:flex;align-items:center;gap:${p(14)};font-family:Dela;font-size:${p(34)};letter-spacing:.01em;color:${T.ink}}
.mark{width:${p(40)};height:${p(40)};border:${p(5)} solid #111;background:#fff radial-gradient(circle,#111 0 ${p(7)},transparent ${p(7.5)});transform:rotate(-6deg)}
.title{font-family:Dela;white-space:nowrap;line-height:.98;text-transform:uppercase;color:${T.title};text-shadow:${p(6)} ${p(6)} 0 ${T.tshadow}}
.sticker{display:inline-block;background:${T.sticker};color:${T.stickerInk};font-family:Dela;text-transform:uppercase;padding:${p(14)} ${p(26)};border:${p(5)} solid ${T.edge === '#111' ? '#111' : '#fff'};border-radius:${p(6)};box-shadow:${p(7)} ${p(7)} 0 ${T.shadow};transform:rotate(-5deg);white-space:nowrap}
.pill{display:inline-block;background:${T.ink};color:${T.bg};padding:${p(8)} ${p(22)};border-radius:${p(40)};font-weight:900;font-size:${p(32)}}
.cv{position:relative;display:flex;flex-direction:column;gap:${p(12)};min-width:0}
.cover{container-type:inline-size;position:relative;aspect-ratio:2/3;border:${p(5)} solid ${T.edge};border-bottom:${p(14)} solid var(--pc);background:${T.card};box-shadow:${p(9)} ${p(9)} 0 ${T.shadow};overflow:hidden}
.cover .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:8cqw;text-align:center;font-family:Dela;font-size:10cqw;line-height:1.1;color:#fff;background:var(--pc);overflow-wrap:break-word;hyphens:auto}
.cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.nw{position:absolute;left:${p(-6)};top:${p(18)};z-index:3;background:#e4361b;color:#fff;font-weight:900;font-size:${p(24)};padding:${p(5)} ${p(16)};border:${p(4)} solid #111;box-shadow:${p(4)} ${p(4)} 0 #111;transform:rotate(-6deg)}
.lb{font-size:${p(27)};line-height:1.15;color:${T.ink};font-weight:900}
.lb b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:900}
.lb i{display:block;margin-top:${p(4)};font-style:normal;font-weight:700;font-size:${p(22)};color:${T.sub};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.banner{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:${p(20)};background:#111;color:#fff;border-top:${p(6)} solid ${T.edge === '#111' ? '#111' : '#ffd21f'};padding:0 ${p(44)};height:${p(118)}}
.banner .u{font-family:Dela;font-size:${p(50)};color:#ffd21f}
.banner .t{font-size:${p(26)};text-align:right;line-height:1.2;color:#e8e6dc}
.page{position:absolute;right:${p(44)};top:${p(40)};font-family:Dela;font-size:${p(30)};color:${T.ink};opacity:.75}`;
}

const titleSize = (lines, max, avail, per = 0.82) => Math.min(max, avail / (Math.max(...lines.map((l) => l.length)) * per));
const gridBlock = (list, W, H, top, rows, cols = 3) => {
  const u = W / 1080, avail = H / u - top - 118 - 36, gap = 30, rowH = (avail - gap * (rows - 1)) / rows, colW = (1080 - 108 - gap * (cols - 1)) / cols;
  const w = Math.min(colW, ((rowH - 104) * 2) / 3);
  return `<div style="position:absolute;left:0;right:0;top:${(top * u).toFixed(1)}px;display:grid;grid-template-columns:repeat(${cols},${(w * u).toFixed(1)}px);justify-content:center;gap:${(gap * u).toFixed(1)}px">${list.map((i) => cell(i, W)).join('')}</div>`;
};
const cell = (i, W, w) => `<div class="cv" style="--pc:${i.color};${w ? `width:${w}` : ''}">${i.nouveau ? '<span class="nw">NOUVEAU</span>' : ''}<div class="cover"><span class="ph">${esc(i.serie)}</span>${i.cover ? `<img src="${esc(i.cover)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div><div class="lb"><b>${esc(i.serie)}</b><i>${i.tome ? `Tome ${esc(i.tome)} · ` : ''}${esc(i.editeur)}</i></div></div>`;
const bannerHtml = (site) => `<div class="banner"><span class="u">${esc(site.replace(/^https?:\/\//, ''))}</span><span class="t">Toutes les sorties manga<br>et anime, jour par jour</span></div>`;
const brandHtml = () => '<div class="brand"><span class="mark"></span>PROCHAIN TOME</div>';
const pickCovers = (items, n) => [...items.filter((i) => i.cover), ...items.filter((i) => !i.cover)].slice(0, n);

/** HTML d'une image. layout : hook | grid | cta | single | wide */
export function slideHtml(layout, W, H, data, opt = {}) {
  const T = themeOf(data), u = W / 1080, p = (n) => `${(n * u).toFixed(1)}px`;
  const site = data.links.site;
  const t = data.title, ts = titleSize(t, layout === 'wide' ? 120 : 150, layout === 'wide' ? 520 : 960);
  let body = '';
  if (layout === 'hook') {
    const three = pickCovers(data.items, 3);
    const rot = [-8, 0, 8], dy = [50, 0, 50], tall = H / u > 1500;
    const kids = three.map((i, k) => { const o = three.length === 3 ? k : k + 1; return `<div style="transform:rotate(${rot[o]}deg) translateY(${p(dy[o])});width:${p(tall ? 350 : 320)};margin:0 ${p(-6)}">${cell(i, W).replace('class="lb"', 'class="lb" hidden')}</div>`; }).join('');
    body = `<div style="position:absolute;left:${p(54)};top:${p(54)};right:${p(54)}">${brandHtml()}</div>
<div style="position:absolute;left:${p(54)};right:${p(54)};top:${p(150)}"><div class="title" style="font-size:${p(ts)}">${t.map(esc).join('<br>')}</div>
<div style="margin-top:${p(34)};display:flex;gap:${p(24)};align-items:center;flex-wrap:nowrap"><span class="sticker" style="font-size:${p(44)}">${esc(data.sticker)}</span><span class="pill">${esc(data.when)}</span></div></div>
<div style="position:absolute;left:0;right:0;top:${tall ? p(780) : p(590)};display:flex;justify-content:center;align-items:flex-start">${kids}</div>
<div style="position:absolute;left:${p(54)};right:${p(54)};bottom:${p(150)};font-family:Dela;font-size:${p(38)};text-align:center;color:${T.ink}">${opt.swipe ? 'Fais défiler pour tout voir →' : ''}</div>`;
  } else if (layout === 'grid') {
    const list = opt.items || [];
    body = `<div style="position:absolute;left:${p(54)};top:${p(50)}">${brandHtml()}</div><span class="page">${esc(opt.page || '')}</span>
<div class="title" style="position:absolute;left:${p(54)};top:${p(118)};font-size:${p(Math.min(72, 960 / (t.join(' ').length * 0.82)))}">${esc(t.join(' '))}</div>
${gridBlock(list, W, H, 230, opt.rows || 2)}`;
  } else if (layout === 'single') {
    const list = pickCovers(data.items, 6);
    body = `<div style="position:absolute;left:${p(54)};top:${p(50)}">${brandHtml()}</div>
<div style="position:absolute;left:${p(54)};right:${p(54)};top:${p(120)}"><div class="title" style="font-size:${p(Math.min(118, ts))}">${t.map(esc).join('<br>')}</div><div style="margin-top:${p(24)};display:flex;gap:${p(20)};align-items:center;flex-wrap:nowrap"><span class="sticker" style="font-size:${p(38)}">${esc(data.sticker)}</span><span class="pill" style="font-size:${p(28)}">${esc(data.when)}</span></div></div>
${gridBlock(list, W, H, 480, 2)}`;
  } else if (layout === 'cta') {
    const pts = ['Filtre par éditeur, par mois ou par série', 'Suis tes séries et ta collection', 'Dates mises à jour chaque jour', 'Liens d’achat et fiches complètes', 'Gratuit, sans compte'];
    const tall = H / u > 1500;
    body = `<div style="position:absolute;left:${p(54)};top:${p(54)}">${brandHtml()}</div>
<div class="title" style="position:absolute;left:${p(54)};right:${p(54)};top:${p(tall ? 230 : 170)};font-size:${p(73)}">TOUTES LES DATES<br>À PORTÉE DE CLIC</div>
<div style="position:absolute;left:${p(54)};right:${p(54)};top:${p(tall ? 600 : 440)};display:flex;flex-direction:column;gap:${p(tall ? 64 : 24)}">${pts.map((x) => `<div style="display:flex;align-items:center;gap:${p(22)};background:${T.card};color:${T.ink};border:${p(5)} solid ${T.edge};box-shadow:${p(8)} ${p(8)} 0 ${T.shadow};padding:${p(tall ? 40 : 20)} ${p(26)};font-size:${p(36)};font-weight:900"><span style="font-family:Dela;font-size:${p(40)};color:#e4361b">✓</span>${esc(x)}</div>`).join('')}</div>`;
  } else if (layout === 'wide') {
    const list = pickCovers(data.items, 3);
    const rot = [-6, 0, 6], dy = [18, -8, 22];
    const fs = Math.min(96, 590 / (Math.max(...t.map((x) => x.length)) * 0.82));
    body = `<div style="position:absolute;left:${p(48)};top:${p(34)}">${brandHtml()}</div>
<div style="position:absolute;left:${p(48)};top:${p(112)};width:${p(600)}"><div class="title" style="font-size:${p(fs)}">${t.map(esc).join('<br>')}</div><div style="margin-top:${p(26)};display:flex;gap:${p(18)};align-items:center"><span class="sticker" style="font-size:${p(34)}">${esc(data.sticker)}</span><span class="pill" style="font-size:${p(24)};white-space:nowrap">${esc(data.when)}</span></div></div>
<div style="position:absolute;left:${p(684)};top:${p(96)};display:flex;align-items:flex-start">${list.map((i, k) => { const o = list.length === 3 ? k : k + 1; return `<div style="width:${p(150)};margin-left:${k ? p(-34) : 0};transform:rotate(${rot[o]}deg) translateY(${p(dy[o])})">${cell(i, W).replace('class="lb"', 'class="lb" hidden')}</div>`; }).join('')}</div>`;
  }
  const hasBanner = layout !== 'wide';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${css(W, H, T)}</style></head><body><div class="rays"></div><div class="dots"></div>${body}${hasBanner ? bannerHtml(site) : `<div class="banner" style="height:${p(70)}"><span class="u" style="font-size:${p(34)}">${esc(site.replace(/^https?:\/\//, ''))}</span><span class="t" style="font-size:${p(22)}">Toutes les sorties manga et anime</span></div>`}</body></html>`;
}

/** Jeux d'images d'une publication. `swipe` : un carrousel (accroche, grilles, appel à l'action) pour Instagram et TikTok. */
export function jobs(data) {
  const out = [];
  out.push({ name: 'bluesky-x', layout: 'wide', W: 1200, H: 675, data });
  out.push({ name: 'pinterest', layout: 'single', W: 1000, H: 1500, data });
  for (const [fmt, W, H] of [['instagram', 1080, 1350], ['tiktok', 1080, 1920]]) {
    const rows = fmt === 'tiktok' ? 3 : 2, per = rows * 3, pages = []; const items = data.items.filter((i) => i.cover).concat(data.items.filter((i) => !i.cover));
    for (let k = 0; k < items.length && pages.length < 2; k += per) pages.push(items.slice(k, k + per));
    out.push({ name: `${fmt}-1`, layout: 'hook', W, H, data, opt: { swipe: true } });
    pages.forEach((pg, k) => out.push({ name: `${fmt}-${k + 2}`, layout: 'grid', W, H, data, opt: { items: pg, rows, page: `${k + 1}/${pages.length}` } }));
    out.push({ name: `${fmt}-${pages.length + 2}`, layout: 'cta', W, H, data });
  }
  return out;
}

async function launch() {
  const require = createRequire(import.meta.url);
  let pw;
  for (const name of ['playwright', 'playwright-core']) { try { pw = require(name); break; } catch { try { pw = (await import(name)).default; break; } catch { /* suivant */ } } }
  if (!pw) throw new Error('Playwright est nécessaire : npm i --no-save playwright-core (et Chrome installé)');
  const { chromium } = pw;
  try { return await chromium.launch(); } catch { return await chromium.launch({ channel: 'chrome' }); }
}

/** Dessine toutes les images dans `dir` (JPEG). Renvoie la liste des fichiers. */
export async function render(list, dir) {
  mkdirSync(dir, { recursive: true });
  const browser = await launch();
  const files = [];
  try {
    for (const j of list) {
      const page = await browser.newPage({ viewport: { width: j.W, height: j.H }, deviceScaleFactor: 1 });
      const tmp = path.join(tmpdir(), `social-${process.pid}-${j.name}.html`);
      writeFileSync(tmp, slideHtml(j.layout, j.W, j.H, j.data, j.opt));
      await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 12000); })))));
      const file = path.join(dir, `${j.name}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
      files.push({ name: j.name, file, W: j.W, H: j.H });
      await page.close();
    }
  } finally { await browser.close(); }
  return files;
}
export { label };
