// Catalogue : liste des tomes manga des éditeurs (ISBN, série, tome) -> data/catalogue.json
// Légère : une seule requête par éditeur (le sitemap produits), robots.txt respecté.
// Si un éditeur ne répond pas, ses anciennes entrées sont conservées.
// Test hors ligne : COLLECT_FIXTURES=test/fixtures/catalogue node scripts/collect-catalogue.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { paths, now, parisKey } from './lib.mjs';
import { parseSitemapCatalogue, robotsAllows } from './collectors.mjs';

const P = paths();
const today = parisKey(now());
const UA = 'manga-calendrier/1.0 (calendrier gratuit de sorties; collecte quotidienne légère)';
const FIXTURES = process.env.COLLECT_FIXTURES ? path.resolve(process.env.COLLECT_FIXTURES) : '';

async function get(url) {
  if (FIXTURES) {
    const file = path.join(FIXTURES, url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/_$/, '') + '.xml');
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }
  const u = new URL(url);
  let txt = '';
  try {
    const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA } });
    if (r.ok) txt = await r.text();
  } catch { /* pas de robots.txt lisible */ }
  if (!robotsAllows(txt, u.pathname)) { console.log(`  ignoré (robots.txt) : ${url}`); return null; }
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml' }, redirect: 'follow' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`code ${res.status} pour ${url}`);
  return res.text();
}

const SOURCES = [
  { editeur: 'Glénat', url: 'https://www.glenat.com/products.xml', hrefPrefix: '/glenat-manga/' },
  { editeur: 'Pika', url: 'https://www.pika.fr/products.xml', hrefPrefix: '/livre/' },
];

const file = path.join(P.dataDir, 'catalogue.json');
let previous = { items: [] };
try { previous = JSON.parse(readFileSync(file, 'utf8')); } catch { /* premier passage */ }

const items = [];
const report = [];
for (const src of SOURCES) {
  let rows = [];
  try {
    const xml = await get(src.url);
    if (xml) rows = parseSitemapCatalogue(xml, src);
  } catch (e) {
    console.error(`${src.editeur} : échec (${e.message})`);
  }
  if (rows.length) {
    const old = new Map(previous.items.filter((i) => i.editeur === src.editeur).map((i) => [i.isbn, i]));
    for (const r of rows) items.push({ ...r, vu: today, depuis: old.get(r.isbn)?.depuis || today });
    report.push(`${src.editeur} : ${rows.length}`);
  } else {
    const old = previous.items.filter((i) => i.editeur === src.editeur);
    items.push(...old);
    report.push(`${src.editeur} : 0 trouvé (${old.length} conservés)`);
  }
}
items.sort((a, b) => a.editeur.localeCompare(b.editeur) || a.key.localeCompare(b.key) || Number(a.tome || 0) - Number(b.tome || 0));
const out = JSON.stringify({ maj: today, items }) + '\n';
mkdirSync(P.dataDir, { recursive: true });
if (!existsSync(file) || readFileSync(file, 'utf8') !== out) writeFileSync(file, out);
console.log(`Catalogue : ${items.length} tomes — ${report.join(' | ')}`);
