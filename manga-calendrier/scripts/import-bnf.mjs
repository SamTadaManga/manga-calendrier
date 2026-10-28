// Import ponctuel du catalogue BnF (≈ 8 000 séries de manga publiées en français) -> data/catalogue-bnf.json
// Usage : node scripts/import-bnf.mjs chemin/resultats_bnf.csv
// Colonnes attendues : id_serie, tome, isbn, annee, titre_bnf, partie_bnf, collection_bnf, editeur_bnf, ark, requete
// Nettoyage : ISBN invalides et doublons écartés, éditeurs ramenés à un seul nom, séries regroupées par titre (« 10 dance » = « 10 Dance »).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseCSV, slugify, paths } from './lib.mjs';
import { isIsbn13 } from './shops.mjs';

const src = process.argv[2];
if (!src) { console.error('Usage : node scripts/import-bnf.mjs resultats_bnf.csv'); process.exit(1); }
const table = parseCSV(readFileSync(src, 'utf8'));
const head = table[0].map((h) => h.trim());
const col = Object.fromEntries(head.map((h, i) => [h, i]));
for (const need of ['tome', 'isbn', 'annee', 'titre_bnf', 'partie_bnf', 'editeur_bnf']) if (!(need in col)) { console.error(`Colonne manquante : ${need}`); process.exit(1); }

