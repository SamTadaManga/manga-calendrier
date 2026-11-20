// Liste des séries du site sans aucune couverture connue : ni couverture de série, ni couverture d'un de leurs tomes.
// Sources : inventaire des images de R2 (data/couvertures-controle.json, null = absente), tomes rangés en R2 (data/couvertures-isbn.json),
// couvertures du calendrier. Les séries retirées pour contenu 18+ n'y figurent pas.
// Usage : node scripts/series-sans-couverture.mjs [fichier.txt]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { paths, loadAllManga, slugify } from './lib.mjs';
import { loadBnf } from './catalogue-bnf.mjs';

const P = paths();
const lire = (f, def) => { try { return JSON.parse(readFileSync(path.join(P.dataDir, f), 'utf8')); } catch { return def; } };
const vus = lire('couvertures-controle.json', {}).vus || {};
const faits = new Set(lire('couvertures-isbn.json', {}).done || []);
const bnf = loadBnf(P.dataDir);
const manga = loadAllManga(P.dataDir).filter((r) => r.statut !== 'annule');

const aImage = (cle) => Array.isArray(vus[cle]);   // contrôlée et présente
const inconnue = (cle) => !(cle in vus);           // pas encore contrôlée
const series = new Map();
for (const c of bnf.series) series.set(c.k, { nom: c.n, ed: c.e || '', isbns: c.v.map((v) => v[1]), cal: false, covCal: false });
for (const r of manga) {
  const k = slugify(r.serie);
  const s = series.get(k) || series.set(k, { nom: r.serie, ed: r.editeur || '', isbns: [], cal: true, covCal: false }).get(k);
  s.cal = true; if (r.isbn && !s.isbns.includes(r.isbn)) s.isbns.push(r.isbn);
  if (/^https:\/\//.test(r.cover || '')) s.covCal = true;
}
const sans = [], aVerifier = [];
for (const [k, s] of series) {
  const tomes = s.isbns.filter((i) => faits.has(i) || aImage(`isbn/${i}`)).length;
  if (aImage(`series/${k}`) || s.covCal || tomes) continue;
  (inconnue(`series/${k}`) ? aVerifier : sans).push({ k, ...s });
}
const tri = (a, b) => a.nom.localeCompare(b.nom, 'fr');
const ligne = (s) => `${s.nom}${s.ed ? ` (${s.ed})` : ''} — ${s.isbns.length} tome${s.isbns.length > 1 ? 's' : ''}${s.cal ? ', au calendrier' : ''} — https://prochaintome.fr/serie/${s.k}/`;
const maj = lire('couvertures-controle.json', {}).maj || '?';
const txt = [
  `Séries sans couverture sur prochaintome.fr`,
  `Établi d'après l'inventaire des images (contrôle du ${maj}). Séries du site : ${series.size}.`,
  ``,
  `== ${sans.length} séries sans aucune couverture (ni série, ni tome) ==`,
  ...sans.sort(tri).map(ligne),
  ``,
  `== ${aVerifier.length} séries pas encore contrôlées, sans couverture connue ==`,
  ...aVerifier.sort(tri).map(ligne),
  ``,
].join('\n');
const sortie = process.argv[2] || path.join(P.dataDir, '..', 'series-sans-couverture.txt');
writeFileSync(sortie, txt);
console.log(`${sans.length} séries sans couverture, ${aVerifier.length} à vérifier, sur ${series.size} → ${sortie}`);
