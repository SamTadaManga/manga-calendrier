// Couvertures du catalogue : lit la page de chaque tome (Glénat, Pika) pour y trouver l'adresse de l'image -> data/covers.json
// Progressif et poli : COVERS_PER_RUN pages par passage (300 par défaut), 2 s entre deux requêtes, robots.txt respecté.
// Ordre : d'abord le premier tome de chaque série (une couverture suffit pour la page Séries), puis les autres.
// Test hors ligne : COLLECT_FIXTURES=test/fixtures/covers node scripts/collect-covers.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { paths, now, parisKey, addDays } from './lib.mjs';
import { hachetteCover, robotsAllows } from './collectors.mjs';

const P = paths();
const today = parisKey(now());
const UA = 'manga-calendrier/1.0 (calendrier gratuit de sorties; collecte quotidienne légère)';
const FIXTURES = process.env.COLLECT_FIXTURES ? path.resolve(process.env.COLLECT_FIXTURES) : '';
const BUDGET = Number(process.env.COVERS_PER_RUN || 300);
const DELAY = Math.max(1000, Number(process.env.COVERS_DELAY_MS || 2000)); // jamais moins d'une seconde entre deux requêtes
const RETRY_AFTER_DAYS = 30; // une page sans couverture est retentée au bout d'un mois

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const robots = new Map();
let last = 0;
async function get(url) {
  if (FIXTURES) {
    const f = path.join(FIXTURES, url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/_$/, '') + '.html');
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  }
  const u = new URL(url);
  if (!robots.has(u.origin)) {
    let txt = '';
    try { const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA } }); if (r.ok) txt = await r.text(); } catch { /* tout est permis */ }
    robots.set(u.origin, txt);
  }
  if (!robotsAllows(robots.get(u.origin), u.pathname)) return null;
  const wait = 2000 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`code ${res.status}`);
  return res.text();
}

let cat;
try { cat = JSON.parse(readFileSync(path.join(P.dataDir, 'catalogue.json'), 'utf8')).items || []; } catch { console.log('Couvertures : pas de catalogue.'); process.exit(0); }
const file = path.join(P.dataDir, 'covers.json');
let covers = {};
try { covers = JSON.parse(readFileSync(file, 'utf8')); } catch { /* premier passage */ }

const stale = addDays(today, -RETRY_AFTER_DAYS);
const todo = cat.filter((i) => i.source && !(covers[i.isbn] && (covers[i.isbn].u || covers[i.isbn].d >= stale)));
// un seul candidat prioritaire par série : son plus petit tome
const bySerie = new Map();
for (const i of todo) {
  const k = `${i.editeur}|${i.key}`;
  const cur = bySerie.get(k);
  if (!cur || Number(i.tome || 0) < Number(cur.tome || 0)) bySerie.set(k, i);
}
const seriesWithCover = new Set(cat.filter((i) => covers[i.isbn]?.u).map((i) => `${i.editeur}|${i.key}`));
const first = [...bySerie.entries()].filter(([k]) => !seriesWithCover.has(k)).map(([, i]) => i);
const firstSet = new Set(first.map((i) => i.isbn));
const queue = [...first, ...todo.filter((i) => !firstSet.has(i.isbn))].slice(0, BUDGET);

const file2 = file;
const save = () => { mkdirSync(P.dataDir, { recursive: true }); const o = JSON.stringify(covers) + '\n'; if (!existsSync(file2) || readFileSync(file2, 'utf8') !== o) writeFileSync(file2, o); };
let found = 0, missed = 0, errors = 0, n = 0;
for (const i of queue) {
  try {
    const html = await get(i.source);
    const u = html ? hachetteCover(html, i.isbn) : '';
    covers[i.isbn] = { u, d: today };
    u ? found++ : missed++;
    if (++n % 100 === 0) save();
  } catch (e) {
    if (++errors >= 5) { console.error(`Couvertures : arrêt après ${errors} erreurs (${e.message})`); break; }
  }
}
mkdirSync(P.dataDir, { recursive: true });
const out = JSON.stringify(covers) + '\n';
if (!existsSync(file) || readFileSync(file, 'utf8') !== out) writeFileSync(file, out);
const have = Object.values(covers).filter((c) => c.u).length;
console.log(`Couvertures : ${found} trouvées, ${missed} sans image, ${errors} erreurs — ${have} au total sur ${cat.length} tomes (reste ${Math.max(0, todo.length - queue.length + errors)} à traiter)`);