const flat = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const KNOWN = {
  'pika': 'Pika', 'pika edition': 'Pika', 'pika editions': 'Pika', 'pika roman': 'Pika',
  'ki oon': 'Ki-oon', 'tonkam': 'Tonkam', 'delcourt tonkam': 'Tonkam', 'ed tonkam': 'Tonkam',
  'delcourt': 'Delcourt', 'guy delcourt productions': 'Delcourt', 'editions delcourt': 'Delcourt',
  'akata': 'Akata', 'delcourt akata': 'Akata', 'editions akata': 'Akata', 'akata editions': 'Akata',
  'panini manga': 'Panini Manga', 'panini comics': 'Panini', 'panini france': 'Panini', 'genration comics panini france': 'Panini',
  'soleil': 'Soleil', 'soleil manga': 'Soleil', 'kana': 'Kana', 'big kana': 'Kana', 'dargaud benelux kana': 'Kana',
  'glenat': 'Glénat', 'glenat jeunesse': 'Glénat', 'kaze': 'Kazé', 'kurokawa': 'Kurokawa', 'meian': 'Meian', 'mangetsu': 'Mangetsu',
  'nobi nobi': 'Nobi Nobi !', 'taifu comics': 'Taifu Comics', 'taifu': 'Taifu Comics', 'vega': 'Vega-Dupuis', 'vega dupuis': 'Vega-Dupuis',
  'ankama': 'Ankama', 'ankama ed': 'Ankama', 'ankama editions': 'Ankama', 'bamboo': 'Bamboo', 'bamboo edition': 'Bamboo', 'bamboo ed': 'Bamboo',
  'komikku': 'Komikku', 'komikku editions': 'Komikku', 'boy s love': 'IDP', 'idp home video music': 'IDP', 'harlequin': 'Harlequin',
  'ototo': 'Ototo', 'casterman': 'Casterman', 'crunchyroll': 'Crunchyroll', 'asuka': 'Asuka', 'kbooks': 'Kbooks', 'mana books': 'Mana Books',
};
function canonPub(raw) {
  let k = flat(raw);
  if (!k) return '';
  if (/(^| )panini( |$)/.test(k) && /generation comics/.test(k)) return 'Panini';
  if (KNOWN[k]) return KNOWN[k];
  const s = k.replace(/^(editions?|ed|les|le|la|l) /, '').replace(/ (editions?|ed)$/, '');
  if (KNOWN[s]) return KNOWN[s];
  const nice = String(raw).trim().replace(/^(Éditions?|Éd\.|les|le|l')\s*/i, '').replace(/\s+(éditions?|éd\.)$/i, '').replace(/\s*!+$/, '').trim();
  return nice ? nice[0].toUpperCase() + nice.slice(1) : '';
}
const uppers = (s) => (s.match(/\p{Lu}/gu) || []).length;

// Une série = un id_serie du fichier (les titres BnF varient d'un tome à l'autre : sous-titres, casse, « T11 »).
// Son nom d'adresse (et le nom de sa couverture dans R2) vient du titre de la requête, qui est le titre de la série.
const byId = new Map();
let skipped = 0;
for (const r of table.slice(1)) {
  const isbn = (r[col.isbn] || '').trim();
  const title = (r[col.titre_bnf] || '').trim();
  if (!isIsbn13(isbn) || !title) { skipped++; continue; }
  const id = r[col.id_serie] || slugify(title);
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id).push({ r, isbn, title });
}
// Un même ISBN peut sortir de plusieurs séries (requêtes qui se recoupent, par exemple « version » ou « happy »).
// On le garde dans la série dont le nom d'adresse colle le mieux à son titre ; à égalité, dans la plus grosse.
const slugOfGroup = (rows) => { const q = (rows[0].r[col.requete] || '').match(/bib\.title all "([^"]+)"/); return slugify(q ? q[1] : rows[0].title); };
const owners = new Map(); // isbn -> [{ id, score }]
for (const [id, rows] of byId) {
  const k = slugOfGroup(rows);
  for (const x of rows) {
    const t = slugify(x.title);
    const score = (t === k ? 3 : t.startsWith(`${k}-`) ? 2 : t.includes(k) ? 1 : 0) * 1e6 + rows.length;
    if (!owners.has(x.isbn)) owners.set(x.isbn, []);
    owners.get(x.isbn).push({ id, score });
  }
}
let removedDup = 0;
for (const [id, rows] of byId) {
  const keep = rows.filter((x) => { const best = owners.get(x.isbn).reduce((a, b) => (b.score > a.score || (b.score === a.score && b.id < a.id) ? b : a)); return best.id === id; });
  removedDup += rows.length - keep.length;
  if (keep.length) byId.set(id, keep); else byId.delete(id);
}
const groups = new Map(); // slug de la série -> { names, pubs, vols }
for (const rows of byId.values()) {
  const q = (rows[0].r[col.requete] || '').match(/bib\.title all "([^"]+)"/);
  const counts = new Map();
  for (const x of rows) counts.set(x.title, (counts.get(x.title) || 0) + 1);
  const common = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const k = slugify(q ? q[1] : common) || slugify(common);
  if (!k) { skipped += rows.length; continue; }
  let g = groups.get(k);
  if (!g) { g = { names: new Map(), pubs: new Map(), vols: new Map(), k }; groups.set(k, g); }
  for (const x of rows) {
    if (slugify(x.title) === k) g.names.set(x.title, (g.names.get(x.title) || 0) + 1);
    const pub = canonPub(x.r[col.editeur_bnf]);
    if (pub) g.pubs.set(pub, (g.pubs.get(pub) || 0) + 1);
    if (g.vols.has(x.isbn)) continue;
    const tome = /^\d{1,3}$/.test((x.r[col.tome] || '').trim()) ? String(Number(x.r[col.tome])) : ((x.r[col.partie_bnf] || '').match(/^\[?0*(\d{1,3})\]?$/) || [])[1] || '';
    const label = !tome ? (x.r[col.partie_bnf] || '').trim().slice(0, 40) : '';
    const y = /^(19|20)\d{2}$/.test((x.r[col.annee] || '').trim()) ? Number(x.r[col.annee]) : 0;
    g.vols.set(x.isbn, [tome, x.isbn, y, label]);
  }
  if (!g.names.size) g.names.set(common, 1);
}
const series = [...groups].map(([k, g]) => {
  const name = [...g.names].sort((a, b) => uppers(b[0]) - uppers(a[0]) || b[1] - a[1])[0][0].replace(/^#\s*/, '#');
  const pubs = [...g.pubs].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const v = [...g.vols.values()].sort((a, b) => (Number(a[0]) || 1e6) - (Number(b[0]) || 1e6) || a[2] - b[2] || a[1].localeCompare(b[1]));
  return { k, n: name, e: pubs[0] || '', ...(pubs.length > 1 ? { p: pubs.slice(1, 4) } : {}), v: v.map((x) => (x[3] ? x : x.slice(0, 3))) };
}).sort((a, b) => a.k.localeCompare(b.k));
const P = paths();
const out = path.join(P.dataDir, 'catalogue-bnf.json');
writeFileSync(out, JSON.stringify({ source: 'BnF (catalogue général), licence ouverte', maj: new Date().toISOString().slice(0, 10), series }) + '\n');
console.log(`${series.length} séries, ${series.reduce((n, s) => n + s.v.length, 0)} tomes, ${skipped} lignes écartées, ${removedDup} doublons d'ISBN entre séries supprimés -> ${out}`);
