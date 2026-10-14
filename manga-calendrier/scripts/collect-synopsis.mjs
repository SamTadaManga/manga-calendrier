// Résumés des mangas : lit la description de la page de l'éditeur du tome mis en avant (le prochain, sinon le dernier paru) -> data/synopsis.json
// Poli : 2 s entre deux requêtes, robots.txt respecté, SYNOPSIS_PER_RUN pages par passage (60 par défaut), une page déjà lue n'est pas relue.
// Test hors ligne : COLLECT_FIXTURES=test/fixtures/synopsis node scripts/collect-synopsis.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { paths, now, parisKey, addDays, loadAllManga, slugify } from './lib.mjs';
import { extractSynopsis, robotsAllows } from './collectors.mjs';

const P = paths();
const today = parisKey(now());
const UA = 'manga-calendrier/1.0 (calendrier gratuit de sorties; collecte quotidienne légère)';
const FIXTURES = process.env.COLLECT_FIXTURES ? path.resolve(process.env.COLLECT_FIXTURES) : '';
const BUDGET = Number(process.env.SYNOPSIS_PER_RUN || 60);
const HOSTS = /^https:\/\/(?:www\.)?(glenat\.com|kana\.fr|pika\.fr|ki-oon\.com|akata\.fr)\//;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const robots = new Map();
let last = 0;
async function get(url) {
  if (FIXTURES) {
    const f = path.join(FIXTURES, url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/_$/, '') + '.html');
    return existsSync(f) ? readFileSync(f, 'utf8') : '';
  }
  const u = new URL(url);
  if (!robots.has(u.origin)) {
    let txt = '';
    try { const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA } }); if (r.ok) txt = await r.text(); } catch { /* tout est permis */ }
    robots.set(u.origin, txt);
  }
  if (!robotsAllows(robots.get(u.origin), u.pathname)) return '';
  const wait = 2000 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`code ${res.status}`);
  return res.text();
}

const file = path.join(P.dataDir, 'synopsis.json');
let syn = {};
try { syn = JSON.parse(readFileSync(file, 'utf8')); } catch { /* premier passage */ }

// tome mis en avant par série : le prochain, sinon le dernier paru
const bySerie = new Map();
for (const r of loadAllManga(P.dataDir)) {
  if (r.statut === 'annule' || !r.date || !HOSTS.test(r.source || '')) continue;
  const k = slugify(r.serie);
  if (!k) continue;
  if (!bySerie.has(k)) bySerie.set(k, []);
  bySerie.get(k).push(r);
}
const featured = [];
for (const rows of bySerie.values()) {
  rows.sort((a, b) => a.date.localeCompare(b.date));
  featured.push(rows.find((r) => r.date >= today) || rows[rows.length - 1]);
}
const stale = addDays(today, -30); // une page sans résumé est retentée au bout d'un mois
const todo = featured
  .filter((r) => !(syn[r.source] && (syn[r.source].t || syn[r.source].d >= stale)))
  .sort((a, b) => a.date.localeCompare(b.date))
  .slice(0, BUDGET);

let found = 0, missed = 0, errors = 0;
for (const r of todo) {
  try {
    const html = await get(r.source);
    const t = html ? extractSynopsis(html) : '';
    syn[r.source] = { t, d: today };
    t ? found++ : missed++;
  } catch (e) {
    if (++errors >= 5) { console.error(`Résumés : arrêt après ${errors} erreurs (${e.message})`); break; }
  }
}
// un texte identique pour plusieurs tomes est un texte générique du site, pas un résumé
const count = new Map();
for (const v of Object.values(syn)) if (v.t) count.set(v.t, (count.get(v.t) || 0) + 1);
for (const v of Object.values(syn)) if (v.t && count.get(v.t) >= 3) v.t = '';

mkdirSync(P.dataDir, { recursive: true });
const out = JSON.stringify(syn) + '\n';
if (!existsSync(file) || readFileSync(file, 'utf8') !== out) writeFileSync(file, out);
console.log(`Résumés : ${found} trouvés, ${missed} sans résumé, ${errors} erreurs — ${Object.values(syn).filter((v) => v.t).length} au total (${featured.length} séries)`);
