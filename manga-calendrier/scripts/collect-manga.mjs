// Collecte automatique des plannings des éditeurs (Glénat, Kana, Pika, Ki-oon) -> data/manga-auto.csv
// Politesse : User-Agent qui s'identifie, robots.txt respecté, ~15 requêtes par jour, 2 s entre deux requêtes.
// Si un éditeur ne répond pas ou change sa page, ses anciennes lignes sont conservées et le reste continue.
//
// Usage normal : node scripts/collect-manga.mjs
// Test hors ligne : COLLECT_FIXTURES=test/fixtures/publishers node scripts/collect-manga.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { paths, now, parisKey, addDays, loadManga } from './lib.mjs';
import { readChanges, updateChanges, serializeChanges } from './changes.mjs';
import { parseHachette, parseKana, parseKioon, robotsAllows } from './collectors.mjs';

const P = paths();
const today = parisKey(now());
const UA = 'manga-calendrier/1.0 (calendrier gratuit de sorties; collecte quotidienne légère)';
const MONTHS_AHEAD = 2; // mois courant + 2 suivants
const FIXTURES = process.env.COLLECT_FIXTURES ? path.resolve(process.env.COLLECT_FIXTURES) : '';

const months = [];
{
  let [y, m] = today.split('-').map(Number);
  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    months.push({ y, m, ym: `${y}-${String(m).padStart(2, '0')}` });
    if (++m > 12) { m = 1; y++; }
  }
}
const first = `${months[0].ym}-01`;
const lastMonth = months[months.length - 1];
const last = `${lastMonth.ym}-31`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const robotsCache = new Map();
let lastCall = 0;

async function get(url, { json = false } = {}) {
  if (FIXTURES) {
    const name = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/_$/, '');
    const file = path.join(FIXTURES, `${name}.${json ? 'json' : 'html'}`);
    if (!existsSync(file)) return null;
    const t = readFileSync(file, 'utf8');
    return json ? JSON.parse(t) : t;
  }
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let txt = '';
    try {
      const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA } });
      if (r.ok) txt = await r.text();
    } catch { /* pas de robots.txt lisible : on considère que tout est permis */ }
    robotsCache.set(u.origin, txt);
  }
  if (!robotsAllows(robotsCache.get(u.origin), u.pathname)) {
    console.log(`  ignoré (robots.txt) : ${url}`);
    return null;
  }
  const wait = 2000 - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html' }, redirect: 'follow' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`code ${res.status} pour ${url}`);
  return json ? res.json() : res.text();
}

const SOURCES = [
  {
    editeur: 'Glénat',
    async run() {
      const rows = [];
      for (const { ym } of months) {
        const html = await get(`https://www.glenat.com/manga/planning-des-sorties/${ym}/`);
        if (html) rows.push(...parseHachette(html, { editeur: 'Glénat', base: 'https://www.glenat.com/', hrefPrefix: '/glenat-manga/' }));
      }
      return rows;
    },
  },
  {
    editeur: 'Kana',
    async run() {
      const rows = [];
      for (const { y, m } of months) {
        const html = await get(`https://www.kana.fr/planning/?month_nb=${m}&year_nb=${y}`);
        if (html) rows.push(...parseKana(html, { year: y }));
      }
      return rows;
    },
  },
  {
    editeur: 'Pika',
    async run() {
      const rows = [];
      for (const { ym } of months) {
        for (let page = 1; page <= 4; page++) {
          const html = await get(`https://www.pika.fr/planning-sorties/${ym}/${page > 1 ? `${page}/` : ''}`);
          if (!html) break;
          const got = parseHachette(html, { editeur: 'Pika', base: 'https://www.pika.fr/', hrefPrefix: '/livre/' });
          const known = new Set(rows.map((r) => r.source));
          const fresh = got.filter((r) => !known.has(r.source) && r.date.startsWith(ym));
          if (!fresh.length) break;
          rows.push(...fresh);
        }
      }
      return rows;
    },
  },
  {
    editeur: 'Ki-oon',
    async run() {
      const rows = [];
      for (const { y, m } of months) {
        const json = await get(`https://api.ki-oon.com/planning/?year=${y}&month=${m}`, { json: true });
        if (json) rows.push(...parseKioon(json));
      }
      return rows;
    },
  },
];

/* ------------------------------------------------------------- exécution */
const file = path.join(P.dataDir, 'manga-auto.csv');
const previous = existsSync(file) ? loadManga(file) : [];
const HEADER = ['Date de sortie', 'Éditeur', 'Série', 'Tome', 'Titre du tome (facultatif)', 'ISBN-13', 'Prix (€)', 'Statut', 'Source officielle (lien)', 'Vérifié le', 'Notes'];
const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const result = [];
const fresh = [];
const okPublishers = new Set();
const report = [];
for (const src of SOURCES) {
  let rows = [];
  try {
    rows = await src.run();
  } catch (e) {
    console.error(`${src.editeur} : échec (${e.message})`);
  }
  rows = rows.filter((r) => r.date >= first && r.date <= last && r.serie);
  const seen = new Set();
  rows = rows.filter((r) => {
    const k = r.isbn || `${r.serie}|${r.tome}|${r.titre}|${r.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (rows.length) {
    result.push(...rows);
    fresh.push(...rows);
    okPublishers.add(src.editeur);
    report.push(`${src.editeur} : ${rows.length}`);
  } else {
    const old = previous.filter((r) => r.editeur === src.editeur && r.date >= addDays(today, -30));
    result.push(...old.map((r) => ({ ...r, prix: r.prix })));
    report.push(`${src.editeur} : 0 trouvée (${old.length} anciennes conservées)`);
  }
}

const sorted = result.sort((a, b) => a.date.localeCompare(b.date) || a.editeur.localeCompare(b.editeur) || a.serie.localeCompare(b.serie, 'fr') || String(a.tome).localeCompare(String(b.tome), 'fr', { numeric: true }));
const lines = [HEADER.join(',')];
for (const r of sorted) {
  lines.push([
    r.date, r.editeur, r.serie, r.tome, r.titre, r.isbn,
    r.prix != null ? String(r.prix).replace('.', ',') : '',
    r.date < today ? 'Paru' : 'Annoncé', r.source, today, 'Collecte automatique',
  ].map(cell).join(','));
}
mkdirSync(P.dataDir, { recursive: true });
const out = lines.join('\n') + '\n';
if (!existsSync(file) || readFileSync(file, 'utf8') !== out) writeFileSync(file, out);
const chFile = path.join(P.dataDir, 'changes.json');
const before = readChanges(chFile);
const after = updateChanges(before, fresh, okPublishers, today);
const chOut = serializeChanges(after);
if (!existsSync(chFile) || readFileSync(chFile, 'utf8') !== chOut) writeFileSync(chFile, chOut);
const news = after.events.length - before.events.length;
console.log(`Collecte terminée (${sorted.length} sorties) — ${report.join(' | ')}`);
if (news > 0) console.log(`${news} changement(s) détecté(s) dans les plannings.`);
